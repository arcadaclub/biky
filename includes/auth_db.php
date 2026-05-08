<?php

declare(strict_types=1);

function nr_db_config_path(): string
{
    return dirname(__DIR__) . '/private/db.local.php';
}

/**
 * @return array{host:string,port:string,name:string,user:string,pass:string,charset:string}
 */
function nr_db_config(): array
{
    static $cfg = null;
    if ($cfg !== null) {
        return $cfg;
    }
    $path = nr_db_config_path();
    if (!is_readable($path)) {
        throw new RuntimeException('Datenbank-Konfiguration fehlt.');
    }
    /** @var mixed $loaded */
    $loaded = require $path;
    if (!is_array($loaded)) {
        throw new RuntimeException('Datenbank-Konfiguration ist ungültig.');
    }
    $cfg = [
        'host' => (string) ($loaded['host'] ?? ''),
        'port' => (string) ($loaded['port'] ?? '3306'),
        'name' => (string) ($loaded['name'] ?? ''),
        'user' => (string) ($loaded['user'] ?? ''),
        'pass' => (string) ($loaded['pass'] ?? ''),
        'charset' => (string) ($loaded['charset'] ?? 'utf8mb4'),
    ];
    if ($cfg['host'] === '' || $cfg['name'] === '' || $cfg['user'] === '') {
        throw new RuntimeException('Datenbank-Konfiguration ist unvollständig.');
    }

    return $cfg;
}

