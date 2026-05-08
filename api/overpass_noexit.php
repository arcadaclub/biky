<?php

declare(strict_types=1);

/**
 * OSM-Sackgassen-Hinweise: noexit am highway-Weg und/oder am Endknoten (BBox).
 * Proxy zu Overpass — vermeidet CORS; Cache + Rate-Limit.
 */

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    nr_json_response(['ok' => false, 'error' => 'Nur POST erlaubt.'], 405);
    exit;
}

nr_json_require_user();

$csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
if (!nr_verify_csrf(is_string($csrf) ? $csrf : null)) {
    nr_json_response(['ok' => false, 'error' => 'CSRF-Token ungültig.'], 403);
    exit;
}

if (!nr_rate_limit_ok(nr_client_ip())) {
    nr_json_response(['ok' => false, 'error' => 'Zu viele Anfragen.'], 429);
    exit;
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    nr_json_response(['ok' => false, 'error' => 'Leerer Request-Body.'], 400);
    exit;
}

try {
    /** @var mixed $payload */
    $payload = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException) {
    nr_json_response(['ok' => false, 'error' => 'Ungültiges JSON.'], 400);
    exit;
}

if (!is_array($payload)) {
    nr_json_response(['ok' => false, 'error' => 'Ungültige Anfrage.'], 400);
    exit;
}

$s = isset($payload['south']) ? (float) $payload['south'] : NAN;
$w = isset($payload['west']) ? (float) $payload['west'] : NAN;
$n = isset($payload['north']) ? (float) $payload['north'] : NAN;
$e = isset($payload['east']) ? (float) $payload['east'] : NAN;

if (!is_finite($s) || !is_finite($w) || !is_finite($n) || !is_finite($e)) {
    nr_json_response(['ok' => false, 'error' => 'Ungültige Koordinaten.'], 400);
    exit;
}

if ($s < -85.0 || $n > 85.0 || $w < -180.0 || $e > 180.0 || $s >= $n || $w >= $e) {
    nr_json_response(['ok' => false, 'error' => 'Ungültiger Kartenausschnitt.'], 400);
    exit;
}

$latSpan = $n - $s;
$lonSpan = $e - $w;
if ($latSpan > 0.16 || $lonSpan > 0.22) {
    nr_json_response([
        'ok' => false,
        'error' => 'Ausschnitt zu groß — bitte näher zoomen (nur kleinere Bereiche werden abgefragt).',
    ], 400);
    exit;
}

$cfg = nr_config();
$overpassUrl = 'https://overpass-api.de/api/interpreter';
if (isset($cfg['overpass']['interpreter_url']) && is_string($cfg['overpass']['interpreter_url'])) {
    $u = trim($cfg['overpass']['interpreter_url']);
    if ($u !== '') {
        $overpassUrl = $u;
    }
}

$cachePayload = [
    'v' => 2,
    's' => round($s, 4),
    'w' => round($w, 4),
    'n' => round($n, 4),
    'e' => round($e, 4),
];
$cacheKey = 'overpass_noexit_' . hash('sha256', json_encode($cachePayload, JSON_THROW_ON_ERROR));
$cacheFile = dirname(__DIR__) . '/cache/' . $cacheKey . '.json';
$ttl = 900;

if (is_readable($cacheFile) && (time() - filemtime($cacheFile)) < $ttl) {
    $cached = file_get_contents($cacheFile);
    if ($cached !== false) {
        header('X-Cache: HIT');
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        echo $cached;
        exit;
    }
}

// noexit=yes liegt oft nur auf dem Endknoten, nicht auf dem gesamten way → node + way(bn) ergänzen.
// Regex: yes/1, case-insensitive (Overpass ",i")
$query = '[out:json][timeout:45];'
    . 'way["highway"]["noexit"~"^(yes|1)$",i](' . $s . ',' . $w . ',' . $n . ',' . $e . ');'
    . 'out geom;'
    . 'node["noexit"~"^(yes|1)$",i](' . $s . ',' . $w . ',' . $n . ',' . $e . ');'
    . 'way(bn)["highway"];'
    . 'out geom;';

$ch = curl_init($overpassUrl);
if ($ch === false) {
    nr_json_response(['ok' => false, 'error' => 'Netzwerk konnte nicht initialisiert werden.'], 500);
    exit;
}

curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => 'data=' . rawurlencode($query),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/x-www-form-urlencoded',
        'Accept: application/json',
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 38,
    CURLOPT_USERAGENT => 'NatureRideNavigator/1.0 (https://github.com/)',
]);

$rawResp = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($rawResp === false) {
    nr_json_response(['ok' => false, 'error' => 'Overpass nicht erreichbar.'], 502);
    exit;
}

try {
    /** @var mixed $decoded */
    $decoded = json_decode($rawResp, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException) {
    nr_json_response(['ok' => false, 'error' => 'Overpass-Antwort ist kein gültiges JSON.'], 502);
    exit;
}

if ($code >= 400) {
    $hint = '';
    if (is_array($decoded) && isset($decoded['remark']) && is_string($decoded['remark'])) {
        $hint = ': ' . trim($decoded['remark']);
    }
    nr_json_response(['ok' => false, 'error' => 'Overpass-Fehler (HTTP ' . $code . ')' . $hint], 502);
    exit;
}

if (!is_array($decoded) || !isset($decoded['elements']) || !is_array($decoded['elements'])) {
    $out = ['ok' => true, 'ways' => [], 'count' => 0, 'source' => 'OpenStreetMap noexit (way+node)'];
    $encoded = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    header('X-Cache: MISS');
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo $encoded;
    exit;
}

$waysOut = [];
$seenWayIds = [];
foreach ($decoded['elements'] as $el) {
    if (!is_array($el) || ($el['type'] ?? '') !== 'way') {
        continue;
    }
    $wid = isset($el['id']) ? (int) $el['id'] : 0;
    if ($wid > 0 && isset($seenWayIds[$wid])) {
        continue;
    }
    if ($wid > 0) {
        $seenWayIds[$wid] = true;
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
        $lat = isset($pt['lat']) ? (float) $pt['lat'] : null;
        $lon = isset($pt['lon']) ? (float) $pt['lon'] : null;
        if ($lat === null || $lon === null || !is_finite($lat) || !is_finite($lon)) {
            continue;
        }
        $coords[] = [$lat, $lon];
    }
    if (count($coords) >= 2) {
        $waysOut[] = ['coordinates' => $coords];
    }
}

$out = [
    'ok' => true,
    'ways' => $waysOut,
    'count' => count($waysOut),
    'source' => 'OpenStreetMap noexit (way+node)',
];

$encoded = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
if (is_dir(dirname($cacheFile))) {
    @file_put_contents($cacheFile, $encoded, LOCK_EX);
}

header('X-Cache: MISS');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
echo $encoded;
