<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_session_start();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/**
 * @return array{lat:float,lng:float}
 */
function nr_ab_require_latlng(mixed $v, string $label): array
{
    if (!is_array($v)) {
        throw new RuntimeException($label . ' fehlt.');
    }
    $lat = $v['lat'] ?? null;
    $lng = $v['lng'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lng)) {
        throw new RuntimeException($label . ' ist ungültig.');
    }
    $latF = (float) $lat;
    $lngF = (float) $lng;
    if (!is_finite($latF) || !is_finite($lngF) || abs($latF) > 90 || abs($lngF) > 180) {
        throw new RuntimeException($label . ' ist ungültig.');
    }
    // Dedupe / DB-Index: auf 6 Dezimalstellen runden (≈ 0.11m).
    $latF = round($latF, 6);
    $lngF = round($lngF, 6);

    return ['lat' => $latF, 'lng' => $lngF];
}

function nr_ab_trim_label(mixed $v): string
{
    $s = trim((string) ($v ?? ''));
    if (mb_strlen($s) > 180) {
        $s = mb_substr($s, 0, 180);
    }
    return $s;
}

/** Placeholder wenn nur Start oder nur Ziel gespeichert wird (DB: NOT NULL Koordinaten). */
function nr_ab_stub_latlng(): array
{
    return ['lat' => 0.0, 'lng' => 0.0];
}

function nr_ab_is_stub_latlng(array $p): bool
{
    $lat = (float) ($p['lat'] ?? 0.0);
    $lng = (float) ($p['lng'] ?? 0.0);

    return abs($lat) < 1e-8 && abs($lng) < 1e-8;
}

