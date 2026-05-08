<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    nr_json_response(['ok' => false, 'error' => 'Nur POST erlaubt.'], 405);
    exit;
}

$user = nr_json_require_user();
nr_session_start();
if (strcasecmp((string) ($user['email'] ?? ''), 'peer@pubben.de') !== 0) {
    nr_json_response(['ok' => true, 'written' => 0, 'disabled' => true]);
    exit;
}
$settings = $_SESSION['nr_settings'] ?? [];
if (!is_array($settings) || empty($settings['navDebugLogEnabled'])) {
    nr_json_response(['ok' => true, 'written' => 0, 'disabled' => true]);
    exit;
}

$csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
if (!nr_verify_csrf(is_string($csrf) ? $csrf : null)) {
    nr_json_response(['ok' => false, 'error' => 'CSRF ungültig.'], 403);
    exit;
}

if (!nr_rate_limit_ok(nr_client_ip())) {
    nr_json_response(['ok' => false, 'error' => 'Rate limit.'], 429);
    exit;
}

try {
    $payload = nr_json_body();
} catch (RuntimeException $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
    exit;
}

$sessionId = isset($payload['session_id']) ? trim((string) $payload['session_id']) : '';
$entries = $payload['entries'] ?? null;
if ($sessionId === '' || !is_array($entries) || $entries === []) {
    nr_json_response(['ok' => false, 'error' => 'Ungültige Debug-Daten.'], 400);
    exit;
}

$dir = dirname(__DIR__) . '/cache';
if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
    nr_json_response(['ok' => false, 'error' => 'Log-Verzeichnis fehlt.'], 500);
    exit;
}

$file = $dir . '/nav_debug_live.log';
$ip = nr_client_ip();
$userId = (int) ($user['id'] ?? 0);
$ua = isset($_SERVER['HTTP_USER_AGENT']) ? trim((string) $_SERVER['HTTP_USER_AGENT']) : '';
$requestTs = gmdate('c');
$maxEntries = min(80, count($entries));
$lines = [];

for ($i = 0; $i < $maxEntries; $i++) {
    $entry = $entries[$i];
    if (!is_array($entry)) {
        continue;
    }
    $event = isset($entry['event']) ? preg_replace('/[^a-z0-9_.:-]/i', '_', (string) $entry['event']) : 'unknown';
    $clientTs = isset($entry['ts']) ? trim((string) $entry['ts']) : '';
    $data = $entry['data'] ?? [];
    if (!is_array($data)) {
        $data = ['value' => $data];
    }
    $linePayload = [
        'request_ts' => $requestTs,
        'client_ts' => $clientTs,
        'session_id' => $sessionId,
        'user_id' => $userId,
        'ip' => $ip,
        'event' => $event !== '' ? $event : 'unknown',
        'data' => $data,
        'ua' => $ua,
    ];
    $lines[] = json_encode($linePayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

if ($lines === []) {
    nr_json_response(['ok' => false, 'error' => 'Keine gültigen Debug-Einträge.'], 400);
    exit;
}

$append = implode(PHP_EOL, $lines) . PHP_EOL;
if (@file_put_contents($file, $append, FILE_APPEND | LOCK_EX) === false) {
    nr_json_response(['ok' => false, 'error' => 'Logdatei konnte nicht geschrieben werden.'], 500);
    exit;
}

nr_json_response([
    'ok' => true,
    'written' => count($lines),
    'file' => 'cache/nav_debug_live.log',
]);
