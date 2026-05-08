<?php

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
require __DIR__ . '/includes/auth_db.php';

nr_send_no_cache_headers();
nr_session_start();

/**
 * Admin-Tool: bewusst "link-only".
 * Ohne korrektes Token wird mit 404 geantwortet, damit es nicht auffindbar ist.
 */
$cfg = nr_config();
$adminCfg = isset($cfg['admin_tool']) && is_array($cfg['admin_tool']) ? $cfg['admin_tool'] : [];
$requiredToken = isset($adminCfg['token']) ? trim((string) $adminCfg['token']) : '';
$requiredPassword = isset($adminCfg['password']) ? (string) $adminCfg['password'] : '';

$providedToken = isset($_GET['k']) ? trim((string) $_GET['k']) : '';
if ($requiredToken === '' || $providedToken === '' || !hash_equals($requiredToken, $providedToken)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Not found\n";
    exit;
}

$logout = isset($_GET['logout']) ? trim((string) $_GET['logout']) : '';
if ($logout === '1') {
    unset($_SESSION['nr_admin_tool_authed'], $_SESSION['nr_admin_tool_token']);
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }
    header('Location: admin_tool.php?' . http_build_query(['k' => $providedToken]));
    exit;
}

// Bind auth session to token so a copied session cookie alone is insufficient.
$isAuthed = !empty($_SESSION['nr_admin_tool_authed'])
    && isset($_SESSION['nr_admin_tool_token'])
    && is_string($_SESSION['nr_admin_tool_token'])
    && hash_equals((string) $_SESSION['nr_admin_tool_token'], $providedToken);

$error = '';
if (!$isAuthed && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $csrf = isset($_POST['_csrf']) ? (string) $_POST['_csrf'] : '';
    if (!nr_verify_csrf($csrf)) {
        $error = 'CSRF-Token ungültig.';
    } elseif (!nr_rate_limit_ok(nr_client_ip())) {
        $error = 'Zu viele Versuche. Bitte später erneut probieren.';
    } else {
        $password = isset($_POST['password']) ? (string) $_POST['password'] : '';
        if ($requiredPassword === '') {
            $error = 'Admin-Tool ist nicht konfiguriert.';
        } elseif (!hash_equals($requiredPassword, $password)) {
            $error = 'Passwort ist falsch.';
        } else {
            $_SESSION['nr_admin_tool_authed'] = true;
            $_SESSION['nr_admin_tool_token'] = $providedToken;
            if (session_status() === PHP_SESSION_ACTIVE) {
                session_regenerate_id(true);
            }
            header('Location: admin_tool.php?' . http_build_query(['k' => $providedToken]));
            exit;
        }
    }
}

$csrf = nr_csrf_token();

/**
 * @return list<array{
 *   id:int,email:string,display_name:string,fitness_points:int,
 *   email_verified_at:?string,created_at:string,updated_at:string,
 *   saved_routes:int,address_entries:int
 * }>
 */
function nr_admin_tool_load_users(PDO $pdo): array
{
    $sql = '
        SELECT
            u.id,
            u.email,
            u.display_name,
            u.fitness_points,
            u.email_verified_at,
            u.created_at,
            u.updated_at,
            COALESCE(sr.cnt, 0) AS saved_routes,
            COALESCE(ab.cnt, 0) AS address_entries
        FROM nr_users u
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS cnt
            FROM nr_saved_routes
            GROUP BY user_id
        ) sr ON sr.user_id = u.id
        LEFT JOIN (
            SELECT user_id, COUNT(*) AS cnt
            FROM nr_address_book
            GROUP BY user_id
        ) ab ON ab.user_id = u.id
        ORDER BY u.created_at DESC, u.id DESC
    ';
    $stmt = $pdo->query($sql);
    /** @var list<array<string, mixed>> $rows */
    $rows = $stmt->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'id' => (int) ($r['id'] ?? 0),
            'email' => (string) ($r['email'] ?? ''),
            'display_name' => (string) ($r['display_name'] ?? ''),
            'fitness_points' => isset($r['fitness_points']) ? max(0, (int) $r['fitness_points']) : 0,
            'email_verified_at' => isset($r['email_verified_at']) && $r['email_verified_at'] !== null
                ? (string) $r['email_verified_at']
                : null,
            'created_at' => (string) ($r['created_at'] ?? ''),
            'updated_at' => (string) ($r['updated_at'] ?? ''),
            'saved_routes' => isset($r['saved_routes']) ? max(0, (int) $r['saved_routes']) : 0,
            'address_entries' => isset($r['address_entries']) ? max(0, (int) $r['address_entries']) : 0,
        ];
    }

    return $out;
}

/**
 * @param list<int> $userIds
 * @return array<int, list<array{
 *   id:int,user_id:int,title:string,profile:string,route_kind:string,
 *   distance_km:?float,duration_min:?int,created_at:string,updated_at:string
 * }>>
 */
