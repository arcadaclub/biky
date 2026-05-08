<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/wp-bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

if (nr_wp_login_environment()) {
    nr_json_response([
        'ok' => false,
        'error' => 'Passwort-Reset erfolgt über die Club-Website (WordPress) – dort „Passwort vergessen“ nutzen.',
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
    $email = (string) ($payload['email'] ?? '');
    if (!filter_var(trim($email), FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Bitte zuerst eine gültige E-Mail-Adresse eingeben.');
    }
    nr_auth_request_password_reset(nr_db(), $email);
    nr_json_response([
        'ok' => true,
        'message' => 'Wenn die Adresse bekannt ist, wurde eine E-Mail zum Zurücksetzen oder Bestätigen versendet.',
    ]);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
}
