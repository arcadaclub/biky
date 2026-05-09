<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/OpenRouteService.php';
require dirname(__DIR__) . '/includes/route_geojson.php';
require dirname(__DIR__) . '/includes/geo_wgs84.php';
require dirname(__DIR__) . '/includes/dead_end_polygons.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    nr_json_response(['ok' => false, 'error' => 'Nur POST erlaubt.'], 405);
    exit;
}

$user = nr_json_require_user();

$csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
if (!nr_verify_csrf(is_string($csrf) ? $csrf : null)) {
    nr_json_response(['ok' => false, 'error' => 'CSRF-Token ungültig.'], 403);
    exit;
}

if (!nr_rate_limit_ok(nr_client_ip())) {
    nr_json_response(['ok' => false, 'error' => 'Zu viele Anfragen. Bitte später erneut versuchen.'], 429);
    exit;
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    nr_json_response(['ok' => false, 'error' => 'Leerer Request-Body.'], 400);
    exit;
}

try {
    /** @var mixed $input */
    $input = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $e) {
    nr_json_response(['ok' => false, 'error' => 'Ungültiges JSON.'], 400);
    exit;
}

if (!is_array($input)) {
    nr_json_response(['ok' => false, 'error' => 'Ungültige Anfrage.'], 400);
    exit;
}

try {
    $start = $input['start'] ?? null;
    if (!is_array($start) || count($start) < 2) {
        throw new RuntimeException('start als [lat, lon] angeben (Startpunkt der Rund-Schleife).');
    }
    $lat = (float) $start[0];
    $lon = (float) $start[1];
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        throw new RuntimeException('Koordinaten außerhalb des gültigen Bereichs.');
    }

    $targetDistanceKm = isset($input['distance_km'])
        ? (float) $input['distance_km']
        : (isset($input['radius_km']) ? (float) $input['radius_km'] : 0.0);
    if (!is_finite($targetDistanceKm) || $targetDistanceKm < 1.0 || $targetDistanceKm > 120.0) {
        throw new RuntimeException('distance_km zwischen 1 und 120 angeben (gewünschte Rundkurslänge in km).');
    }

    $variants = isset($input['variants']) ? (int) $input['variants'] : 1;
    if ($variants < 1 || $variants > 5) {
        throw new RuntimeException('variants zwischen 1 und 5.');
    }

    $profil = nr_rt_normalize_profil($input['profil'] ?? 'natur');
    $fastVariant = !empty($input['fast_variant']);

    $rotationOffsetDeg = 0.0;
    if (array_key_exists('rot_offset_deg', $input)) {
        $rotationOffsetDeg = (float) $input['rot_offset_deg'];
        if (!is_finite($rotationOffsetDeg)) {
            $rotationOffsetDeg = 0.0;
        }
        // Normalisieren: 0..360
        $rotationOffsetDeg = fmod($rotationOffsetDeg, 360.0);
        if ($rotationOffsetDeg < 0) {
            $rotationOffsetDeg += 360.0;
        }
    }
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
    exit;
}

$cfg = nr_config();
$orsCfg = $cfg['openrouteservice'] ?? [];
$settings = $_SESSION['nr_settings'] ?? [];
$sessionApiKey = is_array($settings) && isset($settings['orsApiKey']) && is_string($settings['orsApiKey'])
    ? trim($settings['orsApiKey'])
    : '';
$apiKey = $sessionApiKey !== ''
    ? $sessionApiKey
    : (is_array($orsCfg) ? (string) ($orsCfg['api_key'] ?? '') : '');
$baseUrl = is_array($orsCfg) ? (string) ($orsCfg['base_url'] ?? 'https://api.openrouteservice.org') : 'https://api.openrouteservice.org';

/**
 * Geschlossene Schleife: Nutzer gibt die gewünschte Rundkurslänge an; intern wird daraus
 * ein Kreisradius abgeleitet, auf dessen Luftlinie der Startpunkt liegt.
 * Viele Via-Punkte mit kurzer Luftlinie zwischen benachbarten Punkten → Routing bleibt näher
 * am Kreis (OpenRouteService: routeRoundtripWithMeta mit preference „shortest“).
 */
$profilePlan = nr_rt_profile_plan($profil);
$radiusKm = ($targetDistanceKm / (2 * M_PI)) * $profilePlan['radius_scale'];
$radiusM = $radiusKm * 1000.0;
/*
 * ORS erlaubt max. 50 Koordinaten pro Anfrage — ohne Chunking bleiben bei großem Radius die
 * Sehnen lang (z. B. 34 km → nur ~48 Ecken → ~4,4 km Sehne → starke Umwege). Daher viele
 * Hilfunkte und ggf. mehrere nacheinander geroutete Kreisbögen (Zusammenführung serverseitig).
 */
// Etwas längere Zielsehne → weniger Hilfspunkte, ORS wird seltener in Seitenstraßen „gedrückt“.
$chordTargetKm = max(0.84, min(2.35, $radiusKm * (0.125 * $profilePlan['chord_scale'])));
$nLoop = (int) max(5, min(220, (int) ceil((2 * M_PI * $radiusKm) / $chordTargetKm)));

$outVariants = [];
$errors = [];
$rateLimited = false;

try {
    $ors = new OpenRouteService($baseUrl, $apiKey);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 502);
    exit;
}

/*
 * Sackgassen-Avoid-Polygone vorab holen — einmal pro Anfrage, wird über alle Varianten geteilt.
 * Wenn Overpass nicht erreichbar oder der Bereich zu groß ist, läuft die Pipeline ohne Avoid weiter
 * (die nachgelagerte Spike-Erkennung fängt das ab — siehe cleanRoundtripVariant im Client).
 */
$avoidPolygons = nr_dead_end_polygons_for_circle($lat, $lon, $radiusM);
$avoidFingerprint = $avoidPolygons === null
    ? 'none'
    : substr(hash('sha256', json_encode($avoidPolygons, JSON_UNESCAPED_UNICODE)), 0, 12);

