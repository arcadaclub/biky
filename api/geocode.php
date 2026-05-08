<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();
nr_json_require_user();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    nr_json_response(['ok' => false, 'error' => 'Nur GET erlaubt.'], 405);
    exit;
}

if (!nr_geocode_rate_limit_ok(nr_client_ip())) {
    nr_json_response(['ok' => false, 'error' => 'Zu viele Suchanfragen. Bitte später erneut versuchen.'], 429);
    exit;
}

$latRev = $_GET['lat'] ?? null;
$lonRev = $_GET['lon'] ?? null;
if ($latRev !== null && $lonRev !== null && is_string($latRev) && is_string($lonRev) && is_numeric($latRev) && is_numeric($lonRev)) {
    $la = (float) $latRev;
    $lo = (float) $lonRev;
    if ($la < -90.0 || $la > 90.0 || $lo < -180.0 || $lo > 180.0) {
        nr_json_response(['ok' => false, 'error' => 'Ungültige Koordinaten.'], 400);
        exit;
    }

    $cfg = nr_config();
    $nomi = $cfg['nominatim'] ?? [];
    $base = is_array($nomi) ? rtrim((string) ($nomi['base_url'] ?? 'https://nominatim.openstreetmap.org'), '/') : 'https://nominatim.openstreetmap.org';
    $contact = is_array($nomi) ? trim((string) ($nomi['contact'] ?? '')) : '';
    if ($contact === '') {
        $contact = 'https://github.com/';
    }

    $params = [
        'format' => 'jsonv2',
        'lat' => (string) $la,
        'lon' => (string) $lo,
        'addressdetails' => '1',
    ];
    $url = $base . '/reverse?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

    $ch = curl_init($url);
    if ($ch === false) {
        nr_json_response(['ok' => false, 'error' => 'Suchdienst nicht erreichbar.'], 500);
        exit;
    }

    $userAgent = 'NatureRideNavigator/1.0 (' . $contact . ')';
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'Accept-Language: de',
        ],
        CURLOPT_USERAGENT => $userAgent,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_FOLLOWLOCATION => true,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $code >= 400) {
        nr_json_response(['ok' => false, 'error' => 'Adresse zu den Koordinaten konnte nicht ermittelt werden.'], 502);
        exit;
    }

    /** @var mixed $json */
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        nr_json_response(['ok' => false, 'error' => 'Ungültige Antwort vom Suchdienst.'], 502);
        exit;
    }

    $addr = $json['address'] ?? null;
    $addr = is_array($addr) ? $addr : [];
    $road = isset($addr['road']) && is_string($addr['road']) ? $addr['road'] : '';
    $hn = isset($addr['house_number']) && is_string($addr['house_number']) ? $addr['house_number'] : '';
    $streetGuess = trim($road . ($hn !== '' ? ' ' . $hn : ''));
    $placeGuess = '';
    foreach (['city', 'town', 'village', 'municipality', 'city_district', 'suburb'] as $k) {
        if (!empty($addr[$k]) && is_string($addr[$k])) {
            $placeGuess = $addr[$k];
            break;
        }
    }
    if ($placeGuess === '' && !empty($addr['county']) && is_string($addr['county'])) {
        $placeGuess = $addr['county'];
    }

    $label = isset($json['display_name']) && is_string($json['display_name'])
        ? $json['display_name']
        : ($placeGuess !== '' ? $placeGuess : (string) $la . ', ' . (string) $lo);

    nr_json_response([
        'ok' => true,
        'reverse' => true,
        'results' => [
            [
                'lat' => $la,
                'lon' => $lo,
                'label' => $label,
                'place' => $placeGuess,
                'street' => $streetGuess,
            ],
        ],
        'query' => 'reverse:' . $la . ',' . $lo,
    ]);
    exit;
}

$place = isset($_GET['place']) && is_string($_GET['place']) ? trim($_GET['place']) : '';
$street = isset($_GET['street']) && is_string($_GET['street']) ? trim($_GET['street']) : '';
$qRaw = isset($_GET['q']) && is_string($_GET['q']) ? trim($_GET['q']) : '';

