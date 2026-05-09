<?php

declare(strict_types=1);

require_once __DIR__ . '/geo_wgs84.php';

/**
 * Sackgassen-Avoid-Polygone für Rundkurs-Routing.
 *
 * Workflow:
 *   1. Overpass nach `noexit=yes`-Wegen in einer BBox um den Startpunkt fragen.
 *   2. Pro Sackgasse die Polylinie zu einem Bounding-Box-Polygon mit Buffer puffern
 *      (eckiger Approx — reicht, weil Sackgassen meist kurz und annähernd linear sind).
 *   3. Alle Polygone zu einem GeoJSON-MultiPolygon (lon/lat) zusammenfassen.
 *
 * Das Ergebnis kann direkt als `options.avoid_polygons` an ORS gehängt werden — ORS
 * routet dann gar nicht erst durch die Sackgassen.
 */

const NR_DEAD_END_AVOID_OVERPASS_TIMEOUT_S = 38;
const NR_DEAD_END_AVOID_BUFFER_M = 14.0;
const NR_DEAD_END_AVOID_MAX_BBOX_SPAN_DEG = 0.45;
const NR_DEAD_END_AVOID_CACHE_TTL_S = 1800;
const NR_DEAD_END_AVOID_MAX_POLYGONS = 250;

/**
 * @return array<string, mixed>|null GeoJSON MultiPolygon oder null wenn keine Sackgassen / Bereich zu groß / Overpass nicht erreichbar
 */
function nr_dead_end_polygons_for_circle(float $lat, float $lon, float $radiusM, float $bufferM = NR_DEAD_END_AVOID_BUFFER_M): ?array
{
    if ($radiusM <= 0 || !is_finite($lat) || !is_finite($lon)) {
        return null;
    }

    // Etwas Puffer um den Routing-Kreis, weil ORS Wege jenseits des Radius mitnehmen kann.
    $bboxRadiusM = $radiusM * 1.18 + 250.0;

    $north = nr_geo_destination_sphere_m($lat, $lon, $bboxRadiusM, 0.0);
    $south = nr_geo_destination_sphere_m($lat, $lon, $bboxRadiusM, 180.0);
    $east = nr_geo_destination_sphere_m($lat, $lon, $bboxRadiusM, 90.0);
    $west = nr_geo_destination_sphere_m($lat, $lon, $bboxRadiusM, 270.0);

    $south_lat = $south[0];
    $north_lat = $north[0];
    $west_lon = $west[1];
    $east_lon = $east[1];

    $latSpan = $north_lat - $south_lat;
    $lonSpan = $east_lon - $west_lon;
    if ($latSpan <= 0 || $lonSpan <= 0 || $latSpan > NR_DEAD_END_AVOID_MAX_BBOX_SPAN_DEG || $lonSpan > NR_DEAD_END_AVOID_MAX_BBOX_SPAN_DEG) {
        // Zu großer Bereich (z. B. 100-km-Rundkurs) — Overpass würde das ablehnen oder ewig brauchen.
        return null;
    }

    $cachePayload = [
        'v' => 1,
        's' => round($south_lat, 4),
        'w' => round($west_lon, 4),
        'n' => round($north_lat, 4),
        'e' => round($east_lon, 4),
        'b' => round($bufferM, 1),
    ];
    $cacheKey = 'dead_end_avoid_' . hash('sha256', json_encode($cachePayload, JSON_THROW_ON_ERROR));
    $cacheFile = dirname(__DIR__) . '/cache/' . $cacheKey . '.json';
    if (is_readable($cacheFile) && (time() - filemtime($cacheFile)) < NR_DEAD_END_AVOID_CACHE_TTL_S) {
        $cached = file_get_contents($cacheFile);
        if ($cached !== false) {
            try {
                $decoded = json_decode($cached, true, 512, JSON_THROW_ON_ERROR);
                if (is_array($decoded) && isset($decoded['type']) && $decoded['type'] === 'MultiPolygon') {
                    return $decoded;
                }
                if ($decoded === null || $decoded === [] || (is_array($decoded) && ($decoded['empty'] ?? false))) {
                    return null;
                }
            } catch (JsonException) {
                // Cache ungültig — neu fetchen.
            }
        }
    }

    $ways = nr_dead_end_fetch_overpass_ways($south_lat, $west_lon, $north_lat, $east_lon);
    if ($ways === null) {
        return null;
    }
    if ($ways === []) {
        if (is_dir(dirname($cacheFile))) {
            @file_put_contents($cacheFile, json_encode(['empty' => true]), LOCK_EX);
        }
        return null;
    }

    $polygons = nr_dead_end_polygons_from_ways($ways, $bufferM);
    if ($polygons === []) {
        if (is_dir(dirname($cacheFile))) {
            @file_put_contents($cacheFile, json_encode(['empty' => true]), LOCK_EX);
        }
        return null;
    }

    $multi = [
        'type' => 'MultiPolygon',
        'coordinates' => $polygons,
    ];
    if (is_dir(dirname($cacheFile))) {
        @file_put_contents($cacheFile, json_encode($multi, JSON_UNESCAPED_UNICODE), LOCK_EX);
    }

    return $multi;
}