function nr_db(): PDO
{
    static $pdo = null;
    static $schemaReady = false;
    if ($pdo === null) {
        $cfg = nr_db_config();
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            $cfg['host'],
            $cfg['port'],
            $cfg['name'],
            $cfg['charset']
        );
        $pdo = new PDO($dsn, $cfg['user'], $cfg['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    if (!$schemaReady) {
        nr_db_ensure_schema($pdo);
        $schemaReady = true;
    }

    return $pdo;
}

function nr_db_ensure_schema(PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS nr_users (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(190) NOT NULL,
            display_name VARCHAR(120) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            email_verified_at TIMESTAMP NULL DEFAULT NULL,
            fitness_points INT UNSIGNED NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_nr_users_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $emailVerifiedAdded = nr_db_ensure_column(
        $pdo,
        'nr_users',
        'email_verified_at',
        'ALTER TABLE nr_users ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL AFTER password_hash'
    );
    if ($emailVerifiedAdded) {
        $pdo->exec('UPDATE nr_users SET email_verified_at = created_at WHERE email_verified_at IS NULL');
    }
    nr_db_ensure_column(
        $pdo,
        'nr_users',
        'fitness_points',
        'ALTER TABLE nr_users ADD COLUMN fitness_points INT UNSIGNED NOT NULL DEFAULT 0 AFTER email_verified_at'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS nr_saved_routes (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT UNSIGNED NOT NULL,
            title VARCHAR(180) NOT NULL,
            profile VARCHAR(40) NOT NULL DEFAULT "",
            route_kind VARCHAR(40) NOT NULL DEFAULT "",
            distance_km DECIMAL(8,2) DEFAULT NULL,
            duration_min INT DEFAULT NULL,
            route_payload LONGTEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_nr_saved_routes_user_id (user_id),
            CONSTRAINT fk_nr_saved_routes_user
                FOREIGN KEY (user_id) REFERENCES nr_users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS nr_address_book (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT UNSIGNED NOT NULL,
            title VARCHAR(180) NOT NULL DEFAULT "",
            start_lat DECIMAL(10,7) NOT NULL,
            start_lng DECIMAL(10,7) NOT NULL,
            goal_lat DECIMAL(10,7) NOT NULL,
            goal_lng DECIMAL(10,7) NOT NULL,
            start_place VARCHAR(180) NOT NULL DEFAULT "",
            start_street VARCHAR(180) NOT NULL DEFAULT "",
            goal_place VARCHAR(180) NOT NULL DEFAULT "",
            goal_street VARCHAR(180) NOT NULL DEFAULT "",
            times_used INT UNSIGNED NOT NULL DEFAULT 1,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_nr_address_book_user_updated (user_id, updated_at),
            KEY idx_nr_address_book_user_id (user_id),
            CONSTRAINT fk_nr_address_book_user
                FOREIGN KEY (user_id) REFERENCES nr_users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    nr_db_ensure_column(
        $pdo,
        'nr_address_book',
        'title',
        'ALTER TABLE nr_address_book ADD COLUMN title VARCHAR(180) NOT NULL DEFAULT "" AFTER user_id'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS nr_auth_tokens (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT UNSIGNED NOT NULL,
            purpose VARCHAR(32) NOT NULL,
            token_hash CHAR(64) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            consumed_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_nr_auth_tokens_token_hash (token_hash),
            KEY idx_nr_auth_tokens_user_purpose (user_id, purpose),
            KEY idx_nr_auth_tokens_purpose_expires (purpose, expires_at),
            CONSTRAINT fk_nr_auth_tokens_user
                FOREIGN KEY (user_id) REFERENCES nr_users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS nr_user_settings (
            user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            settings_json LONGTEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_nr_user_settings_user
                FOREIGN KEY (user_id) REFERENCES nr_users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

function nr_db_ensure_column(PDO $pdo, string $table, string $column, string $alterSql): bool
{
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table_name AND COLUMN_NAME = :column_name'
    );
    $stmt->execute([
        'table_name' => $table,
        'column_name' => $column,
    ]);
    $exists = (int) $stmt->fetchColumn() > 0;
    if ($exists) {
        return false;
    }
    $pdo->exec($alterSql);

    return true;
}

/**
 * @param array<string, mixed> $row
 * @return array{id:int,email:string,display_name:string,fitness_points:int}
 */
function nr_auth_public_user(array $row): array
{
    $email = isset($row['email']) ? (string) $row['email'] : '';
    $displayName = isset($row['display_name']) ? (string) $row['display_name'] : '';
    $fitnessPoints = isset($row['fitness_points']) && is_numeric($row['fitness_points'])
        ? max(0, (int) $row['fitness_points'])
        : 0;

    return [
        'id' => (int) ($row['id'] ?? 0),
        'email' => $email,
        'display_name' => $displayName !== '' ? $displayName : $email,
        'fitness_points' => $fitnessPoints,
    ];
}

/**
 * @return array{id:int,email:string,display_name:string,fitness_points:int}|null
 */
function nr_auth_current_user(): ?array
{
    nr_session_start();
    $user = $_SESSION['nr_user'] ?? null;
    if (!is_array($user)) {
        return null;
    }
    $id = isset($user['id']) ? (int) $user['id'] : 0;
    $email = isset($user['email']) ? (string) $user['email'] : '';
    $displayName = isset($user['display_name']) ? (string) $user['display_name'] : '';
    $fitnessPoints = isset($user['fitness_points']) && is_numeric($user['fitness_points'])
        ? max(0, (int) $user['fitness_points'])
        : 0;
    if ($id <= 0 || $email === '') {
        return null;
    }

    return [
        'id' => $id,
        'email' => $email,
        'display_name' => $displayName !== '' ? $displayName : $email,
        'fitness_points' => $fitnessPoints,
    ];
}

/**
 * @param array{id:int,email:string,display_name:string,fitness_points?:int} $user
 */
function nr_auth_set_user(array $user): void
{
    nr_session_start();
    unset($_SESSION['nr_user'], $_SESSION['nr_settings']);
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }
    $_SESSION['nr_user'] = [
        'id' => (int) $user['id'],
        'email' => (string) $user['email'],
        'display_name' => (string) $user['display_name'],
        'fitness_points' => isset($user['fitness_points']) ? max(0, (int) $user['fitness_points']) : 0,
    ];
}

function nr_auth_logout(): void
{
    nr_session_start();
    unset($_SESSION['nr_user'], $_SESSION['nr_settings']);
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }
}

/**
 * @return list<string>
 */
function nr_auth_allowed_settings_keys(): array
{
    return ['lastProfile', 'panelOpen', 'lastMaxDetourKm', 'orsApiKey', 'ttsEngine', 'navDebugLogEnabled'];
}

/**
 * @param array<string, mixed> $data
 * @return array<string, mixed>
 */
function nr_auth_normalize_settings(array $data): array
{
    $out = [];
    foreach (nr_auth_allowed_settings_keys() as $key) {
        if (!array_key_exists($key, $data)) {
            continue;
        }
        if ($key === 'lastProfile' && is_string($data[$key])) {
            $p = strtolower(trim($data[$key]));
            if (in_array($p, ['natur', 'gravel', 'ruhig', 'abenteuer', 'radwege'], true)) {
                $out['lastProfile'] = $p;
            }
            continue;
        }
        if ($key === 'panelOpen' && is_bool($data[$key])) {
            $out['panelOpen'] = $data[$key];
            continue;
        }
        if ($key === 'lastMaxDetourKm' && is_numeric($data[$key])) {
            $out['lastMaxDetourKm'] = max(0, min(80, (int) $data[$key]));
            continue;
        }
        if ($key === 'orsApiKey' && is_string($data[$key])) {
            $out['orsApiKey'] = mb_substr(trim($data[$key]), 0, 512);
            continue;
        }
        if ($key === 'ttsEngine' && is_string($data[$key])) {
            $e = strtolower(trim($data[$key]));
            if (in_array($e, ['piper', 'system'], true)) {
                $out['ttsEngine'] = $e;
            }
            continue;
        }
        if ($key === 'navDebugLogEnabled') {
            $out['navDebugLogEnabled'] = (bool) $data[$key];
        }
    }

    return $out;
}

/**
 * @return array<string, mixed>
 */
function nr_auth_session_settings(): array
{
    nr_session_start();
    $settings = $_SESSION['nr_settings'] ?? [];

    return is_array($settings) ? nr_auth_normalize_settings($settings) : [];
}

/**
 * @param array<string, mixed> $settings
 * @return array<string, mixed>
 */
function nr_auth_set_session_settings(array $settings): array
{
    nr_session_start();
    $_SESSION['nr_settings'] = nr_auth_normalize_settings($settings);

    return $_SESSION['nr_settings'];
}

/**
 * @return array<string, mixed>
 */
function nr_auth_load_user_settings(PDO $pdo, int $userId): array
{
    if ($userId <= 0) {
        return [];
    }
    $stmt = $pdo->prepare('SELECT settings_json FROM nr_user_settings WHERE user_id = :user_id LIMIT 1');
    $stmt->execute(['user_id' => $userId]);
    $raw = $stmt->fetchColumn();
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }
    try {
        /** @var mixed $decoded */
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable $e) {
        return [];
    }

    return is_array($decoded) ? nr_auth_normalize_settings($decoded) : [];
}

/**
 * @param array<string, mixed> $settings
 * @return array<string, mixed>
 */
function nr_auth_save_user_settings(PDO $pdo, int $userId, array $settings): array
{
    if ($userId <= 0) {
        throw new RuntimeException('Ungültiger Benutzer.');
    }
    $merged = array_merge(nr_auth_load_user_settings($pdo, $userId), nr_auth_normalize_settings($settings));
    $stmt = $pdo->prepare(
        'INSERT INTO nr_user_settings (user_id, settings_json)
         VALUES (:user_id, :settings_json)
         ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        'user_id' => $userId,
        'settings_json' => json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);

    return $merged;
}

/**
 * @return array<string, mixed>
 */
function nr_auth_hydrate_session_settings(PDO $pdo, int $userId): array
{
    $settings = nr_auth_load_user_settings($pdo, $userId);
    nr_auth_set_session_settings($settings);

    return $settings;
}

/**
 * @return array{id:int,email:string,display_name:string}
 */
function nr_auth_require_user(): array
{
    $user = nr_auth_current_user();
    if ($user === null) {
        throw new RuntimeException('Bitte zuerst anmelden.');
    }

    return $user;
}

/**
 * Beendet mit JSON 401, wenn keine gültige Anmeldesession besteht (API-Schutz).
 *
 * @return array{id:int,email:string,display_name:string}
 */
function nr_json_require_user(): array
{
    $user = nr_auth_current_user();
    if ($user === null) {
        nr_json_response(
            [
                'ok' => false,
                'error' => 'Bitte zuerst anmelden.',
                'auth_required' => true,
            ],
            401
        );
        exit;
    }

    return $user;
}

function nr_auth_set_notice(string $message): void
{
    nr_session_start();
    $_SESSION['nr_auth_notice'] = trim($message);
}

function nr_auth_pull_notice(): string
{
    nr_session_start();
    $message = $_SESSION['nr_auth_notice'] ?? '';
    unset($_SESSION['nr_auth_notice']);

    return is_string($message) ? trim($message) : '';
}

function nr_auth_mail_config(): array
{
    $cfg = nr_config();
    $mail = isset($cfg['mail']) && is_array($cfg['mail']) ? $cfg['mail'] : [];
    $fromEmail = isset($mail['from_email']) ? trim((string) $mail['from_email']) : '';
    $fromName = isset($mail['from_name']) ? trim((string) $mail['from_name']) : 'NatureRide Navigator';
    if ($fromEmail === '') {
        $host = isset($_SERVER['HTTP_HOST']) ? trim((string) $_SERVER['HTTP_HOST']) : '';
        $host = preg_replace('/:\d+$/', '', $host ?? '');
        if (is_string($host) && $host !== '') {
            $candidate = 'noreply@' . $host;
            if (filter_var($candidate, FILTER_VALIDATE_EMAIL)) {
                $fromEmail = $candidate;
            }
        }
    }
    if ($fromEmail === '') {
        $fromEmail = 'noreply@natureride.local';
    }

    return [
        'from_email' => $fromEmail,
        'from_name' => $fromName !== '' ? $fromName : 'NatureRide Navigator',
    ];
}

function nr_auth_app_base_url(): string
{
    $cfg = nr_config();
    $app = isset($cfg['app']) && is_array($cfg['app']) ? $cfg['app'] : [];
    $base = isset($app['base_url']) ? trim((string) $app['base_url']) : '';
    if ($base !== '') {
        return rtrim($base, '/');
    }

    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443');
    $scheme = $https ? 'https' : 'http';
    $host = isset($_SERVER['HTTP_HOST']) ? trim((string) $_SERVER['HTTP_HOST']) : '';
    if ($host === '') {
        $scriptName = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
        $scriptDir = str_replace('\\', '/', dirname($scriptName));
        $basePath = ($scriptDir !== '/' && $scriptDir !== '.' && $scriptDir !== '') ? rtrim($scriptDir, '/') : '';
        if ($basePath === '/api') {
            $basePath = '';
        } elseif (substr($basePath, -4) === '/api') {
            $basePath = substr($basePath, 0, -4);
        }
        return 'http://localhost' . $basePath;
    }
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
    $scriptDir = str_replace('\\', '/', dirname($scriptName));
    $basePath = ($scriptDir !== '/' && $scriptDir !== '.' && $scriptDir !== '') ? rtrim($scriptDir, '/') : '';
    if ($basePath === '/api') {
        $basePath = '';
    } elseif (substr($basePath, -4) === '/api') {
        $basePath = substr($basePath, 0, -4);
    }

    return $scheme . '://' . $host . $basePath;
}

function nr_auth_build_absolute_url(string $path, array $params = []): string
{
    $url = nr_auth_app_base_url() . '/' . ltrim($path, '/');
    if ($params !== []) {
        $url .= '?' . http_build_query($params);
    }

    return $url;
}

function nr_auth_send_mail(string $toEmail, string $subject, string $plainText): void
{
    $mailCfg = nr_auth_mail_config();
    if ($mailCfg['from_email'] === '' || !filter_var($mailCfg['from_email'], FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Mail-Absender ist nicht konfiguriert. Bitte config.local.php ergänzen.');
    }
    $toEmail = trim($toEmail);
    if (!filter_var($toEmail, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Empfänger-E-Mail ist ungültig.');
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
        'Reply-To: ' . $mailCfg['from_email'],
        'X-Mailer: PHP/' . PHP_VERSION,
    ];
    $sent = @mail($toEmail, $subjectEncoded, $plainText, implode("\r\n", $headers));
    if (!$sent) {
        throw new RuntimeException('E-Mail konnte nicht versendet werden.');
    }
}

/**
 * @return array{id:int,email:string,display_name:string,fitness_points:int,password_hash:string,email_verified_at:?string}|null
 */
function nr_auth_find_user_by_email(PDO $pdo, string $email): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, email, display_name, fitness_points, password_hash, email_verified_at
         FROM nr_users WHERE email = :email LIMIT 1'
    );
    $stmt->execute(['email' => mb_strtolower(trim($email))]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        return null;
    }

    return [
        'id' => (int) $row['id'],
        'email' => (string) $row['email'],
        'display_name' => (string) $row['display_name'],
        'fitness_points' => isset($row['fitness_points']) ? max(0, (int) $row['fitness_points']) : 0,
        'password_hash' => (string) $row['password_hash'],
        'email_verified_at' => isset($row['email_verified_at']) && $row['email_verified_at'] !== null
            ? (string) $row['email_verified_at']
            : null,
    ];
}

/**
 * @return array{id:int,email:string,display_name:string,fitness_points:int,password_hash:string,email_verified_at:?string}|null
 */
function nr_auth_find_user_by_id(PDO $pdo, int $userId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT id, email, display_name, fitness_points, password_hash, email_verified_at
         FROM nr_users WHERE id = :id LIMIT 1'
    );
    $stmt->execute(['id' => $userId]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        return null;
    }

    return [
        'id' => (int) $row['id'],
        'email' => (string) $row['email'],
        'display_name' => (string) $row['display_name'],
        'fitness_points' => isset($row['fitness_points']) ? max(0, (int) $row['fitness_points']) : 0,
        'password_hash' => (string) $row['password_hash'],
        'email_verified_at' => isset($row['email_verified_at']) && $row['email_verified_at'] !== null
            ? (string) $row['email_verified_at']
            : null,
    ];
}

function nr_auth_is_verified(array $user): bool
{
    return isset($user['email_verified_at']) && $user['email_verified_at'] !== null && $user['email_verified_at'] !== '';
}

function nr_auth_password_is_valid(string $password): bool
{
    return strlen($password) >= 8;
}

/**
 * @return array{raw:string,hash:string}
 */
function nr_auth_generate_token_pair(): array
{
    $raw = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');

    return [
        'raw' => $raw,
        'hash' => hash('sha256', $raw),
    ];
}

function nr_auth_delete_open_tokens(PDO $pdo, int $userId, string $purpose): void
{
    $stmt = $pdo->prepare(
        'DELETE FROM nr_auth_tokens WHERE user_id = :user_id AND purpose = :purpose AND consumed_at IS NULL'
    );
    $stmt->execute([
        'user_id' => $userId,
        'purpose' => $purpose,
    ]);
}

function nr_auth_issue_token(PDO $pdo, int $userId, string $purpose, int $ttlSeconds): string
{
    nr_auth_delete_open_tokens($pdo, $userId, $purpose);
    $pair = nr_auth_generate_token_pair();
    $stmt = $pdo->prepare(
        'INSERT INTO nr_auth_tokens (user_id, purpose, token_hash, expires_at)
         VALUES (:user_id, :purpose, :token_hash, :expires_at)'
    );
    $expiresAt = gmdate('Y-m-d H:i:s', time() + max(300, $ttlSeconds));
    $stmt->execute([
        'user_id' => $userId,
        'purpose' => $purpose,
        'token_hash' => $pair['hash'],
        'expires_at' => $expiresAt,
    ]);

    return $pair['raw'];
}

/**
 * @return array{id:int,user_id:int,purpose:string,expires_at:string,email:string,display_name:string,password_hash:string,email_verified_at:?string}|null
 */
function nr_auth_find_valid_token(PDO $pdo, string $rawToken, string $purpose): ?array
{
    $hash = hash('sha256', trim($rawToken));
    $stmt = $pdo->prepare(
        'SELECT
            t.id,
            t.user_id,
            t.purpose,
            t.expires_at,
            u.email,
            u.display_name,
            u.password_hash,
            u.email_verified_at
         FROM nr_auth_tokens t
         INNER JOIN nr_users u ON u.id = t.user_id
         WHERE t.token_hash = :token_hash
           AND t.purpose = :purpose
           AND t.consumed_at IS NULL
           AND t.expires_at >= UTC_TIMESTAMP()
         LIMIT 1'
    );
    $stmt->execute([
        'token_hash' => $hash,
        'purpose' => $purpose,
    ]);
    $row = $stmt->fetch();
    if (!is_array($row)) {
        return null;
    }

    return [
        'id' => (int) $row['id'],
        'user_id' => (int) $row['user_id'],
        'purpose' => (string) $row['purpose'],
        'expires_at' => (string) $row['expires_at'],
        'email' => (string) $row['email'],
        'display_name' => (string) $row['display_name'],
        'password_hash' => (string) $row['password_hash'],
        'email_verified_at' => isset($row['email_verified_at']) && $row['email_verified_at'] !== null
            ? (string) $row['email_verified_at']
            : null,
    ];
}

function nr_auth_consume_token_record(PDO $pdo, int $tokenId): void
{
    $stmt = $pdo->prepare('UPDATE nr_auth_tokens SET consumed_at = UTC_TIMESTAMP() WHERE id = :id');
    $stmt->execute(['id' => $tokenId]);
}

function nr_auth_send_verification_email(PDO $pdo, array $user): void
{
    $token = nr_auth_issue_token($pdo, (int) $user['id'], 'verify_email', 60 * 60 * 24 * 2);
    $link = nr_auth_build_absolute_url('auth_verify.php', ['token' => $token]);
    $name = trim((string) ($user['display_name'] ?? $user['email'] ?? ''));
    $text =
        "Hallo " . $name . ",\n\n" .
        "bitte bestaetigen Sie Ihre E-Mail-Adresse fuer NatureRide ueber diesen Link:\n" .
        $link . "\n\n" .
        "Der Link ist 48 Stunden gueltig.\n\n" .
        "Falls Sie diese Registrierung nicht angefordert haben, koennen Sie diese E-Mail ignorieren.\n";
    nr_auth_send_mail((string) $user['email'], 'NatureRide: E-Mail bestaetigen', $text);
}

function nr_auth_send_reset_email(PDO $pdo, array $user): void
{
    $token = nr_auth_issue_token($pdo, (int) $user['id'], 'reset_password', 60 * 60);
    $link = nr_auth_build_absolute_url('auth_reset.php', ['token' => $token]);
    $name = trim((string) ($user['display_name'] ?? $user['email'] ?? ''));
    $text =
        "Hallo " . $name . ",\n\n" .
        "ueber diesen Link koennen Sie Ihr NatureRide-Passwort neu setzen:\n" .
        $link . "\n\n" .
        "Der Link ist 60 Minuten gueltig.\n\n" .
        "Falls Sie diese Anfrage nicht gestellt haben, koennen Sie diese E-Mail ignorieren.\n";
    nr_auth_send_mail((string) $user['email'], 'NatureRide: Passwort zuruecksetzen', $text);
}

/**
 * @return array{id:int,email:string,display_name:string}
 */
function nr_auth_register_user(PDO $pdo, string $email, string $displayName, string $password): array
{
    $email = mb_strtolower(trim($email));
    $displayName = trim($displayName);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Bitte eine gültige E-Mail-Adresse eingeben.');
    }
    if (mb_strlen($displayName) < 2 || mb_strlen($displayName) > 120) {
        throw new RuntimeException('Der Anzeigename muss zwischen 2 und 120 Zeichen lang sein.');
    }
    if (!nr_auth_password_is_valid($password)) {
        throw new RuntimeException('Das Passwort muss mindestens 8 Zeichen lang sein.');
    }
    if (nr_auth_find_user_by_email($pdo, $email) !== null) {
        throw new RuntimeException('Für diese E-Mail-Adresse gibt es bereits ein Konto.');
    }
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO nr_users (email, display_name, password_hash, email_verified_at)
             VALUES (:email, :display_name, :password_hash, NULL)'
        );
        $stmt->execute([
            'email' => $email,
            'display_name' => $displayName,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
        ]);
        $user = [
            'id' => (int) $pdo->lastInsertId(),
            'email' => $email,
            'display_name' => $displayName,
            'fitness_points' => 0,
            'password_hash' => '',
            'email_verified_at' => null,
        ];
        nr_auth_send_verification_email($pdo, $user);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    return nr_auth_public_user($user);
}

/**
 * Übernimmt Anzeigename aus WordPress und stellt sicher, dass ein nr_users-Datensatz existiert
 * (Fitnesspunkte, gespeicherte Routen, Einstellungen bleiben an dieser ID hängen).
 *
 * @param \WP_User|object $wpUser Von wp_authenticate geliefertes Objekt
 * @return array{id:int,email:string,display_name:string,fitness_points:int}
 */
function nr_auth_sync_wordpress_user(PDO $pdo, object $wpUser): array
{
    $wpUserId = isset($wpUser->ID) ? (int) $wpUser->ID : 0;
    if ($wpUserId <= 0) {
        throw new RuntimeException('Ungültiger WordPress-Benutzer.');
    }
    $email = isset($wpUser->user_email) ? mb_strtolower(trim((string) $wpUser->user_email)) : '';
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('Der WordPress-Benutzer hat keine gültige E-Mail-Adresse.');
    }
    $displayName = isset($wpUser->display_name) ? trim((string) $wpUser->display_name) : '';
    if ($displayName === '') {
        $nicename = isset($wpUser->user_nicename) ? trim((string) $wpUser->user_nicename) : '';
        $login = isset($wpUser->user_login) ? trim((string) $wpUser->user_login) : '';
        $displayName = $nicename !== '' ? $nicename : ($login !== '' ? $login : $email);
    }
    if (mb_strlen($displayName) > 120) {
        $displayName = mb_substr($displayName, 0, 120);
    }

    $existing = nr_auth_find_user_by_email($pdo, $email);
    if ($existing !== null) {
        $stmt = $pdo->prepare(
            'UPDATE nr_users SET display_name = :display_name, email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = :id'
        );
        $stmt->execute([
            'display_name' => $displayName,
            'id' => $existing['id'],
        ]);
        $fresh = nr_auth_find_user_by_id($pdo, (int) $existing['id']);
        if ($fresh === null) {
            throw new RuntimeException('Benutzer konnte nicht geladen werden.');
        }

        return nr_auth_public_user($fresh);
    }

    $placeholderHash = password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT);
    $stmt = $pdo->prepare(
        'INSERT INTO nr_users (email, display_name, password_hash, email_verified_at)
         VALUES (:email, :display_name, :password_hash, UTC_TIMESTAMP())'
    );
    $stmt->execute([
        'email' => $email,
        'display_name' => $displayName,
        'password_hash' => $placeholderHash,
    ]);
    $id = (int) $pdo->lastInsertId();
    $fresh = nr_auth_find_user_by_id($pdo, $id);
    if ($fresh === null) {
        throw new RuntimeException('Benutzer konnte nicht angelegt werden.');
    }

    return nr_auth_public_user($fresh);
}

