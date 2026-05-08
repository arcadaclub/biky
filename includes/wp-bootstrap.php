<?php

declare(strict_types=1);

/**
 * WordPress laden (wie postkarte/bootstrap-wp-auth.php), ohne Redirect.
 * Auf localhost / 127.0.0.1 wird kein WP geladen – lokale Entwicklung mit nr_users.
 */

function nr_wp_is_local_dev(): bool
{
    $host = $_SERVER['HTTP_HOST'] ?? '';
    $hostOnly = strtolower((string) preg_replace('/:\d+$/', '', $host));

    return $hostOnly === 'localhost'
        || $hostOnly === '127.0.0.1'
        || $hostOnly === '[::1]'
        || $hostOnly === '::1';
}

/**
 * Produktions-/Staging-Host: Anmeldung läuft über WordPress (Club-Konto).
 */
function nr_wp_login_environment(): bool
{
    return !nr_wp_is_local_dev();
}

function nr_wp_find_load_path(): ?string
{
    $currentDir = dirname(__DIR__);

    while (true) {
        $candidate = $currentDir . '/wp-load.php';
        if (file_exists($candidate)) {
            return $candidate;
        }
        $parentDir = dirname($currentDir);
        if ($parentDir === $currentDir) {
            return null;
        }
        $currentDir = $parentDir;
    }
}

/**
 * Lädt WordPress einmalig; auf lokaler Entwicklung immer false.
 */
function nr_wp_try_bootstrap(): bool
{
    if (function_exists('wp_authenticate')) {
        return true;
    }
    if (nr_wp_is_local_dev()) {
        return false;
    }

    static $attempted = false;
    static $ok = false;

    if ($attempted) {
        return $ok;
    }
    $attempted = true;

    $path = nr_wp_find_load_path();
    if ($path === null) {
        return false;
    }

    if (!defined('WP_USE_THEMES')) {
        define('WP_USE_THEMES', false);
    }

    require_once $path;

    $ok = function_exists('wp_authenticate') && function_exists('is_wp_error');

    return $ok;
}
