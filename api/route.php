<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/OpenRouteService.php';
require dirname(__DIR__) . '/includes/OrsExtras.php';
require dirname(__DIR__) . '/includes/route_geojson.php';
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
    $isLoopFromWaypoints = !empty($input['loop_from_waypoints']);
    $points = nr_parse_route_request($input);
    $profil = nr_normalize_profil($input['profil'] ?? 'natur');
    $maxDetourKm = $isLoopFromWaypoints ? null : nr_normalize_max_detour_km($input['max_detour_km'] ?? null);
    $loopWaypointExtras = nr_loop_waypoint_response_extras($input);
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

$cachePayload = [
    'user_id' => (int) $user['id'],
    'ors_key_hash' => hash('sha256', $apiKey),
    'base_url' => $baseUrl,
    'p' => $points,
    'profil' => $profil,
];
if ($maxDetourKm !== null) {
    $cachePayload['max_detour_km'] = $maxDetourKm;
}
$cacheKey = 'route_ors_user_v1_' . hash('sha256', json_encode($cachePayload, JSON_THROW_ON_ERROR));
$cacheFile = dirname(__DIR__) . '/cache/' . $cacheKey . '.json';
$ttl = 21600;

if (is_readable($cacheFile) && (time() - filemtime($cacheFile)) < $ttl) {
    $cached = file_get_contents($cacheFile);
    if ($cached !== false) {
        header('X-Cache: HIT');
        header('Content-Type: application/json; charset=utf-8');
        echo $cached;
        exit;
    }
}

header('X-Cache: MISS');

try {
    $ors = new OpenRouteService($baseUrl, $apiKey);
    if ($isLoopFromWaypoints) {
        // Wegpunkte-Rundkurs: alle Wegpunkte in Reihenfolge verbinden (Segment-Routing).
        $orsMeta = $ors->routeWaypointsLoopWithMeta($points, $profil);
    } else {
        $orsMeta = $ors->routeWithMeta($points, $profil, $maxDetourKm, false);
    }
    $geojson = $orsMeta['geojson'];
    $detourCapped = (bool) ($orsMeta['detour_capped'] ?? false);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 502);
    exit;
}

try {
    $out = nr_build_client_route_from_geojson($geojson, $profil, $maxDetourKm, $detourCapped, $loopWaypointExtras);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => 'Routendaten konnten nicht verarbeitet werden: ' . $e->getMessage()], 502);
    exit;
}

$encoded = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
if (is_dir(dirname($cacheFile))) {
    @file_put_contents($cacheFile, $encoded, LOCK_EX);
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
echo $encoded;

/**
 * @param array<string, mixed> $input
 * @return array<string, mixed>
 */
function nr_loop_waypoint_response_extras(array $input): array
{
    if (empty($input['loop_from_waypoints'])) {
        return [];
    }

    return [
        'roundtrip_mode' => 'waypoints_loop',
    ];
}

/**
 * Geschlossene Rundtour: 3–10 Nutzerpunkte in Reihenfolge (erster = Start),
 * Rückkehr zum Startpunkt per Routing (letzter Routing-Punkt = erster).
 *
 * @param mixed $waypoints
 * @return list<array{0: float, 1: float}>
 */
function nr_parse_loop_waypoints_coordinates(mixed $waypoints): array
{
    if (!is_array($waypoints)) {
        throw new RuntimeException('waypoints als Liste von [lat, lon] angeben.');
    }
    $n = count($waypoints);
    if ($n < 3 || $n > 10) {
        throw new RuntimeException('Zwischen 3 und 10 Wegpunkte für den Rundkurs angeben.');
    }

    $pts = [];
    foreach ($waypoints as $row) {
        if (!is_array($row) || count($row) < 2) {
            throw new RuntimeException('Ungültiger Wegpunkt.');
        }
        $pts[] = nr_pair($row[0], $row[1]);
    }

    $first = $pts[0];
    $last = $pts[count($pts) - 1];
    if (
        count($pts) >= 2
        && abs($first[0] - $last[0]) < 1e-7
        && abs($first[1] - $last[1]) < 1e-7
    ) {
        array_pop($pts);
    }
    if (count($pts) < 3) {
        throw new RuntimeException('Mindestens drei verschiedene Wegpunkte für den Rundkurs.');
    }

    $pts[] = $pts[0];

    return $pts;
}

/**
 * @param array<string, mixed> $input
 * @return list<array{0: float, 1: float}>
 */
function nr_parse_route_request(array $input): array
{
    if (!empty($input['loop_from_waypoints'])) {
        return nr_parse_loop_waypoints_coordinates($input['waypoints'] ?? null);
    }

    $start = $input['start'] ?? null;
    $ziel = $input['ziel'] ?? null;
    if (!is_array($start) || count($start) < 2 || !is_array($ziel) || count($ziel) < 2) {
        throw new RuntimeException('start und ziel als [lat, lon] angeben.');
    }

    $pts = [nr_pair($start[0], $start[1])];

    $via = $input['via'] ?? null;
    if (is_array($via)) {
        if (count($via) > 8) {
            throw new RuntimeException('Maximal 8 Zwischenpunkte.');
        }
        foreach ($via as $v) {
            if (!is_array($v) || count($v) < 2) {
                throw new RuntimeException('Ungültiger Zwischenpunkt.');
            }
            $pts[] = nr_pair($v[0], $v[1]);
        }
    }

    $pts[] = nr_pair($ziel[0], $ziel[1]);

    return $pts;
}

/**
 * @return array{0: float, 1: float}
 */
function nr_pair(mixed $lat, mixed $lon): array
{
    $la = (float) $lat;
    $lo = (float) $lon;
    if ($la < -90 || $la > 90 || $lo < -180 || $lo > 180) {
        throw new RuntimeException('Koordinaten außerhalb des gültigen Bereichs.');
    }

    return [$la, $lo];
}

function nr_normalize_profil(mixed $p): string
{
    $s = is_string($p) ? strtolower(trim($p)) : 'natur';
    $allowed = ['natur', 'gravel', 'offroad', 'kurvig', 'ruhig', 'abenteuer', 'radwege'];
    if (!in_array($s, $allowed, true)) {
        return 'natur';
    }

    return $s;
}

/** null = keine Begrenzung; sonst erlaubte Mehr-Distanz vs. ORS-„schnell“-Referenz (km). */
function nr_normalize_max_detour_km(mixed $v): ?float
{
    if ($v === null || $v === '' || $v === false) {
        return null;
    }
    if (!is_numeric($v)) {
        return null;
    }
    $f = (float) $v;
    if ($f <= 0 || $f >= 500) {
        return null;
    }

    return round(min(150.0, max(0.05, $f)), 2);
}
