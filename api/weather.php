<?php
declare(strict_types=1);

// Simple same-origin proxy for Brightsky weather (avoids CORS/ORB issues on iOS/Safari).
// GET params: lat, lon, date (YYYY-MM-DD; optional, defaults to today)

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

function json_out(array $payload, int $status = 200): void {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$lat = isset($_GET['lat']) ? (float)$_GET['lat'] : null;
$lon = isset($_GET['lon']) ? (float)$_GET['lon'] : null;
$date = isset($_GET['date']) ? (string)$_GET['date'] : gmdate('Y-m-d');

if (!is_finite($lat) || !is_finite($lon)) {
    json_out(['ok' => false, 'error' => 'missing_lat_lon'], 400);
}

// Basic bounds check (keep it permissive).
if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
    json_out(['ok' => false, 'error' => 'invalid_lat_lon'], 400);
}

if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    json_out(['ok' => false, 'error' => 'invalid_date'], 400);
}

$qs = http_build_query([
    'lat' => $lat,
    'lon' => $lon,
    'date' => $date,
]);
$url = 'https://api.brightsky.dev/weather?' . $qs;

$ctx = stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 8,
        'header' => "Accept: application/json\r\nUser-Agent: biketour-weather-proxy/1.0\r\n",
    ],
    'ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true,
    ],
]);

$raw = @file_get_contents($url, false, $ctx);
if ($raw === false) {
    json_out(['ok' => false, 'error' => 'upstream_unreachable'], 502);
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    json_out(['ok' => false, 'error' => 'upstream_invalid_json'], 502);
}

json_out(['ok' => true, 'data' => $data]);