/**
 * @return array{id:int,email:string,display_name:string,fitness_points:int}
 */
function nr_auth_login_user(PDO $pdo, string $email, string $password): array
{
    require_once __DIR__ . '/wp-bootstrap.php';

    if (nr_wp_login_environment()) {
        if (!nr_wp_try_bootstrap()) {
            throw new RuntimeException('Anmeldung ist vorübergehend nicht verfügbar. Bitte versuchen Sie es später erneut.');
        }
        $login = trim($email);
        if ($login === '') {
            throw new RuntimeException('Bitte Benutzername oder E-Mail eingeben.');
        }
        $wpUser = wp_authenticate($login, $password);
        if (is_wp_error($wpUser)) {
            throw new RuntimeException('Benutzername/E-Mail oder Passwort ist falsch.');
        }

        return nr_auth_sync_wordpress_user($pdo, $wpUser);
    }

    $found = nr_auth_find_user_by_email($pdo, $email);
    if ($found === null || !password_verify($password, $found['password_hash'])) {
        throw new RuntimeException('E-Mail oder Passwort ist falsch.');
    }
    if (!nr_auth_is_verified($found)) {
        throw new RuntimeException('Bitte zuerst Ihre E-Mail-Adresse bestätigen.');
    }

    return nr_auth_public_user($found);
}