// Viele ORS-Calls + Wartezeiten bei 429: Standard-Timeout (z. B. 30 s) sonst zu knapp.
if (function_exists('set_time_limit')) {
    @set_time_limit(180);
}

for ($i = 1; $i <= $variants; $i++) {
    if ($rateLimited) {
        break;
    }
    $rotationDeg = ($i - 1) * (360.0 / max(1, $variants));
    $rotationDeg = fmod($rotationDeg + $rotationOffsetDeg, 360.0);

    /**
     * `rotationDeg` wird aus (variants, $i, $rotationOffsetDeg) abgeleitet — daher reicht es als Schlüssel,
     * `vt`, `vi` und `rot_off` müssen nicht zusätzlich rein. So treffen identische Effektiv-Rotationen
     * den Cache, auch wenn der User die Variantenzahl ändert.
     */
    $cachePayload = [
        'mode' => $fastVariant ? 'circle_loop_fast_v5' : 'circle_loop_v29',
        'user_id' => (int) $user['id'],
        'ors_key_hash' => hash('sha256', $apiKey),
        'base_url' => $baseUrl,
        'lat' => round($lat, 6),
        'lon' => round($lon, 6),
        'd' => round($targetDistanceKm, 4),
        'r' => round($radiusKm, 4),
        'p' => $profil,
        'fast' => $fastVariant ? 1 : 0,
        'n' => $nLoop,
        'rot' => round($rotationDeg, 4),
        'avoid' => $avoidFingerprint,
    ];
    $cacheKey = 'route_rt_' . hash('sha256', json_encode($cachePayload, JSON_THROW_ON_ERROR));
    $cacheFile = dirname(__DIR__) . '/cache/' . $cacheKey . '.json';
    $ttl = 21600;

    if (is_readable($cacheFile) && (time() - filemtime($cacheFile)) < $ttl) {
        $cached = file_get_contents($cacheFile);
        if ($cached !== false) {
            try {
                /** @var array<string, mixed> $one */
                $one = json_decode($cached, true, 512, JSON_THROW_ON_ERROR);
                if (is_array($one) && ($one['ok'] ?? false) === true) {
                    $outVariants[] = $one;
                    continue;
                }
            } catch (JsonException) {
                /* Cache ungültig — neu berechnen */
            }
        }
    }

    try {
        $one = nr_rt_build_variant_route(
            $ors,
            $lat,
            $lon,
            $rotationDeg,
            $radiusM,
            $nLoop,
            $profil,
            $targetDistanceKm,
            $i,
            $avoidPolygons,
            $fastVariant
        );
        $outVariants[] = $one;
        $encodedOne = json_encode($one, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if (is_dir(dirname($cacheFile))) {
            @file_put_contents($cacheFile, $encodedOne, LOCK_EX);
        }
    } catch (Throwable $e) {
        if (nr_rt_is_ors_rate_limited($e)) {
            $rateLimited = true;
        }
        $errors[] = 'Variante ' . $i . ': ' . $e->getMessage();
    }
}

if ($outVariants === []) {
    nr_json_response([
        'ok' => false,
        'error' => 'Kein Rundkurs konnte berechnet werden. ' . ($errors !== [] ? implode(' ', $errors) : ''),
    ], 502);
    exit;
}

$response = [
    'ok' => true,
    'variants' => $outVariants,
    'distance_km' => round($targetDistanceKm, 2),
    'radius_km' => round($radiusKm, 2),
    'profil' => $profil,
    'roundtrip_mode' => 'circle_loop',
    'roundtrip_via_points' => $nLoop,
    'roundtrip_length_capped' => false,
    'roundtrip_batched' => ($nLoop + 1) > 50,
    // Luftlinie des internen Referenzkreises; sollte der gewünschten Rundkurslänge entsprechen.
    'geodesic_loop_km' => round($targetDistanceKm, 1),
    'dead_end_avoid_active' => $avoidPolygons !== null,
    'dead_end_avoid_polygon_count' => $avoidPolygons !== null && isset($avoidPolygons['coordinates']) && is_array($avoidPolygons['coordinates'])
        ? count($avoidPolygons['coordinates'])
        : 0,
];
if ($errors !== []) {
    $response['partial_errors'] = $errors;
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

/**
 * @param mixed $p
 */
function nr_rt_normalize_profil(mixed $p): string
{
    $s = is_string($p) ? strtolower(trim($p)) : 'natur';
    $allowed = ['natur', 'gravel', 'offroad', 'kurvig', 'ruhig', 'radwege'];

    return in_array($s, $allowed, true) ? $s : 'natur';
}

function nr_rt_is_ors_rate_limited(Throwable $e): bool
{
    return str_contains($e->getMessage(), 'HTTP 429');
}

function nr_rt_build_variant_route(
    OpenRouteService $ors,
    float $lat,
    float $lon,
    float $rotationDeg,
    float $radiusM,
    int $nLoop,
    string $profil,
    float $targetDistanceKm,
    int $variantIndex,
    ?array $avoidPolygons = null,
    bool $fastVariant = false
): array {
    $plan = nr_rt_profile_plan($profil);
    if ($fastVariant) {
        $plan = nr_rt_fast_profile_plan($plan);
    }

    /**
     * Erst die "billige" Phase routen und sofort prüfen, ob sie die strict-Qualität schon erreicht
     * — spart die teuren ORS-Calls der adaptiven/secondary Phasen, wenn primary bereits passt.
     */
    $primaryRoutes = nr_rt_collect_variant_candidates(
        $ors,
        $lat,
        $lon,
        $rotationDeg,
        $radiusM,
        $nLoop,
        $profil,
        $targetDistanceKm,
        $variantIndex,
        $plan['primary_phase_offsets'],
        $avoidPolygons
    );

    $earlyStrict = array_values(array_filter(
        $primaryRoutes,
        static fn (array $route): bool => nr_rt_route_quality_ok($route, $targetDistanceKm, 'strict')
    ));
    if ($earlyStrict !== []) {
        return nr_rt_attach_quality_meta(
            nr_rt_pick_best_candidate($earlyStrict, $targetDistanceKm, $profil),
            'strict',
            $targetDistanceKm
        );
    }

    $candidateRoutes = $primaryRoutes;
    if ($fastVariant) {
        foreach (['relaxed', 'fallback', 'last_resort'] as $level) {
            $matching = array_values(array_filter(
                $candidateRoutes,
                static fn (array $route): bool => nr_rt_route_quality_ok($route, $targetDistanceKm, $level)
            ));
            if ($matching !== []) {
                return nr_rt_attach_quality_meta(
                    nr_rt_pick_best_candidate($matching, $targetDistanceKm, $profil),
                    'fast_' . $level,
                    $targetDistanceKm
                );
            }
        }
    }

    $bestPrimary = $primaryRoutes !== []
        ? nr_rt_pick_best_candidate($primaryRoutes, $targetDistanceKm, $profil)
        : null;
    $adaptiveRadiusM = $bestPrimary !== null
        ? nr_rt_adaptive_radius_m($bestPrimary, $radiusM, $targetDistanceKm)
        : null;
    if ($adaptiveRadiusM !== null) {
        $adaptiveRoutes = nr_rt_collect_variant_candidates(
            $ors,
            $lat,
            $lon,
            $rotationDeg,
            $adaptiveRadiusM,
            $nLoop,
            $profil,
            $targetDistanceKm,
            $variantIndex,
            $plan['primary_phase_offsets'],
            $avoidPolygons
        );
        $strictAdaptive = array_values(array_filter(
            $adaptiveRoutes,
            static fn (array $route): bool => nr_rt_route_quality_ok($route, $targetDistanceKm, 'strict')
        ));
        if ($strictAdaptive !== []) {
            return nr_rt_attach_quality_meta(
                nr_rt_pick_best_candidate($strictAdaptive, $targetDistanceKm, $profil),
                'strict',
                $targetDistanceKm
            );
        }
        $candidateRoutes = array_merge($candidateRoutes, $adaptiveRoutes);
    }

    $fallbackRoutes = nr_rt_collect_variant_candidates(
        $ors,
        $lat,
        $lon,
        $rotationDeg,
        $adaptiveRadiusM ?? $radiusM,
        $nLoop,
        $profil,
        $targetDistanceKm,
        $variantIndex,
        $plan['secondary_phase_offsets'],
        $avoidPolygons
    );
    $candidateRoutes = array_merge($candidateRoutes, $fallbackRoutes);

    foreach (['strict', 'relaxed', 'fallback'] as $level) {
        $matching = array_values(array_filter(
            $candidateRoutes,
            static fn (array $route): bool => nr_rt_route_quality_ok($route, $targetDistanceKm, $level)
        ));
        if ($matching !== []) {
            return nr_rt_attach_quality_meta(
                nr_rt_pick_best_candidate($matching, $targetDistanceKm, $profil),
                $level,
                $targetDistanceKm
            );
        }
    }

    if ($candidateRoutes !== []) {
        $best = nr_rt_pick_best_candidate($candidateRoutes, $targetDistanceKm, $profil);
        if (nr_rt_route_quality_ok($best, $targetDistanceKm, 'last_resort')) {
            return nr_rt_attach_quality_meta($best, 'last_resort', $targetDistanceKm);
        }
    }

    /*
     * Notfall: avoid_polygons hat ORS so eingeengt, dass keine brauchbare Route durchkam,
     * oder das Wegnetz erlaubt nur einen Kandidat mit deutlicher Doppelfahrt. Ein letzter
     * Versuch komplett ohne avoid_polygons — die nachgelagerte Spike-Bereinigung im Client
     * fängt verbleibende Sackgassen ab. Lieber eine ungesäuberte Schleife als gar keine Antwort.
     */
    if ($avoidPolygons !== null) {
        $emergencyRoutes = nr_rt_collect_variant_candidates(
            $ors,
            $lat,
            $lon,
            $rotationDeg,
            $radiusM,
            $nLoop,
            $profil,
            $targetDistanceKm,
            $variantIndex,
            $plan['primary_phase_offsets'],
            null
        );
        $candidateRoutes = array_merge($candidateRoutes, $emergencyRoutes);

        foreach (['relaxed', 'fallback', 'last_resort'] as $level) {
            $matching = array_values(array_filter(
                $candidateRoutes,
                static fn (array $route): bool => nr_rt_route_quality_ok($route, $targetDistanceKm, $level)
            ));
            if ($matching !== []) {
                return nr_rt_attach_quality_meta(
                    nr_rt_pick_best_candidate($matching, $targetDistanceKm, $profil),
                    $level . '_no_avoid',
                    $targetDistanceKm
                );
            }
        }

        if ($candidateRoutes !== []) {
            // Allerletzter Notnagel: einfach den besten Kandidaten ausliefern, statt den User
            // mit „Kein Rundkurs gefunden“ stehen zu lassen. Client-Bereinigung greift als
            // zweite Verteidigungslinie.
            return nr_rt_attach_quality_meta(
                nr_rt_pick_best_candidate($candidateRoutes, $targetDistanceKm, $profil),
                'emergency',
                $targetDistanceKm
            );
        }
    }

    throw new RuntimeException(
        'Kein Rundkurs konnte berechnet werden — bitte anderen Startpunkt, eine andere Distanz oder ein anderes Profil versuchen.'
    );
}

/**
 * @return array{
 *   radius_scale: float,
 *   chord_scale: float,
 *   primary_phase_offsets: list<float>,
 *   secondary_phase_offsets: list<float>
 * }
 */
function nr_rt_profile_plan(string $profil): array
{
    return match ($profil) {
        'radwege' => [
            'radius_scale' => 0.92,
            'chord_scale' => 1.18,
            'primary_phase_offsets' => [0.0, 10.0],
            'secondary_phase_offsets' => [-12.0],
        ],
        'ruhig' => [
            'radius_scale' => 0.9,
            'chord_scale' => 1.15,
            'primary_phase_offsets' => [0.0, 8.0],
            'secondary_phase_offsets' => [16.0],
        ],
        'gravel' => [
            'radius_scale' => 0.98,
            'chord_scale' => 0.95,
            'primary_phase_offsets' => [0.0, -10.0],
            'secondary_phase_offsets' => [12.0],
        ],
        default => [
            'radius_scale' => 1.0,
            'chord_scale' => 1.0,
            'primary_phase_offsets' => [0.0, -8.0],
            'secondary_phase_offsets' => [12.0],
        ],
    };
}

/**
 * @param array{
 *   radius_scale: float,
 *   chord_scale: float,
 *   primary_phase_offsets: list<float>,
 *   secondary_phase_offsets: list<float>
 * } $plan
 * @return array{
 *   radius_scale: float,
 *   chord_scale: float,
 *   primary_phase_offsets: list<float>,
 *   secondary_phase_offsets: list<float>
 * }
 */
function nr_rt_fast_profile_plan(array $plan): array
{
    $primary = array_values(array_slice($plan['primary_phase_offsets'], 0, 1));
    if ($primary === []) {
        $primary = [0.0];
    }
    $plan['primary_phase_offsets'] = $primary;
    $plan['secondary_phase_offsets'] = [];
    return $plan;
}

function nr_rt_adaptive_radius_m(array $route, float $radiusM, float $targetDistanceKm): ?float
{
    $distanceKm = isset($route['distance']) ? (float) $route['distance'] : 0.0;
    if ($distanceKm <= 0.1 || $targetDistanceKm <= 0.1) {
        return null;
    }

    $ratio = $distanceKm / $targetDistanceKm;
    if ($ratio >= 1.35) {
        return $radiusM * nr_rt_clamp($targetDistanceKm / $distanceKm, 0.52, 0.82);
    }
    if ($ratio <= 0.78) {
        return $radiusM * nr_rt_clamp($targetDistanceKm / $distanceKm, 1.08, 1.35);
    }

    return null;
}

/**
 * @param list<float> $phaseOffsets
 * @return list<array<string, mixed>>
 */
function nr_rt_collect_variant_candidates(
    OpenRouteService $ors,
    float $lat,
    float $lon,
    float $rotationDeg,
    float $radiusM,
    int $nLoop,
    string $profil,
    float $targetDistanceKm,
    int $variantIndex,
    array $phaseOffsets,
    ?array $avoidPolygons = null
): array {
    $candidateRoutes = [];
    foreach ($phaseOffsets as $phaseOffsetDeg) {
        $phaseRotationDeg = $rotationDeg + $phaseOffsetDeg;
        $center = nr_geo_destination_sphere_m($lat, $lon, $radiusM, $phaseRotationDeg + 180.0);

        foreach ([1, -1] as $direction) {
            $routePts = nr_rt_build_loop_points($center, $radiusM, $phaseRotationDeg, $nLoop, $direction);
            try {
                $orsMeta = $ors->routeRoundtripLoopWithMeta($routePts, $profil, $avoidPolygons);
            } catch (Throwable $e) {
                // Eine Phase darf scheitern (z. B. ORS findet wegen avoid_polygons keine Route durch
                // einen engen Korridor). Andere Phasen/Richtungen liefern weiter Kandidaten.
                if (nr_rt_is_ors_rate_limited($e)) {
                    throw $e;
                }
                continue;
            }
            $geojson = $orsMeta['geojson'];
            $detourCapped = (bool) ($orsMeta['detour_capped'] ?? false);
            try {
                $candidateRoutes[] = nr_build_client_route_from_geojson($geojson, $profil, null, $detourCapped, [
                    'kind' => 'roundtrip',
                    'roundtrip_variant' => $variantIndex,
                    'roundtrip_mode' => 'circle_loop',
                    'roundtrip_spokes' => $nLoop,
                    'roundtrip_direction' => $direction > 0 ? 'clockwise' : 'counterclockwise',
                    'roundtrip_phase_offset_deg' => $phaseOffsetDeg,
                    'distance_km' => round($targetDistanceKm, 2),
                    'radius_km' => round($radiusM / 1000.0, 2),
                ]);
            } catch (Throwable $e) {
                // GeoJSON ohne Geometrie / leeres Feature: Phase überspringen.
                continue;
            }
        }
    }

    return $candidateRoutes;
}

/**
 * @param array{0: float, 1: float} $center
 * @return list<array{0: float, 1: float}>
 */
function nr_rt_build_loop_points(array $center, float $radiusM, float $startBearingDeg, int $nLoop, int $direction): array
{
    $points = [];
    $sign = $direction >= 0 ? 1.0 : -1.0;
    for ($k = 0; $k < $nLoop; $k++) {
        $bearing = $startBearingDeg + $sign * (360.0 * $k / $nLoop);
        $points[] = nr_geo_destination_sphere_m($center[0], $center[1], $radiusM, $bearing);
    }
    $points[] = $points[0];

    return $points;
}

/**
 * @param list<array<string, mixed>> $candidates
 * @return array<string, mixed>
 */
function nr_rt_pick_best_candidate(array $candidates, ?float $targetDistanceKm = null, string $profil = 'natur'): array
{
    if ($candidates === []) {
        throw new RuntimeException('Kein Rundkurs-Kandidat vorhanden.');
    }

    $best = null;
    $bestScore = null;
    foreach ($candidates as $candidate) {
        $score = nr_rt_candidate_score($candidate, $targetDistanceKm, $profil);
        if ($best === null || nr_rt_compare_score($score, $bestScore) < 0) {
            $best = $candidate;
            $bestScore = $score;
        }
    }

    return $best;
}

/**
 * @param array<string, mixed> $route
 * @return array{same_street_penalty: int, start_end_spike_penalty: int, spike_count: int, profile_style_delta: float, dead_end_spike_ratio: float, self_overlap_ratio: float, distance_ratio_delta: float, overlap_ratio: float, distance_km: float}
 */
function nr_rt_candidate_score(array $route, ?float $targetDistanceKm = null, string $profil = 'natur'): array
{
    /** @var list<array{0: float, 1: float}> $geometry */
    $geometry = (isset($route['geometry']) && is_array($route['geometry'])) ? $route['geometry'] : [];
    /** @var list<array<string, mixed>> $steps */
    $steps = (isset($route['navigation']['steps']) && is_array($route['navigation']['steps']))
        ? $route['navigation']['steps']
        : [];
    $distanceKm = isset($route['distance']) ? (float) $route['distance'] : INF;
    $ratioDelta = $targetDistanceKm !== null && $targetDistanceKm > 0.1
        ? abs($distanceKm - $targetDistanceKm) / $targetDistanceKm
        : 0.0;
    $spikes = nr_rt_dead_end_spikes($geometry);
    $routeDistanceM = $distanceKm > 0 && $distanceKm < INF
        ? $distanceKm * 1000.0
        : nr_rt_polyline_length_m($geometry);

    return [
        'same_street_penalty' => nr_rt_same_street_penalty($steps),
        'start_end_spike_penalty' => nr_rt_start_end_spike_penalty($spikes, $routeDistanceM, 430.0),
        'spike_count' => count($spikes),
        'profile_style_delta' => nr_rt_profile_style_delta($route, $profil),
        'dead_end_spike_ratio' => nr_rt_dead_end_spike_ratio($geometry, $spikes),
        'self_overlap_ratio' => nr_rt_self_overlap_ratio($geometry, 42.0, 180.0, 26.0),
        'distance_ratio_delta' => $ratioDelta,
        'overlap_ratio' => nr_rt_start_end_overlap_ratio($geometry, 320.0),
        'distance_km' => $distanceKm,
    ];
}

/**
 * @param array{same_street_penalty: int, start_end_spike_penalty: int, spike_count: int, profile_style_delta: float, dead_end_spike_ratio: float, self_overlap_ratio: float, distance_ratio_delta: float, overlap_ratio: float, distance_km: float}|null $b
 * @param array{same_street_penalty: int, start_end_spike_penalty: int, spike_count: int, profile_style_delta: float, dead_end_spike_ratio: float, self_overlap_ratio: float, distance_ratio_delta: float, overlap_ratio: float, distance_km: float} $a
 */
function nr_rt_compare_score(array $a, ?array $b): int
{
    if ($b === null) {
        return -1;
    }
    foreach (
        [
            'same_street_penalty',
            'start_end_spike_penalty',
            'distance_ratio_delta',
            'dead_end_spike_ratio',
            'self_overlap_ratio',
            'overlap_ratio',
            'spike_count',
            'profile_style_delta',
            'distance_km',
        ] as $key
    ) {
        if ($a[$key] < $b[$key]) {
            return -1;
        }
        if ($a[$key] > $b[$key]) {
            return 1;
        }
    }

    return 0;
}

function nr_rt_profile_style_delta(array $route, string $profil): float
{
    $nature = isset($route['surface_nature']) ? (float) $route['surface_nature'] : 50.0;
    $asphalt = isset($route['asphalt']) ? (float) $route['asphalt'] : 50.0;

    return match ($profil) {
        'radwege' => abs($asphalt - 92.0) / 100.0,
        'ruhig' => abs($asphalt - 78.0) / 100.0,
        'gravel' => abs($nature - 58.0) / 100.0,
        default => abs($nature - 66.0) / 100.0,
    };
}

/**
 * Sackgassen-/Hin-und-zurück-Spitzen: Route läuft von einem Punkt weg und kurz darauf
 * fast zum selben Punkt zurück, ohne dass daraus eine echte neue Schleife entsteht.
 *
 * @param list<array{0: float, 1: float}> $geometry
 * @param list<array{anchor_path_m: float, return_path_m: float, path_delta_m: float, max_away_m: float}>|null $precomputedSpikes
 */
function nr_rt_dead_end_spike_ratio(array $geometry, ?array $precomputedSpikes = null): float
{
    $samples = nr_rt_sample_polyline_with_distance($geometry, 24.0);
    if (count($samples) < 8) {
        return 0.0;
    }
    $spikes = $precomputedSpikes ?? nr_rt_dead_end_spikes($geometry);

    return count($spikes) / max(1, count($samples));
}

/**
 * Hin-und-zurück-Äste: Anchor → Punkt mit gleicher Position nach kurzer Pfadstrecke,
 * dazwischen ein klar entferntes Maximum, und die beiden Hälften verlaufen räumlich
 * gespiegelt (Mirror-Check) — sonst würden 90°-Kreuzungen oder Schleifen fälschlich als Spike zählen.
 *
 * @param list<array{0: float, 1: float}> $geometry
 * @return list<array{anchor_path_m: float, return_path_m: float, path_delta_m: float, max_away_m: float}>
 */
function nr_rt_dead_end_spikes(array $geometry): array
{
    $stepM = 24.0;
    $samples = nr_rt_sample_polyline_with_distance($geometry, $stepM);
    $count = count($samples);
    if ($count < 8) {
        return [];
    }

    // Schwellwerte skalieren mit Routenlänge: bei 30 km echte 700-m-Sackgassen-Stiche, bei 5 km nur kurze.
    $totalLengthM = $samples[$count - 1][2];
    $maxAwayCap = nr_rt_clamp(0.045 * $totalLengthM, 320.0, 1100.0);
    $maxPathDeltaM = nr_rt_clamp(0.18 * $totalLengthM, 800.0, 3200.0);
    $minPathDeltaM = 90.0;
    $maxReturnDistM = 32.0;
    $minAwayM = 50.0;
    $minMirrorSamples = 4;
    $avgMirrorDistMax = 18.0;
    $maxMirrorDistMax = 32.0;

    $grid = nr_rt_build_spatial_grid($samples, $maxReturnDistM * 2.5);
    $spikes = [];

    $i = 0;
    while ($i < $count) {
        $anchor = $samples[$i];
        $candidate = null;

        $neighborIdx = nr_rt_query_grid_within($grid, $anchor[0], $anchor[1], $maxReturnDistM);
        sort($neighborIdx, SORT_NUMERIC);

        foreach ($neighborIdx as $j) {
            if ($j <= $i) {
                continue;
            }
            $pathDelta = $samples[$j][2] - $anchor[2];
            if ($pathDelta < $minPathDeltaM) {
                continue;
            }
            if ($pathDelta > $maxPathDeltaM) {
                break;
            }

            $returnDistanceM = nr_rt_haversine_m($anchor[0], $anchor[1], $samples[$j][0], $samples[$j][1]);
            if ($returnDistanceM > $maxReturnDistM) {
                continue;
            }

            $maxAwayM = 0.0;
            for ($k = $i + 1; $k < $j; $k++) {
                $awayM = nr_rt_haversine_m($anchor[0], $anchor[1], $samples[$k][0], $samples[$k][1]);
                if ($awayM > $maxAwayM) {
                    $maxAwayM = $awayM;
                }
            }
            if ($maxAwayM < $minAwayM || $maxAwayM > $maxAwayCap) {
                continue;
            }

            $mirror = nr_rt_mirror_overlap_stats($samples, $i, $j);
            if (
                $mirror === null
                || $mirror['count'] < $minMirrorSamples
                || $mirror['avg'] > $avgMirrorDistMax
                || $mirror['max'] > $maxMirrorDistMax
            ) {
                continue;
            }

            $candidate = [
                'anchor_path_m' => $anchor[2],
                'return_path_m' => $samples[$j][2],
                'path_delta_m' => $pathDelta,
                'max_away_m' => $maxAwayM,
                'next_i' => $j,
            ];
            break;
        }

        if ($candidate !== null) {
            $spikes[] = [
                'anchor_path_m' => $candidate['anchor_path_m'],
                'return_path_m' => $candidate['return_path_m'],
                'path_delta_m' => $candidate['path_delta_m'],
                'max_away_m' => $candidate['max_away_m'],
            ];
            $i = $candidate['next_i'] + 1;
            continue;
        }
        $i++;
    }

    return $spikes;
}

/**
 * Räumlicher Hash-Grid: O(1)-Lookup von Samples in einer Umgebung statt O(N²) im Detector.
 * Zellen-Kanten werden so gewählt, dass `nr_rt_query_grid_within(... $maxM)` in 1–2 Zellen-Reach
 * alle Treffer findet.
 *
 * @param list<array{0: float, 1: float, 2: float}> $samples
 * @return array{cells: array<string, list<int>>, cellLatDeg: float, cellLonDeg: float, refLatRad: float, latPerDeg: float, lonPerDeg: float}
 */
function nr_rt_build_spatial_grid(array $samples, float $cellM): array
{
    $cellM = max(8.0, $cellM);
    if ($samples === []) {
        return [
            'cells' => [],
            'cellLatDeg' => $cellM / 111320.0,
            'cellLonDeg' => $cellM / 111320.0,
            'refLatRad' => 0.0,
            'latPerDeg' => 111320.0,
            'lonPerDeg' => 111320.0,
        ];
    }
    $refLat = $samples[0][0];
    $latPerDeg = 111320.0;
    $lonPerDeg = max(1.0, 111320.0 * cos(deg2rad($refLat)));
    $cellLatDeg = max(1e-7, $cellM / $latPerDeg);
    $cellLonDeg = max(1e-7, $cellM / $lonPerDeg);
    $cells = [];
    foreach ($samples as $idx => $s) {
        $cx = (int) floor($s[1] / $cellLonDeg);
        $cy = (int) floor($s[0] / $cellLatDeg);
        $key = $cx . ':' . $cy;
        $cells[$key][] = $idx;
    }

    return [
        'cells' => $cells,
        'cellLatDeg' => $cellLatDeg,
        'cellLonDeg' => $cellLonDeg,
        'refLatRad' => deg2rad($refLat),
        'latPerDeg' => $latPerDeg,
        'lonPerDeg' => $lonPerDeg,
    ];
}

/**
 * @param array{cells: array<string, list<int>>, cellLatDeg: float, cellLonDeg: float, refLatRad: float, latPerDeg: float, lonPerDeg: float} $grid
 * @return list<int>
 */
function nr_rt_query_grid_within(array $grid, float $lat, float $lon, float $maxM): array
{
    if ($grid['cells'] === []) {
        return [];
    }
    $cx = (int) floor($lon / $grid['cellLonDeg']);
    $cy = (int) floor($lat / $grid['cellLatDeg']);
    $reachY = (int) max(1, ceil($maxM / max(1.0, $grid['cellLatDeg'] * $grid['latPerDeg'])));
    $reachX = (int) max(1, ceil($maxM / max(1.0, $grid['cellLonDeg'] * $grid['lonPerDeg'])));
    $out = [];
    for ($dy = -$reachY; $dy <= $reachY; $dy++) {
        for ($dx = -$reachX; $dx <= $reachX; $dx++) {
            $key = ($cx + $dx) . ':' . ($cy + $dy);
            if (isset($grid['cells'][$key])) {
                foreach ($grid['cells'][$key] as $idx) {
                    $out[] = $idx;
                }
            }
        }
    }

    return $out;
}

/**
 * Hin- und Rückweg eines Spike-Kandidaten verlaufen gespiegelt um den Mittelpunkt:
 * sample[i+t] sollte räumlich nah an sample[j-t] liegen. So werden echte Sackgassen-Stiche
 * von rundlichen Schleifen (Kreuzungen, Wohngebiete) unterschieden.
 *
 * @param list<array{0: float, 1: float, 2: float}> $samples
 * @return array{count: int, avg: float, max: float}|null
 */
function nr_rt_mirror_overlap_stats(array $samples, int $i, int $j): ?array
{
    $half = (int) floor(($j - $i) / 2);
    if ($half < 2) {
        return null;
    }
    $count = 0;
    $sum = 0.0;
    $max = 0.0;
    for ($t = 1; $t <= $half; $t++) {
        $left = $samples[$i + $t] ?? null;
        $right = $samples[$j - $t] ?? null;
        if ($left === null || $right === null) {
            break;
        }
        $d = nr_rt_haversine_m($left[0], $left[1], $right[0], $right[1]);
        $sum += $d;
        if ($d > $max) {
            $max = $d;
        }
        $count++;
    }
    if ($count === 0) {
        return null;
    }

    return ['count' => $count, 'avg' => $sum / $count, 'max' => $max];
}

/**
 * @param list<array{anchor_path_m: float, return_path_m: float, path_delta_m: float, max_away_m: float}> $spikes
 */
function nr_rt_start_end_spike_penalty(array $spikes, float $routeDistanceM, float $windowM): int
{
    if ($spikes === [] || $routeDistanceM <= 0.0) {
        return 0;
    }

    $penalty = 0;
    foreach ($spikes as $spike) {
        $nearStart = $spike['anchor_path_m'] <= $windowM;
        $nearEnd = ($routeDistanceM - $spike['return_path_m']) <= $windowM;
        if ($nearStart || $nearEnd) {
            $penalty++;
        }
    }

    return $penalty;
}

/**
 * @param list<array{0: float, 1: float}> $geometry
 */
function nr_rt_self_overlap_ratio(
    array $geometry,
    float $sampleStepM,
    float $minPathSeparationM,
    float $nearPointThresholdM
): float {
    if (count($geometry) < 8) {
        return 0.0;
    }

    $samples = nr_rt_sample_polyline_with_distance($geometry, $sampleStepM);
    $count = count($samples);
    if ($count < 4) {
        return 0.0;
    }

    $grid = nr_rt_build_spatial_grid($samples, $nearPointThresholdM * 2.5);
    $overlaps = 0;
    for ($i = 0; $i < $count; $i++) {
        $a = $samples[$i];
        $candidates = nr_rt_query_grid_within($grid, $a[0], $a[1], $nearPointThresholdM);
        foreach ($candidates as $j) {
            if ($j <= $i) {
                continue;
            }
            $pathDelta = abs($samples[$j][2] - $a[2]);
            if ($pathDelta < $minPathSeparationM) {
                continue;
            }
            if (nr_rt_haversine_m($a[0], $a[1], $samples[$j][0], $samples[$j][1]) <= $nearPointThresholdM) {
                $overlaps++;
                break;
            }
        }
    }

    return $count > 0 ? $overlaps / $count : 0.0;
}

function nr_rt_route_quality_ok(array $route, float $targetDistanceKm, string $level = 'strict'): bool
{
    $score = nr_rt_candidate_score($route, $targetDistanceKm, (string) ($route['profil'] ?? 'natur'));

    // last_resort und fallback dürfen Start/Ende auf gleicher Straße haben (z. B. lange Allee).
    // strict/relaxed verlangen verschiedene Straßen — typisches Zeichen für „echten“ Rundkurs.
    $maxSameStreetPenalty = ($level === 'fallback' || $level === 'last_resort') ? 1 : 0;
    if ($score['same_street_penalty'] > $maxSameStreetPenalty) {
        return false;
    }
    // Spike direkt am Start/Ende ist immer ein Ausschluss — Rundkurs darf nicht „aus der Sackgasse heraus“ starten.
    if ($score['start_end_spike_penalty'] > 0 && $level !== 'last_resort') {
        return false;
    }

    // last_resort = breiter Floor: nur echte Schrottrouten ablehnen. Realistische ländliche
    // Wegenetze haben oft 50–60 % Hin-/Rückweg-Identität, das ist noch ein gültiger Rundkurs.
    if ($level === 'last_resort') {
        return $score['dead_end_spike_ratio'] <= 0.07
            && $score['self_overlap_ratio'] <= 0.32
            && $score['overlap_ratio'] <= 0.78
            && $score['distance_ratio_delta'] <= 1.20;
    }

    if ($level === 'fallback') {
        return $score['dead_end_spike_ratio'] <= 0.028
            && $score['self_overlap_ratio'] <= 0.16
            && $score['overlap_ratio'] <= 0.62
            && $score['distance_ratio_delta'] <= 0.85;
    }

    if ($level === 'relaxed') {
        return $score['dead_end_spike_ratio'] <= 0.016
            && $score['self_overlap_ratio'] <= 0.09
            && $score['overlap_ratio'] <= 0.5
            && $score['distance_ratio_delta'] <= 0.68;
    }

    return $score['dead_end_spike_ratio'] <= 0.009
        && $score['self_overlap_ratio'] <= 0.07
        && $score['overlap_ratio'] <= 0.42
        && $score['distance_ratio_delta'] <= 0.6;
}

function nr_rt_attach_quality_meta(array $route, string $qualityLevel, float $targetDistanceKm): array
{
    $score = nr_rt_candidate_score($route, $targetDistanceKm, (string) ($route['profil'] ?? 'natur'));
    $route['roundtrip_quality'] = $qualityLevel;
    $route['roundtrip_quality_metrics'] = [
        'same_street_penalty' => $score['same_street_penalty'],
        'start_end_spike_penalty' => $score['start_end_spike_penalty'],
        'spike_count' => $score['spike_count'],
        'profile_style_delta' => round($score['profile_style_delta'], 4),
        'dead_end_spike_ratio' => round($score['dead_end_spike_ratio'], 4),
        'self_overlap_ratio' => round($score['self_overlap_ratio'], 4),
        'start_end_overlap_ratio' => round($score['overlap_ratio'], 4),
        'distance_ratio_delta' => round($score['distance_ratio_delta'], 4),
    ];

    return $route;
}

/**
 * @param list<array{0: float, 1: float}> $geometry
 */
function nr_rt_start_end_overlap_ratio(array $geometry, float $windowM): float
{
    if (count($geometry) < 4) {
        return 1.0;
    }

    $forward = nr_rt_sample_polyline($geometry, $windowM, false, 35.0);
    $backward = nr_rt_sample_polyline($geometry, $windowM, true, 35.0);
    $count = min(count($forward), count($backward));
    if ($count <= 0) {
        return 1.0;
    }

    $matches = 0;
    for ($i = 0; $i < $count; $i++) {
        if (nr_rt_haversine_m($forward[$i][0], $forward[$i][1], $backward[$i][0], $backward[$i][1]) <= 32.0) {
            $matches++;
        }
    }

    return $matches / $count;
}

/**
 * @param list<array<string, mixed>> $steps
 */
function nr_rt_same_street_penalty(array $steps): int
{
    $firstStreet = '';
    $lastStreet = '';

    foreach ($steps as $step) {
        $street = isset($step['street']) && is_string($step['street']) ? trim($step['street']) : '';
        $distanceM = isset($step['step_distance_m']) ? (float) $step['step_distance_m'] : 0.0;
        if ($street !== '' && $distanceM >= 20.0) {
            $firstStreet = mb_strtolower($street);
            break;
        }
    }

    for ($i = count($steps) - 1; $i >= 0; $i--) {
        $step = $steps[$i];
        $street = isset($step['street']) && is_string($step['street']) ? trim($step['street']) : '';
        $distanceM = isset($step['step_distance_m']) ? (float) $step['step_distance_m'] : 0.0;
        if ($street !== '' && $distanceM >= 20.0) {
            $lastStreet = mb_strtolower($street);
            break;
        }
    }

    return ($firstStreet !== '' && $firstStreet === $lastStreet) ? 1 : 0;
}

/**
 * @param list<array{0: float, 1: float}> $geometry
 * @return list<array{0: float, 1: float}>
 */
function nr_rt_sample_polyline(array $geometry, float $windowM, bool $reverse, float $stepM): array
{
    $points = $reverse ? array_reverse($geometry) : $geometry;
    $samples = [];
    $covered = 0.0;
    $target = 0.0;

    $samples[] = [$points[0][0], $points[0][1]];
    for ($i = 1, $n = count($points); $i < $n && $covered < $windowM; $i++) {
        $a = $points[$i - 1];
        $b = $points[$i];
        $segM = nr_rt_haversine_m($a[0], $a[1], $b[0], $b[1]);
        if ($segM <= 0.01) {
            continue;
        }

        while ($target + $stepM <= min($windowM, $covered + $segM)) {
            $target += $stepM;
            $t = ($target - $covered) / $segM;
            $samples[] = [
                $a[0] + ($b[0] - $a[0]) * $t,
                $a[1] + ($b[1] - $a[1]) * $t,
            ];
        }

        $covered += $segM;
    }

    return $samples;
}

/**
 * @param list<array{0: float, 1: float}> $geometry
 * @return list<array{0: float, 1: float, 2: float}>
 */
function nr_rt_sample_polyline_with_distance(array $geometry, float $stepM): array
{
    if ($geometry === []) {
        return [];
    }

    $samples = [[$geometry[0][0], $geometry[0][1], 0.0]];
    $covered = 0.0;
    $target = 0.0;

    for ($i = 1, $n = count($geometry); $i < $n; $i++) {
        $a = $geometry[$i - 1];
        $b = $geometry[$i];
        $segM = nr_rt_haversine_m($a[0], $a[1], $b[0], $b[1]);
        if ($segM <= 0.01) {
            continue;
        }

        while ($target + $stepM <= $covered + $segM) {
            $target += $stepM;
            $t = ($target - $covered) / $segM;
            $samples[] = [
                $a[0] + ($b[0] - $a[0]) * $t,
                $a[1] + ($b[1] - $a[1]) * $t,
                $target,
            ];
        }

        $covered += $segM;
    }

    return $samples;
}

function nr_rt_haversine_m(float $lat1, float $lon1, float $lat2, float $lon2): float
{
    $earth = 6371000.0;
    $p1 = deg2rad($lat1);
    $p2 = deg2rad($lat2);
    $dphi = deg2rad($lat2 - $lat1);
    $dlambda = deg2rad($lon2 - $lon1);
    $a = sin($dphi / 2) ** 2 + cos($p1) * cos($p2) * sin($dlambda / 2) ** 2;

    return 2 * $earth * atan2(sqrt($a), sqrt(max(0.0, 1 - $a)));
}

/**
 * @param list<array{0: float, 1: float}> $geometry
 */
function nr_rt_polyline_length_m(array $geometry): float
{
    $total = 0.0;
    for ($i = 1, $n = count($geometry); $i < $n; $i++) {
        $a = $geometry[$i - 1];
        $b = $geometry[$i];
        $total += nr_rt_haversine_m($a[0], $a[1], $b[0], $b[1]);
    }

    return $total;
}

function nr_rt_clamp(float $value, float $min, float $max): float
{
    return max($min, min($max, $value));
}