function nr_admin_tool_load_saved_routes(PDO $pdo, array $userIds): array
{
    $ids = array_values(array_filter(array_map(static fn ($v) => (int) $v, $userIds), static fn ($v) => $v > 0));
    if ($ids === []) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $sql = '
        SELECT
            id,
            user_id,
            title,
            profile,
            route_kind,
            distance_km,
            duration_min,
            created_at,
            updated_at
        FROM nr_saved_routes
        WHERE user_id IN (' . $placeholders . ')
        ORDER BY user_id ASC, created_at DESC, id DESC
    ';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($ids);
    /** @var list<array<string, mixed>> $rows */
    $rows = $stmt->fetchAll();
    $grouped = [];
    foreach ($rows as $r) {
        $userId = (int) ($r['user_id'] ?? 0);
        if ($userId <= 0) {
            continue;
        }
        $grouped[$userId] ??= [];
        $distance = null;
        if (isset($r['distance_km']) && $r['distance_km'] !== null && $r['distance_km'] !== '') {
            $distance = (float) $r['distance_km'];
        }
        $duration = null;
        if (isset($r['duration_min']) && $r['duration_min'] !== null && $r['duration_min'] !== '') {
            $duration = (int) $r['duration_min'];
        }
        $grouped[$userId][] = [
            'id' => (int) ($r['id'] ?? 0),
            'user_id' => $userId,
            'title' => trim((string) ($r['title'] ?? '')) !== '' ? (string) $r['title'] : 'Route #' . (int) ($r['id'] ?? 0),
            'profile' => (string) ($r['profile'] ?? ''),
            'route_kind' => (string) ($r['route_kind'] ?? ''),
            'distance_km' => $distance,
            'duration_min' => $duration,
            'created_at' => (string) ($r['created_at'] ?? ''),
            'updated_at' => (string) ($r['updated_at'] ?? ''),
        ];
    }

    return $grouped;
}