function nr_auth_add_fitness_points(PDO $pdo, int $userId, int $delta): array
{
    if ($userId <= 0) {
        throw new RuntimeException('Ungültiger Benutzer.');
    }
    if ($delta <= 0 || $delta > 10) {
        throw new RuntimeException('Ungültige Punktzahl.');
    }

    $stmt = $pdo->prepare(
        'UPDATE nr_users
         SET fitness_points = LEAST(4294967295, fitness_points + :delta)
         WHERE id = :id'
    );
    $stmt->execute([
        'delta' => $delta,
        'id' => $userId,
    ]);
    $user = nr_auth_find_user_by_id($pdo, $userId);
    if ($user === null) {
        throw new RuntimeException('Benutzer nicht gefunden.');
    }
    $publicUser = nr_auth_public_user($user);
    nr_session_start();
    if (isset($_SESSION['nr_user']) && is_array($_SESSION['nr_user']) && (int) ($_SESSION['nr_user']['id'] ?? 0) === $userId) {
        $_SESSION['nr_user'] = $publicUser;
    }

    return $publicUser;
}

function nr_auth_resend_verification(PDO $pdo, string $email): void
{
    $found = nr_auth_find_user_by_email($pdo, $email);
    if ($found === null) {
        return;
    }
    if (nr_auth_is_verified($found)) {
        return;
    }
    nr_auth_send_verification_email($pdo, $found);
}

