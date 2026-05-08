<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();
$user = nr_json_require_user();
$pdo = nr_db();

function nr_settings_allow_nav_debug(array $user): bool
{
    return strcasecmp((string) ($user['email'] ?? ''), 'peer@pubben.de') === 0;
}

function nr_settings_filter_for_user(array $settings, array $user): array
{
    if (!nr_settings_allow_nav_debug($user)) {
        unset($settings['navDebugLogEnabled']);
    }

    return $settings;
}

function nr_settings_save_for_user(PDO $pdo, int $userId, array $data, array $user): array
{
    $merged = array_merge(nr_auth_load_user_settings($pdo, $userId), nr_auth_normalize_settings($data));
    $merged = nr_settings_filter_for_user($merged, $user);
    $stmt = $pdo->prepare(
        'INSERT INTO nr_user_settings (user_id, settings_json)
         VALUES (:user_id, :settings_json)
         ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        'user_id' => $userId,
        'settings_json' => json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);

    return $merged;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $settings = nr_auth_hydrate_session_settings($pdo, (int) $user['id']);
    $settings = nr_settings_filter_for_user($settings, $user);
    nr_json_response(['ok' => true, 'settings' => $settings]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    nr_json_response(['ok' => false, 'error' => 'Nur GET oder POST.'], 405);
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

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    nr_json_response(['ok' => false, 'error' => 'Leerer Body.'], 400);
    exit;
}

try {
    /** @var mixed $data */
    $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $e) {
    nr_json_response(['ok' => false, 'error' => 'Ungültiges JSON.'], 400);
    exit;
}

if (!is_array($data)) {
    nr_json_response(['ok' => false, 'error' => 'Ungültige Daten.'], 400);
    exit;
}

$settings = nr_settings_save_for_user($pdo, (int) $user['id'], $data, $user);
$settings = nr_auth_set_session_settings($settings);

nr_json_response(['ok' => true, 'settings' => $settings]);
