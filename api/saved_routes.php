<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $pdo = nr_db();
    $user = nr_json_require_user();

    if ($method === 'GET') {
        $idRaw = $_GET['id'] ?? null;
        if ($idRaw !== null && $idRaw !== '') {
            $stmt = $pdo->prepare(
                'SELECT id, title, profile, route_kind, distance_km, duration_min, route_payload, created_at, updated_at
                 FROM nr_saved_routes
                 WHERE id = :id AND user_id = :user_id
                 LIMIT 1'
            );
            $stmt->execute([
                'id' => (int) $idRaw,
                'user_id' => (int) $user['id'],
            ]);
            $row = $stmt->fetch();
            if (!is_array($row)) {
                throw new RuntimeException('Gespeicherte Route nicht gefunden.');
            }
            $payload = json_decode((string) $row['route_payload'], true);
            nr_json_response([
                'ok' => true,
                'route' => [
                    'id' => (int) $row['id'],
                    'title' => (string) $row['title'],
                    'profile' => (string) $row['profile'],
                    'route_kind' => (string) $row['route_kind'],
                    'distance_km' => $row['distance_km'] !== null ? (float) $row['distance_km'] : null,
                    'duration_min' => $row['duration_min'] !== null ? (int) $row['duration_min'] : null,
                    'payload' => is_array($payload) ? $payload : null,
                    'created_at' => (string) $row['created_at'],
                    'updated_at' => (string) $row['updated_at'],
                ],
            ]);
            exit;
        }
        $stmt = $pdo->prepare(
            'SELECT id, title, profile, route_kind, distance_km, duration_min, created_at, updated_at
             FROM nr_saved_routes
             WHERE user_id = :user_id
             ORDER BY updated_at DESC, id DESC'
        );
        $stmt->execute(['user_id' => (int) $user['id']]);
        $rows = $stmt->fetchAll();
        nr_json_response([
            'ok' => true,
            'routes' => array_map(static function (array $row): array {
                return [
                    'id' => (int) $row['id'],
                    'title' => (string) $row['title'],
                    'profile' => (string) $row['profile'],
                    'route_kind' => (string) $row['route_kind'],
                    'distance_km' => $row['distance_km'] !== null ? (float) $row['distance_km'] : null,
                    'duration_min' => $row['duration_min'] !== null ? (int) $row['duration_min'] : null,
                    'created_at' => (string) $row['created_at'],
                    'updated_at' => (string) $row['updated_at'],
                ];
            }, is_array($rows) ? $rows : []),
        ]);
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

    if ($method === 'POST') {
        $payload = nr_json_body();
        $title = trim((string) ($payload['title'] ?? ''));
        $routePayload = $payload['payload'] ?? null;
        if ($title === '') {
            throw new RuntimeException('Bitte einen Namen für die Route vergeben.');
        }
        if (mb_strlen($title) > 180) {
            throw new RuntimeException('Der Routenname ist zu lang.');
        }
        if (!is_array($routePayload)) {
            throw new RuntimeException('Es gibt keine Route zum Speichern.');
        }
        $routeData = $routePayload['routeData'] ?? null;
        if (!is_array($routeData) || !isset($routeData['geometry']) || !is_array($routeData['geometry'])) {
            throw new RuntimeException('Die Routen-Daten sind unvollständig.');
        }
        $profile = trim((string) ($payload['profile'] ?? ''));
        $routeKind = trim((string) ($payload['route_kind'] ?? ''));
        $distanceKm = isset($payload['distance_km']) && is_numeric($payload['distance_km']) ? (float) $payload['distance_km'] : null;
        $durationMin = isset($payload['duration_min']) && is_numeric($payload['duration_min']) ? (int) $payload['duration_min'] : null;
        $jsonPayload = json_encode($routePayload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $stmt = $pdo->prepare(
            'INSERT INTO nr_saved_routes (user_id, title, profile, route_kind, distance_km, duration_min, route_payload)
             VALUES (:user_id, :title, :profile, :route_kind, :distance_km, :duration_min, :route_payload)'
        );
        $stmt->execute([
            'user_id' => (int) $user['id'],
            'title' => $title,
            'profile' => $profile,
            'route_kind' => $routeKind,
            'distance_km' => $distanceKm,
            'duration_min' => $durationMin,
            'route_payload' => $jsonPayload,
        ]);
        nr_json_response(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
        exit;
    }

    if ($method === 'PATCH' || $method === 'PUT') {
        $payload = nr_json_body();
        $id = isset($payload['id']) ? (int) $payload['id'] : 0;
        $title = trim((string) ($payload['title'] ?? ''));
        if ($id <= 0) {
            throw new RuntimeException('Ungültige Routen-ID.');
        }
        if ($title === '') {
            throw new RuntimeException('Bitte einen neuen Namen für die Route vergeben.');
        }
        if (mb_strlen($title) > 180) {
            throw new RuntimeException('Der Routenname ist zu lang.');
        }
        $stmt = $pdo->prepare(
            'UPDATE nr_saved_routes
             SET title = :title
             WHERE id = :id AND user_id = :user_id'
        );
        $stmt->execute([
            'title' => $title,
            'id' => $id,
            'user_id' => (int) $user['id'],
        ]);
        if ($stmt->rowCount() < 1) {
            throw new RuntimeException('Gespeicherte Route nicht gefunden.');
        }
        nr_json_response(['ok' => true, 'id' => $id, 'title' => $title]);
        exit;
    }

    if ($method === 'DELETE') {
        $payload = nr_json_body();
        $id = isset($payload['id']) ? (int) $payload['id'] : 0;
        if ($id <= 0) {
            throw new RuntimeException('Ungültige Routen-ID.');
        }
        $stmt = $pdo->prepare('DELETE FROM nr_saved_routes WHERE id = :id AND user_id = :user_id');
        $stmt->execute([
            'id' => $id,
            'user_id' => (int) $user['id'],
        ]);
        nr_json_response(['ok' => true]);
        exit;
    }

    nr_json_response(['ok' => false, 'error' => 'Methode nicht erlaubt.'], 405);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
}