if ($qRaw !== '') {
    $query = $qRaw;
} else {
    $parts = array_filter([$street, $place], static fn (string $s): bool => $s !== '');
    $query = implode(', ', $parts);
}

if (mb_strlen($query) < 3) {
    nr_json_response(['ok' => false, 'error' => 'Bitte Ort und/oder Straße eingeben (mind. 3 Zeichen).'], 400);
    exit;
}

if (mb_strlen($query) > 250) {
    nr_json_response(['ok' => false, 'error' => 'Suchbegriff zu lang.'], 400);
    exit;
}

$cfg = nr_config();
$nomi = $cfg['nominatim'] ?? [];
$base = is_array($nomi) ? rtrim((string) ($nomi['base_url'] ?? 'https://nominatim.openstreetmap.org'), '/') : 'https://nominatim.openstreetmap.org';
$contact = is_array($nomi) ? trim((string) ($nomi['contact'] ?? '')) : '';
if ($contact === '') {
    $contact = 'https://github.com/';
}
$country = is_array($nomi) ? trim((string) ($nomi['countrycodes'] ?? 'de')) : 'de';

$params = [
    'format' => 'jsonv2',
    'limit' => '8',
    'q' => $query,
    'addressdetails' => '1',
];
if ($country !== '') {
    $params['countrycodes'] = strtolower($country);
}

$url = $base . '/search?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

$ch = curl_init($url);
if ($ch === false) {
    nr_json_response(['ok' => false, 'error' => 'Suchdienst nicht erreichbar.'], 500);
    exit;
}

$userAgent = 'NatureRideNavigator/1.0 (' . $contact . ')';
curl_setopt_array($ch, [
    CURLOPT_HTTPHEADER => [
        'Accept: application/json',
        'Accept-Language: de',
    ],
    CURLOPT_USERAGENT => $userAgent,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_FOLLOWLOCATION => true,
]);
$raw = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($raw === false || $code >= 400) {
    nr_json_response(['ok' => false, 'error' => 'Geocoding fehlgeschlagen.'], 502);
    exit;
}

/** @var mixed $json */
$json = json_decode($raw, true);
if (!is_array($json)) {
    nr_json_response(['ok' => false, 'error' => 'Ungültige Antwort vom Suchdienst.'], 502);
    exit;
}

$results = [];
foreach ($json as $row) {
    if (!is_array($row)) {
        continue;
    }
    $lat = isset($row['lat']) ? (float) $row['lat'] : null;
    $lon = isset($row['lon']) ? (float) $row['lon'] : null;
    if ($lat === null || $lon === null || ($lat === 0.0 && $lon === 0.0)) {
        continue;
    }
    $label = isset($row['display_name']) && is_string($row['display_name'])
        ? $row['display_name']
        : ($query);
    $results[] = [
        'lat' => $lat,
        'lon' => $lon,
        'label' => $label,
    ];
}

nr_json_response([
    'ok' => true,
    'results' => $results,
    'query' => $query,
]);

/**
 * Strengeres Rate-Limit nur für Geocoding (Nominatim Fair-Use).
 */
function nr_geocode_rate_limit_ok(string $ip): bool
{
    $cfg = nr_config();
    $gl = $cfg['geocode_rate_limit'] ?? [];
    $max = (int) ($gl['max_requests'] ?? 45);
    $window = (int) ($gl['window_seconds'] ?? 3600);
    $dir = dirname(__DIR__) . '/cache';
    if (!is_dir($dir)) {
        return true;
    }
    $safeIp = preg_replace('/[^a-f0-9.:]/i', '', $ip) ?: 'unknown';
    $file = $dir . '/ratelimit_geocode_' . hash('sha256', $safeIp) . '.json';
    $now = time();
    $data = ['count' => 0, 'reset' => $now + $window];
    if (is_readable($file)) {
        $raw = file_get_contents($file);
        if ($raw !== false) {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $data = array_merge($data, $decoded);
            }
        }
    }
    if ($now > (int) ($data['reset'] ?? 0)) {
        $data = ['count' => 0, 'reset' => $now + $window];
    }
    $data['count'] = (int) ($data['count'] ?? 0) + 1;
    file_put_contents($file, json_encode($data), LOCK_EX);

    return $data['count'] <= $max;
}