$users = [];
$savedRoutesByUser = [];
if ($isAuthed) {
    try {
        $pdo = nr_db();
        $users = nr_admin_tool_load_users($pdo);
        $userIds = array_map(static fn (array $u) => (int) ($u['id'] ?? 0), $users);
        $savedRoutesByUser = nr_admin_tool_load_saved_routes($pdo, $userIds);
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

$nrBasePath = '';
$scriptName = $_SERVER['SCRIPT_NAME'] ?? '/admin_tool.php';
$scriptDir = str_replace('\\', '/', dirname($scriptName));
if ($scriptDir !== '/' && $scriptDir !== '.' && $scriptDir !== '') {
    $nrBasePath = rtrim($scriptDir, '/');
}

$appCssPath = __DIR__ . '/assets/css/app.css';
$appCssHref = ($nrBasePath !== '' ? $nrBasePath : '') . '/assets/css/app.css';
if (is_file($appCssPath)) {
    $appCssHref .= '?v=' . (string) filemtime($appCssPath);
}

$adminCssPath = __DIR__ . '/assets/css/admin_tool.css';
$adminCssHref = ($nrBasePath !== '' ? $nrBasePath : '') . '/assets/css/admin_tool.css';
if (is_file($adminCssPath)) {
    $adminCssHref .= '?v=' . (string) filemtime($adminCssPath);
}

?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Biky Admin</title>
    <link rel="stylesheet" href="<?= htmlspecialchars($appCssHref, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars($adminCssHref, ENT_QUOTES, 'UTF-8') ?>">
</head>
<body>
    <div class="app">
        <header class="top-bar">
            <div class="top-bar-strip">
                <div class="top-bar-brand-slot">
                    <h1 class="brand">Biky <span class="brand-version">Admin</span></h1>
                </div>
            </div>
            <div class="top-bar-actions">
                <?php if ($isAuthed): ?>
                    <a class="btn btn-secondary btn-mini" href="admin_tool.php?<?= htmlspecialchars(http_build_query(['k' => $providedToken, 'logout' => 1]), ENT_QUOTES, 'UTF-8') ?>">Logout</a>
                <?php endif; ?>
                <a class="btn btn-ghost" href="<?= htmlspecialchars(($nrBasePath !== '' ? $nrBasePath : '') . '/index.php', ENT_QUOTES, 'UTF-8') ?>">Zur App</a>
            </div>
        </header>

        <main class="main">
            <?php if ($error !== ''): ?>
                <section class="panel-section panel-card" role="alert">
                    <p class="error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
                </section>
            <?php endif; ?>

            <?php if (!$isAuthed): ?>
                <section class="panel-section panel-card">
                    <div class="section-head">
                        <div>
                            <p class="section-kicker">Schutz</p>
                            <h2>Passwort</h2>
                        </div>
                    </div>
                    <form method="post" class="auth-grid" action="admin_tool.php?<?= htmlspecialchars(http_build_query(['k' => $providedToken]), ENT_QUOTES, 'UTF-8') ?>">
                        <input type="hidden" name="_csrf" value="<?= htmlspecialchars($csrf, ENT_QUOTES, 'UTF-8') ?>">
                        <div>
                            <label class="input-label" for="admin-password">Admin-Passwort</label>
                            <input id="admin-password" name="password" type="password" class="input" autocomplete="current-password" required>
                        </div>
                        <div class="btn-row">
                            <button type="submit" class="btn btn-primary">Öffnen</button>
                        </div>
                        <p class="hint hint-small">Hinweis: Dieses Tool ist bewusst nicht verlinkt (nur via Geheim-Link + Passwort).</p>
                    </form>
                </section>
            <?php else: ?>
                <section class="panel-section panel-card">
                    <div class="section-head">
                        <div>
                            <p class="section-kicker">Daten</p>
                            <h2>Benutzer</h2>
                        </div>
                    </div>
                    <p class="hint hint-small">Gesamt: <strong><?= count($users) ?></strong></p>

                    <div class="admin-table-wrap" role="region" aria-label="Benutzerübersicht (scrollbar)">
                        <table class="admin-table" aria-label="Benutzerübersicht">
                            <thead>
                            <tr>
                                <th>ID</th>
                                <th>E-Mail</th>
                                <th>Name</th>
                                <th>Verifiziert</th>
                                <th>Punkte</th>
                                <th>Routen</th>
                                <th>Gespeicherte Routen</th>
                                <th>Adressbuch</th>
                                <th>Erstellt</th>
                                <th>Update</th>
                            </tr>
                            </thead>
                            <tbody>
                            <?php foreach ($users as $u): ?>
                                <tr>
                                    <td class="admin-mono"><?= (int) $u['id'] ?></td>
                                    <td><?= htmlspecialchars((string) $u['email'], ENT_QUOTES, 'UTF-8') ?></td>
                                    <td><?= htmlspecialchars((string) $u['display_name'], ENT_QUOTES, 'UTF-8') ?></td>
                                    <td>
                                        <?php if ($u['email_verified_at'] !== null && $u['email_verified_at'] !== ''): ?>
                                            <span class="admin-pill admin-pill--ok">ja</span>
                                        <?php else: ?>
                                            <span class="admin-pill admin-pill--warn">nein</span>
                                        <?php endif; ?>
                                    </td>
                                    <td><?= (int) $u['fitness_points'] ?></td>
                                    <td><?= (int) $u['saved_routes'] ?></td>
                                    <td>
                                        <?php
                                        $routes = $savedRoutesByUser[(int) $u['id']] ?? [];
                                        ?>
                                        <?php if ($routes === []): ?>
                                            <span class="hint hint-small">–</span>
                                        <?php else: ?>
                                            <details class="admin-routes-details">
                                                <summary class="admin-routes-summary">
                                                    <span class="btn btn-ghost btn-mini">Anzeigen (<?= count($routes) ?>)</span>
                                                </summary>
                                                <div class="admin-routes-body">
                                                    <ul class="admin-routes-list" aria-label="Gespeicherte Routen">
                                                        <?php foreach ($routes as $r): ?>
                                                            <?php
                                                            $meta = [];
                                                            $profile = trim((string) ($r['profile'] ?? ''));
                                                            $kind = trim((string) ($r['route_kind'] ?? ''));
                                                            if ($profile !== '') {
                                                                $meta[] = $profile;
                                                            }
                                                            if ($kind !== '') {
                                                                $meta[] = $kind;
                                                            }
                                                            if (isset($r['distance_km']) && is_float($r['distance_km'])) {
                                                                $meta[] = number_format($r['distance_km'], 1, ',', '') . ' km';
                                                            }
                                                            if (isset($r['duration_min']) && is_int($r['duration_min'])) {
                                                                $meta[] = (int) $r['duration_min'] . ' min';
                                                            }
                                                            $createdAt = trim((string) ($r['created_at'] ?? ''));
                                                            if ($createdAt !== '') {
                                                                $meta[] = $createdAt;
                                                            }
                                                            ?>
                                                            <li class="admin-routes-item">
                                                                <strong><?= htmlspecialchars((string) ($r['title'] ?? ''), ENT_QUOTES, 'UTF-8') ?></strong>
                                                                <?php if ($meta !== []): ?>
                                                                    <div class="hint hint-small"><?= htmlspecialchars(implode(' · ', $meta), ENT_QUOTES, 'UTF-8') ?></div>
                                                                <?php endif; ?>
                                                            </li>
                                                        <?php endforeach; ?>
                                                    </ul>
                                                </div>
                                            </details>
                                        <?php endif; ?>
                                    </td>
                                    <td><?= (int) $u['address_entries'] ?></td>
                                    <td class="admin-mono"><?= htmlspecialchars((string) $u['created_at'], ENT_QUOTES, 'UTF-8') ?></td>
                                    <td class="admin-mono"><?= htmlspecialchars((string) $u['updated_at'], ENT_QUOTES, 'UTF-8') ?></td>
                                </tr>
                            <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                </section>
            <?php endif; ?>
        </main>
    </div>
</body>
</html>

