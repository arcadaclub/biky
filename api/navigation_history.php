<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();
$user = nr_json_require_user();
$pdo = nr_db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $weekStart = isset($_GET['week_start']) && is_string($_GET['week_start']) ? trim($_GET['week_start']) : null;
        $stats = nr_user_route_history_week_stats($pdo, (int) $user['id'], $weekStart);
        nr_json_response([
            'ok' => true,
            'stats' => $stats,
            'user' => $user,
        ]);
    } catch (Throwable $e) {
        nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    nr_json_response(['ok' => false, 'error' => 'Nur GET oder POST erlaubt.'], 405);
    exit;
}

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
    /** @var mixed $payload */
    $payload = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
} catch (JsonException $e) {
    nr_json_response(['ok' => false, 'error' => 'Ungültiges JSON.'], 400);
    exit;
}

if (!is_array($payload)) {
    nr_json_response(['ok' => false, 'error' => 'Ungültige Daten.'], 400);
    exit;
}

try {
    $freshUser = nr_user_record_completed_route($pdo, (int) $user['id'], $payload);
    $stats = nr_user_route_history_week_stats($pdo, (int) $user['id'], null);
    nr_json_response([
        'ok' => true,
        'user' => $freshUser,
        'stats' => $stats,
    ]);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
}