function nr_auth_request_password_reset(PDO $pdo, string $email): void
{
    $found = nr_auth_find_user_by_email($pdo, $email);
    if ($found === null) {
        return;
    }
    if (!nr_auth_is_verified($found)) {
        nr_auth_send_verification_email($pdo, $found);
        return;
    }
    nr_auth_send_reset_email($pdo, $found);
}

/**
 * @return array{id:int,email:string,display_name:string,password_hash:string,email_verified_at:?string}
 */
function nr_auth_verify_email_with_token(PDO $pdo, string $rawToken): array
{
    $token = nr_auth_find_valid_token($pdo, $rawToken, 'verify_email');
    if ($token === null) {
        throw new RuntimeException('Der Bestätigungslink ist ungültig oder abgelaufen.');
    }
    $stmt = $pdo->prepare(
        'UPDATE nr_users SET email_verified_at = COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id = :id'
    );
    $stmt->execute(['id' => $token['user_id']]);
    nr_auth_consume_token_record($pdo, (int) $token['id']);
    nr_auth_delete_open_tokens($pdo, (int) $token['user_id'], 'verify_email');
    $user = nr_auth_find_user_by_id($pdo, (int) $token['user_id']);
    if ($user === null) {
        throw new RuntimeException('Benutzerkonto wurde nicht gefunden.');
    }

    return $user;
}

