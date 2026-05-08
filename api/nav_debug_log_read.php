<?php

declare(strict_types=1);

require dirname(__DIR__) . '/includes/bootstrap.php';
require dirname(__DIR__) . '/includes/auth_db.php';

nr_send_no_cache_headers();
nr_session_start();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    nr_json_response(['ok' => false, 'error' => 'Nur GET erlaubt.'], 405);
    exit;
}

if (!nr_rate_limit_ok(nr_client_ip())) {
    nr_json_response(['ok' => false, 'error' => 'Rate limit.'], 429);
    exit;
}

$user = nr_json_require_user();
$email = strtolower(trim((string) ($user['email'] ?? '')));
if ($email !== 'peer@pubben.de') {
    nr_json_response(['ok' => false, 'error' => 'Forbidden.'], 403);
    exit;
}

$limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 200;
$limit = max(1, min(2000, $limit));

$path = dirname(__DIR__) . '/cache/nav_debug_live.log';
if (!is_file($path) || !is_readable($path)) {
    nr_json_response(['ok' => true, 'file' => 'cache/nav_debug_live.log', 'lines' => []]);
    exit;
}

/**
 * @return list<string>
 */
function nr_tail_lines(string $filePath, int $maxLines): array
{
    $fh = @fopen($filePath, 'rb');
    if ($fh === false) {
        return [];
    }

    try {
        $stat = fstat($fh);
        $size = is_array($stat) && isset($stat['size']) ? (int) $stat['size'] : 0;
        if ($size <= 0) {
            return [];
        }

        $chunkSize = 8192;
        $maxBytes = 256 * 1024;
        $pos = $size;
        $buffer = '';

        while ($pos > 0 && substr_count($buffer, "\n") <= ($maxLines + 1) && strlen($buffer) < $maxBytes) {
            $read = min($chunkSize, $pos);
            $pos -= $read;
            if (fseek($fh, $pos) !== 0) {
                break;
            }
            $data = fread($fh, $read);
            if ($data === false || $data === '') {
                break;
            }
            $buffer = $data . $buffer;
        }

        $buffer = str_replace("\r\n", "\n", $buffer);
        $buffer = str_replace("\r", "\n", $buffer);
        $lines = explode("\n", trim($buffer, "\n"));
        if ($lines === [''] || $lines === []) {
            return [];
        }
        if (count($lines) > $maxLines) {
            $lines = array_slice($lines, -$maxLines);
        }

        return array_values(array_filter($lines, static fn($l) => $l !== ''));
    } finally {
        fclose($fh);
    }
}

$lines = nr_tail_lines($path, $limit);

nr_json_response([
    'ok' => true,
    'file' => 'cache/nav_debug_live.log',
    'lines' => $lines,
]);

