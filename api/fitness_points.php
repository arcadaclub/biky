<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    nr_json_response(['ok' => false, 'error' => 'Nur POST erlaubt.'], 405);
    exit;
}

$user = nr_json_require_user();

$csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
if (!nr_verify_csrf(is_string($csrf) ? $csrf : null)) {
    nr_json_response(['ok' => false, 'error' => 'CSRF ungültig.'], 403);
    exit;
}

try {
    $payload = nr_json_body();
    $delta = isset($payload['delta']) && is_numeric($payload['delta'])
        ? (int) $payload['delta']
        : 0;
    $updatedUser = nr_auth_add_fitness_points(nr_db(), (int) $user['id'], $delta);
    nr_json_response([
        'ok' => true,
        'delta' => $delta,
        'user' => $updatedUser,
        'fitness_points' => $updatedUser['fitness_points'],
    ]);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
}
