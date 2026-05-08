<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/wp-bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

if (nr_wp_login_environment()) {
    nr_json_response([
        'ok' => false,
        'error' => 'Neue Konten werden über die Club-Website (WordPress) angelegt, nicht in dieser App.',
    ], 400);
    exit;
}

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
    $user = nr_auth_register_user(
        $pdo,
        (string) ($payload['email'] ?? ''),
        (string) ($payload['display_name'] ?? ''),
        (string) ($payload['password'] ?? '')
    );
    $apiKey = isset($payload['orsApiKey']) && is_string($payload['orsApiKey'])
        ? trim($payload['orsApiKey'])
        : '';
    if ($apiKey !== '') {
        nr_auth_save_user_settings($pdo, (int) $user['id'], ['orsApiKey' => $apiKey]);
    }
    nr_json_response([
        'ok' => true,
        'message' => 'Konto angelegt. Bitte bestätigen Sie jetzt Ihre E-Mail-Adresse über den Link in der Nachricht.',
    ]);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
}
