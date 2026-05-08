<?php

declare(strict_types=1);

/**
 * Kopie als config/config.local.php anlegen und API-Key eintragen.
 * @see https://openrouteservice.org/dev/#/signup
 */
return [
    'app' => [
        'base_url' => 'https://example.com/biketour',
    ],
    'openrouteservice' => [
        'base_url' => 'https://api.openrouteservice.org',
        'api_key' => '',
    ],
    'mail' => [
        'from_email' => 'noreply@example.com',
        'from_name' => 'NatureRide Navigator',
    ],
    /** Nominatim: gültiger Kontakt in der User-Agent-Zeile */
    'nominatim' => [
        'base_url' => 'https://nominatim.openstreetmap.org',
        'contact' => 'https://www.openstreetmap.org',
        'countrycodes' => 'de',
    ],
    /** Optional: eigener Overpass-Interpreter (Standard: overpass-api.de) */
    'overpass' => [
        'interpreter_url' => 'https://overpass-api.de/api/interpreter',
    ],
    'geocode_rate_limit' => [
        'max_requests' => 45,
        'window_seconds' => 3600,
    ],
    'rate_limit' => [
        'max_requests' => 60,
        'window_seconds' => 3600,
    ],
    'session_name' => 'NRNAVSESSID',
    /**
     * Admin-Tool (link-only) – NICHT im Repo mit echten Secrets befüllen.
     * Beispiel: /admin_tool.php?k=<token> (danach Passwortabfrage).
     */
    'admin_tool' => [
        'token' => 'CHANGE_ME_LONG_RANDOM_TOKEN',
        'password' => 'CHANGE_ME_ADMIN_PASSWORD',
    ],
];
