<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Nur POST erlaubt.';
    exit;
}

if (nr_auth_current_user() === null) {
    http_response_code(401);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Bitte zuerst anmelden.';
    exit;
}

$csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
if (!nr_verify_csrf(is_string($csrf) ? $csrf : null)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'CSRF-Token ungültig.';
    exit;
}

if (!nr_rate_limit_ok(nr_client_ip())) {
    http_response_code(429);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Rate limit.';
    exit;
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    http_response_code(400);
    echo 'Leerer Body.';
    exit;
}

try {
    /** @var mixed $data */
    $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $e) {
    http_response_code(400);
    echo 'Ungültiges JSON.';
    exit;
}

if (!is_array($data)) {
    http_response_code(400);
    exit;
}

$nameRaw = isset($data['name']) && is_string($data['name']) ? trim($data['name']) : 'NatureRide';
$nameRaw = mb_substr($nameRaw, 0, 120);
$nameRaw = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $nameRaw) ?? '';
if ($nameRaw === '') {
    $nameRaw = 'NatureRide';
}

$geometry = $data['geometry'] ?? null;
if (!is_array($geometry) || count($geometry) < 2) {
    http_response_code(400);
    echo 'geometry benötigt mindestens zwei Punkte.';
    exit;
}

if (count($geometry) > 20000) {
    http_response_code(400);
    echo 'Zu viele Punkte.';
    exit;
}

$now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$gpx = new DOMDocument('1.0', 'UTF-8');
$gpx->formatOutput = true;

$root = $gpx->createElementNS('http://www.topografix.com/GPX/1/1', 'gpx');
$root->setAttribute('version', '1.1');
$root->setAttribute('creator', 'NatureRide Navigator');
$root->setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
$root->setAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'xsi:schemaLocation', 'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd');
$gpx->appendChild($root);

$meta = $gpx->createElement('metadata');
$mn = $gpx->createElement('name');
$mn->appendChild($gpx->createTextNode($nameRaw));
$meta->appendChild($mn);
$mt = $gpx->createElement('time', $now->format('Y-m-d\TH:i:s\Z'));
$meta->appendChild($mt);
$root->appendChild($meta);

$trk = $gpx->createElement('trk');
$tn = $gpx->createElement('name');
$tn->appendChild($gpx->createTextNode($nameRaw));
$trk->appendChild($tn);
$seg = $gpx->createElement('trkseg');

$seq = 0;
foreach ($geometry as $geomIndex => $pt) {
    if (!is_array($pt) || count($pt) < 2) {
        continue;
    }
    $lat = (float) $pt[0];
    $lon = (float) $pt[1];
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        continue;
    }
    $tp = $gpx->createElement('trkpt');
    $tp->setAttribute('lat', (string) round($lat, 7));
    $tp->setAttribute('lon', (string) round($lon, 7));
    $t = $now->modify('+' . $seq . ' seconds');
    if ($t !== false) {
        $tim = $gpx->createElement('time', $t->format('Y-m-d\TH:i:s\Z'));
        $tp->appendChild($tim);
    }
    $seg->appendChild($tp);
    $seq++;
}

if ($seg->childNodes->length < 2) {
    http_response_code(400);
    echo 'Zu wenige gültige Koordinaten.';
    exit;
}

$trk->appendChild($seg);
$root->appendChild($trk);

$filename = 'natureride_' . $now->format('Ymd_His') . '.gpx';
header('Content-Type: application/gpx+xml; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('X-Content-Type-Options: nosniff');
echo $gpx->saveXML();
