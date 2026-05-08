<?php

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
require __DIR__ . '/includes/auth_db.php';

nr_send_no_cache_headers();
nr_session_start();

$message = '';

try {
    $token = isset($_GET['token']) ? trim((string) $_GET['token']) : '';
    if ($token === '') {
        throw new RuntimeException('Der Bestätigungslink ist unvollständig.');
    }
    $user = nr_auth_verify_email_with_token(nr_db(), $token);
    nr_auth_set_user(nr_auth_public_user($user));
    nr_auth_set_notice('E-Mail-Adresse bestätigt. Sie sind jetzt angemeldet.');
    header('Location: index.php');
    exit;
} catch (Throwable $e) {
    $message = $e->getMessage();
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
    <title>E-Mail bestätigen · NatureRide</title>
    <link rel="stylesheet" href="<?= htmlspecialchars($appCssHref, ENT_QUOTES, 'UTF-8') ?>">
</head>
<body class="auth-standalone-page">
    <main class="auth-standalone-wrap">
        <section class="auth-dialog-card auth-standalone-card">
            <p class="panel-kicker">Konto</p>
            <h1 class="auth-dialog-title">E-Mail-Bestätigung</h1>
            <p class="auth-dialog-copy"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></p>
            <div class="btn-row">
                <a class="btn btn-primary" href="index.php">Zur App</a>
            </div>
        </section>
    </main>
</body>
</html>