try {
    $pdo = nr_db();
    $user = nr_json_require_user();

    if ($method === 'GET') {
        $stmt = $pdo->prepare(
            'SELECT id, title, start_lat, start_lng, goal_lat, goal_lng,
                    start_place, start_street, goal_place, goal_street,
                    times_used, created_at, updated_at
             FROM nr_address_book
             WHERE user_id = :user_id
             ORDER BY updated_at DESC, id DESC
             LIMIT 80'
        );
        $stmt->execute(['user_id' => (int) $user['id']]);
        $rows = $stmt->fetchAll();
        nr_json_response([
            'ok' => true,
            'items' => array_map(static function (array $row): array {
                return [
                    'id' => (int) $row['id'],
                    'title' => isset($row['title']) ? (string) $row['title'] : '',
                    'start' => [
                        'lat' => (float) $row['start_lat'],
                        'lng' => (float) $row['start_lng'],
                        'place' => (string) $row['start_place'],
                        'street' => (string) $row['start_street'],
                    ],
                    'goal' => [
                        'lat' => (float) $row['goal_lat'],
                        'lng' => (float) $row['goal_lng'],
                        'place' => (string) $row['goal_place'],
                        'street' => (string) $row['goal_street'],
                    ],
                    'times_used' => (int) $row['times_used'],
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
        $partialRaw = isset($payload['partial']) ? trim((string) $payload['partial']) : '';
        $partial = '';
        if ($partialRaw === 'start' || $partialRaw === 'goal') {
            $partial = $partialRaw;
        }

        $startPlace = nr_ab_trim_label($payload['start_place'] ?? '');
        $startStreet = nr_ab_trim_label($payload['start_street'] ?? '');
        $goalPlace = nr_ab_trim_label($payload['goal_place'] ?? '');
        $goalStreet = nr_ab_trim_label($payload['goal_street'] ?? '');
        $title = nr_ab_trim_label($payload['title'] ?? '');

        $stub = nr_ab_stub_latlng();
        if ($partial === 'start') {
            $start = nr_ab_require_latlng($payload['start'] ?? null, 'Start');
            if (nr_ab_is_stub_latlng($start)) {
                throw new RuntimeException('Bitte einen gültigen Startpunkt auf der Karte setzen oder per Suche ermitteln.');
            }
            $goal = $stub;
            $goalPlace = '';
            $goalStreet = '';
        } elseif ($partial === 'goal') {
            $goal = nr_ab_require_latlng($payload['goal'] ?? null, 'Ziel');
            if (nr_ab_is_stub_latlng($goal)) {
                throw new RuntimeException('Bitte einen gültigen Zielpunkt auf der Karte setzen oder per Suche ermitteln.');
            }
            $start = $stub;
            $startPlace = '';
            $startStreet = '';
        } else {
            $start = nr_ab_require_latlng($payload['start'] ?? null, 'Start');
            $goal = nr_ab_require_latlng($payload['goal'] ?? null, 'Ziel');
            if (nr_ab_is_stub_latlng($start) || nr_ab_is_stub_latlng($goal)) {
                throw new RuntimeException('Start und Ziel müssen gültige Koordinaten haben.');
            }
        }

        // Dedupe: identische Koordinaten + Labels => nur aktualisieren + times_used++ (Titel bleibt erhalten,
        // außer es wird explizit ein neuer Titel mitgeschickt).
        $stmt = $pdo->prepare(
            'SELECT id FROM nr_address_book
             WHERE user_id = :user_id
               AND start_lat = :start_lat AND start_lng = :start_lng
               AND goal_lat = :goal_lat AND goal_lng = :goal_lng
               AND start_place = :start_place AND start_street = :start_street
               AND goal_place = :goal_place AND goal_street = :goal_street
             LIMIT 1'
        );
        $stmt->execute([
            'user_id' => (int) $user['id'],
            'start_lat' => $start['lat'],
            'start_lng' => $start['lng'],
            'goal_lat' => $goal['lat'],
            'goal_lng' => $goal['lng'],
            'start_place' => $startPlace,
            'start_street' => $startStreet,
            'goal_place' => $goalPlace,
            'goal_street' => $goalStreet,
        ]);
        $row = $stmt->fetch();
        if (is_array($row) && isset($row['id'])) {
            $id = (int) $row['id'];
            if ($title !== '') {
                $upd = $pdo->prepare(
                    'UPDATE nr_address_book
                     SET times_used = times_used + 1, title = :title, updated_at = CURRENT_TIMESTAMP
                     WHERE id = :id AND user_id = :user_id'
                );
                $upd->execute(['id' => $id, 'user_id' => (int) $user['id'], 'title' => $title]);
            } else {
                $upd = $pdo->prepare(
                    'UPDATE nr_address_book
                     SET times_used = times_used + 1, updated_at = CURRENT_TIMESTAMP
                     WHERE id = :id AND user_id = :user_id'
                );
                $upd->execute(['id' => $id, 'user_id' => (int) $user['id']]);
            }
            nr_json_response(['ok' => true, 'id' => $id, 'deduped' => true]);
            exit;
        }

        $ins = $pdo->prepare(
            'INSERT INTO nr_address_book
                (user_id, title, start_lat, start_lng, goal_lat, goal_lng, start_place, start_street, goal_place, goal_street, times_used)
             VALUES
                (:user_id, :title, :start_lat, :start_lng, :goal_lat, :goal_lng, :start_place, :start_street, :goal_place, :goal_street, 1)'
        );
        $ins->execute([
            'user_id' => (int) $user['id'],
            'title' => $title,
            'start_lat' => $start['lat'],
            'start_lng' => $start['lng'],
            'goal_lat' => $goal['lat'],
            'goal_lng' => $goal['lng'],
            'start_place' => $startPlace,
            'start_street' => $startStreet,
            'goal_place' => $goalPlace,
            'goal_street' => $goalStreet,
        ]);
        $id = (int) $pdo->lastInsertId();

        // Limit pro User: max 60 Einträge behalten.
        $limit = 60;
        $del = $pdo->prepare(
            'DELETE FROM nr_address_book
             WHERE user_id = :user_id AND id NOT IN (
                SELECT id FROM (
                    SELECT id FROM nr_address_book
                    WHERE user_id = :user_id2
                    ORDER BY updated_at DESC, id DESC
                    LIMIT :lim
                ) t
             )'
        );
        $del->bindValue(':user_id', (int) $user['id'], PDO::PARAM_INT);
        $del->bindValue(':user_id2', (int) $user['id'], PDO::PARAM_INT);
        $del->bindValue(':lim', $limit, PDO::PARAM_INT);
        $del->execute();

        nr_json_response(['ok' => true, 'id' => $id, 'deduped' => false]);
        exit;
    }

    if ($method === 'PATCH' || $method === 'PUT') {
        $payload = nr_json_body();
        $id = isset($payload['id']) ? (int) $payload['id'] : 0;
        $title = nr_ab_trim_label($payload['title'] ?? '');
        if ($id <= 0) {
            throw new RuntimeException('Ungültige ID.');
        }
        if ($title === '') {
            throw new RuntimeException('Bitte einen Namen eingeben.');
        }
        $stmt = $pdo->prepare(
            'UPDATE nr_address_book
             SET title = :title
             WHERE id = :id AND user_id = :user_id'
        );
        $stmt->execute([
            'title' => $title,
            'id' => $id,
            'user_id' => (int) $user['id'],
        ]);
        if ($stmt->rowCount() < 1) {
            throw new RuntimeException('Eintrag nicht gefunden.');
        }
        nr_json_response(['ok' => true, 'id' => $id, 'title' => $title]);
        exit;
    }

    if ($method === 'DELETE') {
        $payload = nr_json_body();
        $id = isset($payload['id']) ? (int) $payload['id'] : 0;
        if ($id <= 0) {
            throw new RuntimeException('Ungültige ID.');
        }
        $stmt = $pdo->prepare('DELETE FROM nr_address_book WHERE id = :id AND user_id = :user_id');
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

