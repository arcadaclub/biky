<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    nr_json_response(['ok' => false, 'error' => 'Nur POST erlaubt.'], 405);
    exit;
}

$csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
if (!nr_verify_csrf(is_string($csrf) ? $csrf : null)) {
    nr_json_response(['ok' => false, 'error' => 'CSRF-Token ungültig.'], 403);
    exit;
}

if (!nr_rate_limit_ok(nr_client_ip())) {
    nr_json_response(['ok' => false, 'error' => 'Zu viele Anfragen.'], 429);
    exit;
}

try {
    $payload = nr_json_body();
    $pdo = nr_db();
    $user = nr_auth_login_user(
        $pdo,
        (string) ($payload['email'] ?? ''),
        (string) ($payload['password'] ?? '')
    );
    nr_auth_set_user($user);
    nr_auth_hydrate_session_settings($pdo, (int) $user['id']);
    nr_json_response(['ok' => true, 'user' => $user]);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
}
