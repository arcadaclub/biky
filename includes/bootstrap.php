<?php

declare(strict_types=1);

/**
 * @return array<string, mixed>
 */
function nr_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $path = dirname(__DIR__) . '/config/config.php';
        if (!is_readable($path)) {
            throw new RuntimeException('Konfiguration nicht gefunden.');
        }
        /** @var array<string, mixed> $loaded */
        $loaded = require $path;
        $cfg = $loaded;
    }

    return $cfg;
}

function nr_json_response(array $data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

function nr_send_no_cache_headers(): void
{
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Cache-Control: post-check=0, pre-check=0', false);
    header('Pragma: no-cache');
    header('Expires: Thu, 01 Jan 1970 00:00:00 GMT');
}

function nr_session_start(): void
{
    $cfg = nr_config();
    $name = isset($cfg['session_name']) && is_string($cfg['session_name'])
        ? $cfg['session_name']
        : 'NRNAVSESSID';
    if (session_status() === PHP_SESSION_NONE) {
        session_name($name);
        session_start([
            'cookie_httponly' => true,
            'cookie_samesite' => 'Lax',
            'use_strict_mode' => true,
        ]);
    }
}

function nr_csrf_token(): string
{
    nr_session_start();
    if (empty($_SESSION['_nr_csrf'])) {
        $_SESSION['_nr_csrf'] = bin2hex(random_bytes(32));
    }

    return (string) $_SESSION['_nr_csrf'];
}

function nr_verify_csrf(?string $token): bool
{
    nr_session_start();
    if ($token === null || $token === '') {
        return false;
    }
    $expected = $_SESSION['_nr_csrf'] ?? '';

    return is_string($expected) && hash_equals($expected, $token);
}

function nr_rate_limit_ok(string $ip): bool
{
    $cfg = nr_config();
    $max = (int) ($cfg['rate_limit']['max_requests'] ?? 60);
    $window = (int) ($cfg['rate_limit']['window_seconds'] ?? 3600);
    $dir = dirname(__DIR__) . '/cache';
    if (!is_dir($dir)) {
        return true;
    }
    $safeIp = preg_replace('/[^a-f0-9.:]/i', '', $ip) ?: 'unknown';
    $file = $dir . '/ratelimit_' . hash('sha256', $safeIp) . '.json';
    $now = time();
    $data = ['count' => 0, 'reset' => $now + $window];
    if (is_readable($file)) {
        $raw = file_get_contents($file);
        if ($raw !== false) {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $data = array_merge($data, $decoded);
            }
        }
    }
    if ($now > (int) ($data['reset'] ?? 0)) {
        $data = ['count' => 0, 'reset' => $now + $window];
    }
    $data['count'] = (int) ($data['count'] ?? 0) + 1;
    file_put_contents($file, json_encode($data), LOCK_EX);

    return $data['count'] <= $max;
}

function nr_client_ip(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}
