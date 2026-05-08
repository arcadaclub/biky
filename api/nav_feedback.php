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
    nr_json_response(['ok' => false, 'error' => 'Zu viele Anfragen. Bitte später erneut versuchen.'], 429);
    exit;
}

try {
    $payload = nr_json_body();
    $name = trim((string) ($payload['name'] ?? ''));
    $email = trim((string) ($payload['email'] ?? ''));
    $message = trim((string) ($payload['message'] ?? ''));

    if ($name === '' || mb_strlen($name) > 120) {
        throw new RuntimeException('Bitte einen gültigen Namen eingeben.');
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || mb_strlen($email) > 190) {
        throw new RuntimeException('Bitte eine gültige E-Mail-Adresse eingeben.');
    }
    if ($message === '' || mb_strlen($message) > 3000) {
        throw new RuntimeException('Bitte Feedback zwischen 1 und 3000 Zeichen eingeben.');
    }

    $user = nr_auth_current_user();
    $route = isset($payload['route']) && is_array($payload['route']) ? $payload['route'] : [];
    $lines = [
        'NatureRide Navigationsfeedback',
        '',
        'Name: ' . $name,
        'E-Mail: ' . $email,
    ];
    if ($user !== null) {
        $lines[] = 'Angemeldeter Benutzer: #' . $user['id'] . ' ' . $user['email'];
    }
    if ($route !== []) {
        $lines[] = '';
        $lines[] = 'Route:';
        foreach (['profil', 'distance', 'duration', 'roundtrip_mode'] as $key) {
            if (array_key_exists($key, $route) && $route[$key] !== null && $route[$key] !== '') {
                $lines[] = '- ' . $key . ': ' . (is_scalar($route[$key]) ? (string) $route[$key] : json_encode($route[$key], JSON_UNESCAPED_UNICODE));
            }
        }
    }
    $lines[] = '';
    $lines[] = 'Feedback:';
    $lines[] = $message;

    nr_feedback_send_mail('info@arcada-club.de', 'NatureRide: Navigationsfeedback', implode("\n", $lines), $email);
    nr_json_response(['ok' => true]);
} catch (Throwable $e) {
    nr_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
}

function nr_feedback_send_mail(string $toEmail, string $subject, string $plainText, string $replyTo): void
{
    $mailCfg = nr_auth_mail_config();
    if ($mailCfg['from_email'] === '' || !filter_var($mailCfg['from_email'], FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Mail-Absender ist nicht konfiguriert. Bitte config.local.php ergänzen.');
    }
    $fromName = function_exists('mb_encode_mimeheader')
        ? mb_encode_mimeheader($mailCfg['from_name'], 'UTF-8')
        : $mailCfg['from_name'];
    $subjectEncoded = function_exists('mb_encode_mimeheader')
        ? mb_encode_mimeheader($subject, 'UTF-8')
        : $subject;
    $headers = [
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'From: ' . $fromName . ' <' . $mailCfg['from_email'] . '>',
        'Reply-To: ' . $replyTo,
        'X-Mailer: PHP/' . PHP_VERSION,
    ];
    $sent = @mail($toEmail, $subjectEncoded, $plainText, implode("\r\n", $headers));
    if (!$sent) {
        throw new RuntimeException('Feedback konnte nicht per E-Mail versendet werden.');
    }
}