/**
 * @return list<list<array{0: float, 1: float}>>|null Polylinien (Lat, Lon) oder null bei Netzwerkfehler
 */
function nr_dead_end_fetch_overpass_ways(float $south, float $west, float $north, float $east): ?array
{
    $cfg = function_exists('nr_config') ? nr_config() : [];
    $overpassUrl = 'https://overpass-api.de/api/interpreter';
    if (is_array($cfg) && isset($cfg['overpass']['interpreter_url']) && is_string($cfg['overpass']['interpreter_url'])) {
        $u = trim($cfg['overpass']['interpreter_url']);
        if ($u !== '') {
            $overpassUrl = $u;
        }
    }

    $query = '[out:json][timeout:38];'
        . 'way["highway"]["noexit"~"^(yes|1)$",i](' . $south . ',' . $west . ',' . $north . ',' . $east . ');'
        . 'out geom;'
        . 'node["noexit"~"^(yes|1)$",i](' . $south . ',' . $west . ',' . $north . ',' . $east . ');'
        . 'way(bn)["highway"];'
        . 'out geom;';

    $ch = curl_init($overpassUrl);
    if ($ch === false) {
        return null;
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => 'data=' . rawurlencode($query),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => NR_DEAD_END_AVOID_OVERPASS_TIMEOUT_S,
        CURLOPT_USERAGENT => 'NatureRideNavigator/2.6 (dead-end-avoid)',
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $code >= 400) {
        return null;
    }
    try {
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        return null;
    }
    if (!is_array($decoded) || !isset($decoded['elements']) || !is_array($decoded['elements'])) {
        return [];
    }

    $ways = [];
    $seen = [];
    foreach ($decoded['elements'] as $el) {
        if (!is_array($el) || ($el['type'] ?? '') !== 'way') {
            continue;
        }
        $wid = isset($el['id']) ? (int) $el['id'] : 0;
        if ($wid > 0 && isset($seen[$wid])) {
            continue;
        }
        if ($wid > 0) {
            $seen[$wid] = true;
        }
        $geom = $el['geometry'] ?? null;
        if (!is_array($geom) || count($geom) < 2) {
            continue;
        }
        $coords = [];
        foreach ($geom as $pt) {
            if (!is_array($pt)) {
                continue;
            }
            $plat = isset($pt['lat']) ? (float) $pt['lat'] : null;
            $plon = isset($pt['lon']) ? (float) $pt['lon'] : null;
            if ($plat === null || $plon === null || !is_finite($plat) || !is_finite($plon)) {
                continue;
            }
            $coords[] = [$plat, $plon];
        }
        if (count($coords) >= 2) {
            $ways[] = $coords;
        }
    }

    return $ways;
}

/**
 * Pro Polylinie ein achsenausgerichtetes Bounding-Box-Polygon mit Buffer (lokal in Metern).
 * Der Buffer ist großzügig genug, um ORS-Vertex-Snap-Versatz aufzufangen, aber klein genug,
 * dass parallel verlaufende Hauptstraßen nicht eingeschlossen werden.
 *
 * @param list<list<array{0: float, 1: float}>> $ways  Polylinien (Lat, Lon)
 * @return list<list<list<array{0: float, 1: float}>>> Polygone (lon/lat) für GeoJSON MultiPolygon
 */
function nr_dead_end_polygons_from_ways(array $ways, float $bufferM): array
{
    $polygons = [];
    foreach ($ways as $way) {
        if (!is_array($way) || count($way) < 2) {
            continue;
        }
        $minLat = $maxLat = $way[0][0];
        $minLon = $maxLon = $way[0][1];
        foreach ($way as $pt) {
            if ($pt[0] < $minLat) {
                $minLat = $pt[0];
            }
            if ($pt[0] > $maxLat) {
                $maxLat = $pt[0];
            }
            if ($pt[1] < $minLon) {
                $minLon = $pt[1];
            }
            if ($pt[1] > $maxLon) {
                $maxLon = $pt[1];
            }
        }
        $midLat = ($minLat + $maxLat) / 2.0;
        $latPerM = 1.0 / 111320.0;
        $lonPerM = 1.0 / max(1.0, 111320.0 * cos(deg2rad($midLat)));
        $bufLat = $bufferM * $latPerM;
        $bufLon = $bufferM * $lonPerM;
        $south = $minLat - $bufLat;
        $north = $maxLat + $bufLat;
        $west = $minLon - $bufLon;
        $east = $maxLon + $bufLon;
        // GeoJSON: [lon, lat], Ring im Uhrzeigersinn geschlossen.
        $ring = [
            [$west, $south],
            [$east, $south],
            [$east, $north],
            [$west, $north],
            [$west, $south],
        ];
        $polygons[] = [$ring];
        if (count($polygons) >= NR_DEAD_END_AVOID_MAX_POLYGONS) {
            break;
        }
    }

    return $polygons;
}