/**
 * @return array{id:int,email:string,display_name:string,password_hash:string,email_verified_at:?string}
 */
function nr_auth_require_reset_token(PDO $pdo, string $rawToken): array
{
    $token = nr_auth_find_valid_token($pdo, $rawToken, 'reset_password');
    if ($token === null) {
        throw new RuntimeException('Der Passwort-Link ist ungültig oder abgelaufen.');
    }

    return [
        'id' => (int) $token['user_id'],
        'email' => (string) $token['email'],
        'display_name' => (string) $token['display_name'],
        'password_hash' => (string) $token['password_hash'],
        'email_verified_at' => $token['email_verified_at'],
    ];
}

/**
 * @return array{id:int,email:string,display_name:string,password_hash:string,email_verified_at:?string}
 */
function nr_auth_reset_password_with_token(PDO $pdo, string $rawToken, string $newPassword): array
{
    if (!nr_auth_password_is_valid($newPassword)) {
        throw new RuntimeException('Das Passwort muss mindestens 8 Zeichen lang sein.');
    }
    $token = nr_auth_find_valid_token($pdo, $rawToken, 'reset_password');
    if ($token === null) {
        throw new RuntimeException('Der Passwort-Link ist ungültig oder abgelaufen.');
    }
    $stmt = $pdo->prepare('UPDATE nr_users SET password_hash = :password_hash WHERE id = :id');
    $stmt->execute([
        'id' => $token['user_id'],
        'password_hash' => password_hash($newPassword, PASSWORD_DEFAULT),
    ]);
    nr_auth_consume_token_record($pdo, (int) $token['id']);
    nr_auth_delete_open_tokens($pdo, (int) $token['user_id'], 'reset_password');
    $user = nr_auth_find_user_by_id($pdo, (int) $token['user_id']);
    if ($user === null) {
        throw new RuntimeException('Benutzerkonto wurde nicht gefunden.');
    }

    return $user;
}

/**
 * @return array<string, mixed>
 */
function nr_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    try {
        /** @var mixed $decoded */
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        throw new RuntimeException('Ungültiges JSON.');
    }
    if (!is_array($decoded)) {
        throw new RuntimeException('Ungültige Anfrage.');
    }

    return $decoded;
}
