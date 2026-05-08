<?php

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
require __DIR__ . '/includes/auth_db.php';

nr_send_no_cache_headers();
nr_session_start();

$token = '';
$message = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $token = trim((string) ($_POST['token'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');
    $passwordRepeat = (string) ($_POST['password_repeat'] ?? '');
    try {
        if ($token === '') {
            throw new RuntimeException('Der Passwort-Link ist unvollständig.');
        }
        if ($password !== $passwordRepeat) {
            throw new RuntimeException('Die beiden Passwörter stimmen nicht überein.');
        }
        $user = nr_auth_reset_password_with_token(nr_db(), $token, $password);
        nr_auth_set_user(nr_auth_public_user($user));
        nr_auth_set_notice('Passwort geändert. Sie sind jetzt angemeldet.');
        header('Location: index.php');
        exit;
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
} else {
    $token = isset($_GET['token']) ? trim((string) $_GET['token']) : '';
}

$tokenIsValid = false;
if ($token !== '') {
    try {
        nr_auth_require_reset_token(nr_db(), $token);
        $tokenIsValid = true;
    } catch (Throwable $e) {
        $error = $e->getMessage();
    }
}

$appCssPath = __DIR__ . '/assets/css/app.css';
$appCssHref = 'assets/css/app.css';
if (is_file($appCssPath)) {
    $appCssHref .= '?v=' . (string) filemtime($appCssPath);
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>Passwort zurücksetzen · NatureRide</title>
    <link rel="stylesheet" href="<?= htmlspecialchars($appCssHref, ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="auth-standalone-page">
    <main class="auth-standalone-wrap">
        <section class="auth-dialog-card auth-standalone-card">
            <p class="panel-kicker">Konto</p>
            <h1 class="auth-dialog-title">Neues Passwort setzen</h1>
            <?php if ($tokenIsValid): ?>
                <p class="auth-dialog-copy">Bitte vergeben Sie jetzt ein neues Passwort für Ihr NatureRide-Konto.</p>
                <form method="post" class="auth-grid">
                    <input type="hidden" name="token" value="<?= htmlspecialchars($token, ENT_QUOTES, 'UTF-8') ?>">
                    <input type="password" name="password" class="input" placeholder="Neues Passwort" minlength="8" autocomplete="new-password" required>
                    <input type="password" name="password_repeat" class="input" placeholder="Passwort wiederholen" minlength="8" autocomplete="new-password" required>
                    <div class="btn-row">
                        <button type="submit" class="btn btn-primary">Passwort speichern</button>
                        <a class="btn btn-secondary" href="index.php">Abbrechen</a>
                    </div>
                </form>
            <?php else: ?>
                <p class="auth-dialog-copy"><?= htmlspecialchars($error !== '' ? $error : 'Der Passwort-Link ist ungültig.', ENT_QUOTES, 'UTF-8') ?></p>
                <div class="btn-row">
                    <a class="btn btn-primary" href="index.php">Zur App</a>
                </div>
            <?php endif; ?>
            <?php if ($error !== '' && $tokenIsValid): ?>
                <p class="hint hint-small" role="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
            <?php endif; ?>
        </section>
    </main>
</body>
</html>
