<?php

declare(strict_types=1);

require __DIR__ . '/includes/bootstrap.php';
require __DIR__ . '/includes/wp-bootstrap.php';
require __DIR__ . '/includes/auth_db.php';

$nrWordPressAuth = nr_wp_login_environment();

nr_send_no_cache_headers();
nr_session_start();
$csrf = nr_csrf_token();
$currentUser = nr_auth_current_user();
if ($currentUser) {
    try {
        $freshUser = nr_auth_find_user_by_id(nr_db(), (int) $currentUser['id']);
        if ($freshUser !== null) {
            $currentUser = nr_auth_public_user($freshUser);
            $_SESSION['nr_user'] = $currentUser;
        }
    } catch (Throwable $e) {
        // Seite bleibt auch erreichbar, wenn das Profil kurzfristig nicht nachgeladen werden kann.
    }
}
$authNotice = nr_auth_pull_notice();
$settings = $_SESSION['nr_settings'] ?? [];
if (!is_array($settings)) {
    $settings = [];
}
$profileRaw = 'natur';
if (isset($settings['lastProfile']) && is_string($settings['lastProfile'])) {
    $p = strtolower(trim($settings['lastProfile']));
    if (in_array($p, ['natur', 'gravel', 'offroad', 'kurvig', 'ruhig', 'abenteuer', 'radwege'], true)) {
        $profileRaw = $p;
    }
}
$maxDetourInit = 0;
if (isset($settings['lastMaxDetourKm']) && is_numeric($settings['lastMaxDetourKm'])) {
    $maxDetourInit = max(0, min(80, (int) $settings['lastMaxDetourKm']));
}
$orsApiKeyInit = '';
if (isset($settings['orsApiKey']) && is_string($settings['orsApiKey'])) {
    $orsApiKeyInit = trim($settings['orsApiKey']);
}
$showNavDebugLog = $currentUser && strcasecmp((string) ($currentUser['email'] ?? ''), 'peer@pubben.de') === 0;
$navDebugLogEnabledInit = $showNavDebugLog && !empty($settings['navDebugLogEnabled']);

$nrOrsServerKeyConfigured = false;
try {
    $nrOrsBloc = nr_config()['openrouteservice'] ?? [];
    if (is_array($nrOrsBloc) && trim((string) ($nrOrsBloc['api_key'] ?? '')) !== '') {
        $nrOrsServerKeyConfigured = true;
    }
} catch (Throwable $e) {
    $nrOrsServerKeyConfigured = false;
}

$topBarDisplayName = '';
if ($currentUser) {
    $topBarDisplayName = trim((string) ($currentUser['display_name'] ?? ''));
    if ($topBarDisplayName === '') {
        $em = trim((string) ($currentUser['email'] ?? ''));
        if ($em !== '') {
            $at = strpos($em, '@');
            $topBarDisplayName = $at !== false && $at > 0 ? substr($em, 0, $at) : $em;
        }
    }
    if ($topBarDisplayName === '' && isset($currentUser['id'])) {
        $topBarDisplayName = 'Nutzer #' . (int) $currentUser['id'];
    }
}

$nrBasePath = '';
$scriptName = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
$scriptDir = str_replace('\\', '/', dirname($scriptName));
if ($scriptDir !== '/' && $scriptDir !== '.' && $scriptDir !== '') {
    $nrBasePath = rtrim($scriptDir, '/');
}
$onnxRuntimeImportUrl = ($nrBasePath !== '' ? $nrBasePath : '') . '/assets/vendor/onnxruntime-web/ort.min.js';
$appCssPath = __DIR__ . '/assets/css/app.css';
$appCssHref = 'assets/css/app.css';
if (is_file($appCssPath)) {
    $appCssHref .= '?v=' . (string) filemtime($appCssPath);
}
$manifestPath = __DIR__ . '/manifest.webmanifest';
$manifestHref = 'manifest.webmanifest';
if (is_file($manifestPath)) {
    $manifestHref .= '?v=' . (string) filemtime($manifestPath);
}
$geoHelpersPath = __DIR__ . '/assets/js/geo-helpers.js';
$geoHelpersHref = 'assets/js/geo-helpers.js';
if (is_file($geoHelpersPath)) {
    $geoHelpersHref .= '?v=' . (string) filemtime($geoHelpersPath);
}
$piperTtsPath = __DIR__ . '/assets/js/nr-piper-tts.js';
$piperTtsHref = 'assets/js/nr-piper-tts.js';
if (is_file($piperTtsPath)) {
    $piperTtsHref .= '?v=' . (string) filemtime($piperTtsPath);
}
$navigationJsPath = __DIR__ . '/assets/js/navigation.js';
$navigationJsHref = 'assets/js/navigation.js';
if (is_file($navigationJsPath)) {
    $navigationJsHref .= '?v=' . (string) filemtime($navigationJsPath);
}
$appJsPath = __DIR__ . '/assets/js/app.js';
$appJsHref = 'assets/js/app.js';
if (is_file($appJsPath)) {
    $appJsHref .= '?v=' . (string) filemtime($appJsPath);
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="description" content="Biky – naturnahe Fahrradrouten mit OpenStreetMap">
    <meta name="theme-color" content="#1a4d2e">
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Biky">
    <?php
    // Import Map MUSS vor modulepreload / type="module" stehen, sonst:
    // "Import-Maps sind nicht erlaubt, nachdem ein Modul geladen oder vorgeladen wurde"
    // und Piper kann "onnxruntime-web" nicht auflösen.
    $onnxRuntimeImportMapJson = json_encode(
        ['imports' => ['onnxruntime-web' => $onnxRuntimeImportUrl]],
        JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT
    );
    ?>
    <script type="importmap">
        <?= $onnxRuntimeImportMapJson ?>
    </script>
    <link rel="manifest" href="<?= htmlspecialchars($manifestHref, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="stylesheet" href="<?= htmlspecialchars($nrBasePath, ENT_QUOTES, 'UTF-8') ?>/assets/vendor/leaflet/leaflet.css">
    <link rel="stylesheet" href="<?= htmlspecialchars($appCssHref, ENT_QUOTES, 'UTF-8') ?>">
    <link rel="modulepreload" href="<?= htmlspecialchars($nrBasePath, ENT_QUOTES, 'UTF-8') ?>/assets/vendor/piper-tts-web/piper-tts-web.js">
    <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js" defer></script>
    <title>Biky v2.2</title>
</head>
<body>
    <?php if (!$currentUser): ?>
    <div id="login-screen" class="login-screen" role="dialog" aria-modal="true" aria-labelledby="login-screen-title">
        <div class="login-screen-card">
            <h1 class="login-screen-brand">Biky <span class="brand-version">v2.2</span></h1>
            <h2 id="login-screen-title" class="login-screen-title">Anmelden</h2>
            <p class="login-screen-copy"><?= $nrWordPressAuth
                ? 'Melden Sie sich mit Ihrem Club-Konto (WordPress) an.'
                : 'Mit Ihrem Konto können Sie Routen berechnen, speichern und navigieren.' ?></p>
            <div class="login-screen-fields">
                <input type="<?= $nrWordPressAuth ? 'text' : 'email' ?>" id="login-screen-email" class="input" placeholder="<?= $nrWordPressAuth ? 'Benutzername oder E-Mail' : 'E-Mail' ?>" maxlength="<?= $nrWordPressAuth ? '120' : '190' ?>" autocomplete="username" autofocus>
                <input type="password" id="login-screen-password" class="input" placeholder="Passwort"<?= $nrWordPressAuth ? '' : ' minlength="8"' ?> autocomplete="current-password">
            </div>
            <button type="button" id="login-screen-submit" class="btn btn-primary btn-wide">Anmelden</button>
            <p id="login-screen-message" class="hint hint-small" hidden></p>
            <?php if (!$nrWordPressAuth): ?>
            <button type="button" id="login-screen-skip" class="btn btn-ghost login-screen-skip">Ohne Konto fortfahren</button>
            <?php endif; ?>
        </div>
    </div>
    <?php endif; ?>
    <div id="app" class="app">
        <header class="top-bar">
            <div class="top-bar-strip">
                <div class="top-bar-brand-slot">
                    <h1 class="brand">
                        <button type="button" id="btn-brand-reload" class="brand-reload" aria-label="Seite neu laden">
                            Biky <span class="brand-version">v2.2</span>
                        </button>
                    </h1>
                </div>
                <div
                    id="top-bar-user-meta"
                    class="top-bar-user-inline"
                    <?= $currentUser ? '' : ' hidden' ?>
                    style="<?= $currentUser ? '' : 'display:none' ?>"
                    aria-label="Profil kurzinfo"
                >
                    <span class="top-bar-user-inline-name">
                        <span id="top-bar-user-name"><?= htmlspecialchars($topBarDisplayName, ENT_QUOTES, 'UTF-8') ?></span>
                    </span>
                    <span class="top-bar-fitness-pill" title="Fitnesspunkte">
                        <span class="top-bar-fitness-pill-star" aria-hidden="true">★</span>
                        <span id="top-bar-fitness-points" class="top-bar-fitness-pill-num"><?= $currentUser ? (int) ($currentUser['fitness_points'] ?? 0) : 0 ?></span>
                    </span>
                </div>
            </div>
            <div class="top-bar-actions">
                <button type="button" id="btn-panel-feedback" class="btn btn-primary btn-mini">Feedback</button>
                <button type="button" id="btn-changelog" class="btn btn-ghost" aria-haspopup="dialog" aria-controls="changelog-dialog">Changelog</button>
                <a class="btn btn-ghost" href="info/" aria-label="Info-Seite zu Biky öffnen">Info</a>
                <button type="button" id="btn-top-routing-profile" class="btn btn-ghost top-bar-action-profile" aria-haspopup="dialog" aria-controls="profile-dialog">Routingprofil</button>
                <button type="button" id="btn-settings" class="btn btn-ghost" aria-haspopup="dialog" aria-controls="settings-dialog">Einstellungen</button>
                <button type="button" id="btn-konto" class="btn btn-ghost" aria-haspopup="dialog" aria-controls="konto-dialog">Konto</button>
            </div>
        </header>
        <div class="main">
            <div id="map-wrap" class="map-wrap">
                <div id="nr-map-viewport" class="nr-map-viewport">
                    <div id="map" class="map" role="application" aria-label="Karte"></div>
                    <div id="nr-piper-map-progress" class="nr-piper-map-progress" hidden aria-hidden="true" role="progressbar" aria-label="Sprachausgabe wird vorbereitet" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                        <div class="nr-piper-map-progress-track">
                            <div id="nr-piper-map-progress-fill" class="nr-piper-map-progress-fill"></div>
                        </div>
                    </div>
                </div>
                <div id="nav-maneuver-overlay" class="nav-maneuver-overlay" hidden aria-hidden="true">
                    <div id="nav-maneuver-overlay-icon" class="nav-arrow" aria-hidden="true"></div>
                </div>
                <div id="map-nav-start-wrap" class="map-nav-start-wrap" hidden aria-hidden="true">
                    <button type="button" id="btn-nav-start-map" class="btn nav-entry-btn nav-entry-btn--map" disabled>
                        Navigation starten
                    </button>
                </div>
                <div id="nr-waypoint-delete-popover" class="nr-waypoint-delete-popover" hidden aria-hidden="true" role="dialog" aria-label="Wegpunkt löschen">
                    <div class="nr-waypoint-delete-popover-title"></div>
                    <div class="nr-waypoint-delete-popover-actions">
                        <button type="button" id="nr-waypoint-delete-popover-cancel" class="btn btn-secondary">Abbrechen</button>
                        <button type="button" id="nr-waypoint-delete-popover-confirm" class="btn btn-danger">Löschen</button>
                    </div>
                </div>
                <div id="fitness-star-overlay" class="fitness-star-overlay fitness-star-overlay--map" hidden aria-hidden="true">
                    <div class="fitness-star-burst" aria-hidden="true">
                        <div class="fitness-star-sparks" aria-hidden="true">
                            <span class="fitness-star-spark"></span>
                            <span class="fitness-star-spark"></span>
                            <span class="fitness-star-spark"></span>
                            <span class="fitness-star-spark"></span>
                            <span class="fitness-star-spark"></span>
                            <span class="fitness-star-spark"></span>
                            <span class="fitness-star-spark"></span>
                            <span class="fitness-star-spark"></span>
                        </div>
                        <span class="fitness-star-ring"></span>
                        <span class="fitness-star-icon" aria-hidden="true">★</span>
                    </div>
                    <p class="fitness-star-caption"></p>
                </div>
                <div class="map-toolbar">
                    <button type="button" id="btn-map-surface" class="btn btn-fab" title="Wegarten anzeigen" aria-pressed="false" aria-label="Wegarten der aktuellen Route anzeigen" hidden>W</button>
                    <button type="button" id="btn-map-noexit" class="btn btn-fab" title="Mit grüner Route: Abzweig-Schleifen im Rundkurs markieren; sonst OSM noexit in der Karte" aria-pressed="false" aria-label="Abzweig-Schleifen entlang der grünen Route oder OSM noexit in der Kartenansicht" hidden>S</button>
                    <button type="button" id="btn-map-noexit-clear" class="btn btn-fab" title="Markierte Sackgassen aus der Route entfernen oder Markierung schließen" aria-label="Markierte Sackgassen aus der Route entfernen oder Markierung schließen" hidden>×</button>
                    <button type="button" id="btn-locate" class="btn btn-fab" title="Position anzeigen" aria-label="GPS-Position">◎</button>
                </div>
                <div id="surface-legend" class="surface-legend" hidden aria-hidden="true"></div>
            </div>
            <aside id="side-panel" class="side-panel" aria-label="Routing und Statistik">
                <div class="panel-stack">
                    <p id="point-status" class="sr-only" aria-live="polite"></p>
                    <section class="panel-section panel-card">
                        <div class="section-head">
                            <div>
                                <p class="section-kicker">Cloud</p>
                                <h2>Touren</h2>
                            </div>
                        </div>
                        <button type="button" id="btn-saved-routes-manage" class="btn btn-primary btn-wide" disabled>Touren verwalten</button>
                    </section>
                    <section class="panel-section panel-card panel-card-accent">
                        <div class="section-head">
                            <div>
                                <h2>Routingprofil</h2>
                            </div>
                        </div>
                        <button type="button" id="btn-panel-routing-profile" class="profile-current-row profile-current-row--solo profile-current-row-btn" aria-label="Routingprofil wählen" aria-haspopup="dialog" aria-controls="profile-dialog">
                            <div class="profile-current">
                                <span class="profile-current-kicker">Gewähltes Routingprofil</span>
                                <strong id="profile-current-value" class="profile-current-value">–</strong>
                            </div>
                        </button>
                    </section>
                    <div id="profile-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
                        <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title" aria-describedby="profile-dialog-copy">
                            <button type="button" id="profile-dialog-close" class="auth-dialog-close" aria-label="Schließen">×</button>
                            <h2 id="profile-dialog-title" class="auth-dialog-title">Routingprofil wählen</h2>
                            <p id="profile-dialog-copy" class="auth-dialog-copy">Das Profil beeinflusst, welche Wege bevorzugt werden. Die Auswahl wird auf diesem Gerät gespeichert.</p>
                            <div class="profile-dialog-grid" role="list" aria-label="Routingprofile">
                                <button type="button" class="btn profile-dialog-btn" data-profile="natur">Naturroute</button>
                                <button type="button" class="btn profile-dialog-btn" data-profile="gravel">Schotterroute</button>
                                <button type="button" class="btn profile-dialog-btn" data-profile="offroad">Feld-/Waldwege</button>
                                <button type="button" class="btn profile-dialog-btn" data-profile="kurvig">Kurvenreich</button>
                                <button type="button" class="btn profile-dialog-btn" data-profile="ruhig">Ruhige Route</button>
                                <button type="button" class="btn profile-dialog-btn" data-profile="radwege">Nur Radwege</button>
                                <button type="button" class="btn profile-dialog-btn" data-profile="abenteuer">Abenteuerroute</button>
                            </div>
                        </div>
                    </div>
                    <details class="panel-section panel-card panel-accordion">
                        <summary class="panel-accordion-summary">
                            <div>
                                <p class="section-kicker">Punkte setzen</p>
                                <h2>Start und Ziel wählen</h2>
                            </div>
                        </summary>
                        <div class="panel-accordion-body">
                            <p class="hint">Start per GPS setzen, Adresse suchen oder direkt auf der Karte klicken. Zwischenpunkte fügen Sie mit <strong>Umschalt + Klick</strong> hinzu.</p>
                            <div class="location-stack">
                                <fieldset class="geo-fieldset">
                                    <legend class="geo-legend">Start</legend>
                                    <div class="geo-row">
                                        <label class="sr-only" for="start-place">Ort oder Stadt (Start)</label>
                                        <input type="text" id="start-place" class="input" autocomplete="address-level2" placeholder="Ort / Stadt" maxlength="120">
                                        <label class="sr-only" for="start-street">Straße (Start)</label>
                                        <input type="text" id="start-street" class="input" autocomplete="street-address" placeholder="Straße, Nr." maxlength="120">
                                    </div>
                                    <div class="geo-action-grid" role="group" aria-label="Start: Position und Adressbuch">
                                        <button type="button" id="btn-geocode-start" class="btn btn-secondary geo-action-btn">Start per GPS</button>
                                        <button type="button" id="btn-geocode-start-address" class="btn btn-secondary geo-action-btn">Adresse suchen</button>
                                        <button type="button" id="btn-addressbook-start" class="btn btn-secondary geo-action-btn" disabled>Aus Adressbuch</button>
                                        <button type="button" id="btn-addressbook-save-start" class="btn btn-secondary geo-action-btn" disabled>Ins Adressbuch</button>
                                    </div>
                                    <ul id="start-suggest" class="geo-suggest" role="listbox" aria-label="Vorschläge Start" hidden></ul>
                                </fieldset>
                                <fieldset class="geo-fieldset">
                                    <legend class="geo-legend">Ziel</legend>
                                    <div class="geo-row">
                                        <label class="sr-only" for="goal-place">Ort oder Stadt (Ziel)</label>
                                        <input type="text" id="goal-place" class="input" autocomplete="address-level2" placeholder="Ort / Stadt" maxlength="120">
                                        <label class="sr-only" for="goal-street">Straße (Ziel)</label>
                                        <input type="text" id="goal-street" class="input" autocomplete="street-address" placeholder="Straße, Nr." maxlength="120">
                                    </div>
                                    <div class="geo-action-grid" role="group" aria-label="Ziel: Position und Adressbuch">
                                        <button type="button" id="btn-goal-here" class="btn btn-secondary geo-action-btn">Ziel per GPS</button>
                                        <button type="button" id="btn-geocode-goal" class="btn btn-secondary geo-action-btn">Ziel suchen</button>
                                        <button type="button" id="btn-addressbook-goal" class="btn btn-secondary geo-action-btn" disabled>Aus Adressbuch</button>
                                        <button type="button" id="btn-addressbook-save-goal" class="btn btn-secondary geo-action-btn" disabled>Ins Adressbuch</button>
                                    </div>
                                    <div class="btn-row">
                                        <button type="button" id="btn-route" class="btn btn-primary btn-route-calc" disabled>Route berechnen</button>
                                    </div>
                                    <ul id="goal-suggest" class="geo-suggest" role="listbox" aria-label="Vorschläge Ziel" hidden></ul>
                                </fieldset>
                            </div>
                            <div class="btn-row btn-row-split">
                                <button type="button" id="btn-clear" class="btn btn-secondary">Eingaben zurücksetzen</button>
                            </div>
                        </div>
                    </details>
                    <section class="panel-section panel-card panel-card-highlight">
                        <div class="section-head">
                            <div>
                                <p class="section-kicker">Rundkurs</p>
                                <h2>Rundkurs erzeugen</h2>
                            </div>
                        </div>
                        <fieldset class="rt-mode-fieldset">
                            <legend class="rt-mode-legend">Rundkurs-Art</legend>
                            <div class="rt-mode-row" role="radiogroup" aria-label="Rundkurs-Art">
                                <label class="rt-mode-label">
                                    <input type="radio" name="rt_mode" id="rt-mode-circle" value="circle" checked>
                                    Kreis nach Länge
                                </label>
                                <label class="rt-mode-label rt-mode-label--stack">
                                    <input type="radio" name="rt_mode" id="rt-mode-waypoints" value="waypoints">
                                    <span class="rt-mode-label-stack">
                                        <span>Wegpunkte</span>
                                        <span class="rt-mode-label-sub">(max. 10)</span>
                                    </span>
                                </label>
                            </div>
                        </fieldset>
                        <p id="rt-hint-circle" class="hint hint-small">Für diesen Modus einen Startpunkt in der Karte setzen. Die gewünschte Länge ist eine Orientierung; die echte Route kann vom Wegenetz abweichen.</p>
                        <p id="rt-hint-waypoints" class="hint hint-small" hidden>Erster Klick setzt den Startpunkt (Beginn und Ende des Rundkurses), danach bis zu neun weitere Wegpunkte in Umlaufrichtung. Es werden mindestens Start plus zwei weitere Punkte benötigt. Die gewünschte Gesamtlänge wird in diesem Modus ignoriert.</p>
                        <div class="btn-row">
                            <button type="button" id="btn-rt-start-gps" class="btn btn-secondary btn-wide">Start ermitteln</button>
                        </div>
                        <div id="rt-circle-block" class="rt-control-card">
                            <div class="rt-radius-head">
                                <label class="rt-radius-title" for="rt-radius-km">Gewünschte Länge</label>
                                <output id="rt-radius-label" class="rt-radius-value" for="rt-radius-km">8 km</output>
                            </div>
                            <input type="range" id="rt-radius-km" name="rt_radius_km" min="1" max="120" step="1" value="8" aria-valuemin="1" aria-valuemax="120" aria-valuenow="8" aria-describedby="rt-radius-hint">
                            <p id="rt-radius-hint" class="hint hint-small">Große Rundkurse werden intern über Hilfspunkte geführt; dadurch bleiben sie möglichst nahe an der gewünschten Distanz.</p>
                        </div>
                        <div id="rt-waypoint-block" class="rt-waypoint-block" hidden>
                            <p id="rt-wp-counter" class="rt-wp-counter" aria-live="polite">Wegpunkte: 0 / 10</p>
                            <div class="btn-row btn-row-split">
                                <button type="button" id="btn-rt-wp-undo" class="btn btn-secondary" disabled>Letzten Wegpunkt entfernen</button>
                                <button type="button" id="btn-rt-wp-clearall" class="btn btn-danger" disabled>Alle Wegpunkte löschen</button>
                            </div>
                        </div>
                        <div id="rt-actions" class="rt-actions">
                            <div id="rt-variant-row" class="rt-variant-row">
                                <label class="detour-label" for="rt-variant-count">Varianten</label>
                                <select id="rt-variant-count" class="input rt-variant-select" aria-label="Anzahl Rundkurs-Varianten">
                                    <option value="1" selected>1</option>
                                    <option value="2">2</option>
                                    <option value="3">3</option>
                                    <option value="4">4</option>
                                    <option value="5">5</option>
                                </select>
                            </div>
                            <button type="button" id="btn-roundtrip" class="btn btn-primary btn-wide" disabled>Rundkurse berechnen</button>
                        </div>
                        <div id="rt-variants" class="rt-variants" role="region" aria-label="Rundkurs-Varianten" hidden></div>
                        <div class="btn-row btn-row-split">
                            <button type="button" id="btn-roundtrip-new-variant" class="btn btn-secondary btn-wide" hidden>Neue Variante berechnen</button>
                        </div>
                    </section>
                    <section class="panel-section panel-card panel-card-cta">
                        <div class="section-head">
                            <div>
                                <p class="section-kicker">Punkt-zu-Punkt</p>
                                <h2>Route berechnen</h2>
                            </div>
                        </div>
                        <button type="button" id="btn-nav-start" class="btn nav-entry-btn" disabled>Navigation starten</button>
                        <p class="hint hint-small">Live-Hinweise und GPS-Simulation stehen nach der Berechnung direkt bereit.</p>
                        <p id="route-error" class="error" role="alert" hidden></p>
                        <p id="route-info" class="route-info" role="status" hidden></p>
                    </section>
                    <section class="panel-section panel-card" id="stats-section" hidden>
                        <div class="section-head">
                            <div>
                                <p class="section-kicker">Ergebnis</p>
                                <h2>Statistik</h2>
                            </div>
                        </div>
                        <dl class="stats">
                            <div><dt>Distanz</dt><dd id="stat-dist">–</dd></div>
                            <div><dt>Fahrzeit</dt><dd id="stat-time">–</dd></div>
                            <div><dt>Naturweg</dt><dd id="stat-nat">–</dd></div>
                            <div><dt>Straße / Asphalt</dt><dd id="stat-asph">–</dd></div>
                        </dl>
                    </section>
                </div>
            </aside>
        </div>
        <div id="nav-sheet" class="nav-sheet" hidden aria-hidden="true">
            <div class="nav-sheet-inner" tabindex="-1">
                <button
                    type="button"
                    class="nav-sheet-drag-handle"
                    id="nav-sheet-drag-handle"
                    aria-label="Navigationspanel verschieben. Doppelklick: unten andocken."
                    title="Ziehen zum Verschieben. Doppelklick: unten andocken."
                ></button>
                <div class="nav-sheet-top">
                    <div class="nav-sheet-lead-actions">
                        <button type="button" id="nav-close" class="nav-btn-exit nav-btn-text" aria-label="Navigation beenden" title="Navigation beenden">Beenden</button>
                        <button type="button" id="nav-settings-toggle" class="nav-btn-settings nav-btn-text" aria-label="Navigationseinstellungen öffnen" title="Navigationseinstellungen" aria-controls="nav-settings-panel" aria-expanded="false">Einstellungen</button>
                        <button
                            type="button"
                            id="nav-return-start"
                            class="nav-btn-return nav-btn-return-top"
                            aria-label="Zurück zum Startpunkt navigieren"
                            title="Neue Route vom aktuellen Standort zum Startpunkt berechnen"
                        >Zurück zum Startpunkt</button>
                    </div>
                </div>
                <div class="nav-turn-block" aria-live="polite" aria-atomic="true">
                    <div class="nav-instruction-badge">
                        <span class="nav-stat-label">Weisung</span>
                        <p id="nav-text" class="nav-instruction-text">–</p>
                        <p id="nav-street" class="nav-street-line nav-street-line--in-badge" hidden></p>
                    </div>
                    <div class="nav-turn-main">
                        <div class="nav-arrow-tile">
                            <div id="nav-arrow" class="nav-arrow" aria-hidden="true">↑</div>
                        </div>
                        <span class="nav-next-tile"><span class="nav-stat-label">Nächster Punkt</span><strong id="nav-next-dist">–</strong></span>
                    </div>
                    <div class="nav-stat-tiles" aria-label="Navigationsstatistik">
                        <span class="nav-stat-tile"><span class="nav-stat-label">Gefahren</span><strong id="nav-stat-distance">0,0 km</strong></span>
                        <span class="nav-stat-tile"><span class="nav-stat-label">Zeit</span><strong id="nav-stat-time">00:00</strong></span>
                    </div>
                </div>
            </div>
            <div id="nav-settings-panel" class="nav-settings-panel" hidden aria-hidden="true">
                <div class="nav-settings-card" role="dialog" aria-modal="false" aria-labelledby="nav-settings-title">
                    <div class="nav-settings-head">
                        <strong id="nav-settings-title">Navigation</strong>
                        <button type="button" id="nav-settings-close" class="nav-settings-close" aria-label="Navigationseinstellungen schließen">×</button>
                    </div>
                    <div class="nav-sim-row">
                    <label class="nav-sim-check touch-target">
                        <input type="checkbox" id="nav-sim-on">
                        <span class="nav-toggle-ui" aria-hidden="true"></span>
                        <span>GPS-Sim</span>
                    </label>
                    <div id="nav-sim-controls" class="nav-sim-controls" hidden>
                        <label class="nav-sim-speed touch-target">
                            Tempo
                            <select id="nav-sim-kmh" class="nav-select">
                                <option value="12">12 km/h</option>
                                <option value="18" selected>18 km/h</option>
                                <option value="25">25 km/h</option>
                                <option value="50">50 km/h</option>
                                <option value="100">100 km/h</option>
                            </select>
                        </label>
                        <div id="nav-sim-jump" class="nav-sim-jump">
                            <button type="button" id="nav-sim-prev" class="nav-sim-jump-btn" aria-label="Vorheriges Manöver" title="Vorheriges Manöver">←</button>
                            <button type="button" id="nav-sim-next" class="nav-sim-jump-btn" aria-label="Nächstes Manöver" title="Nächstes Manöver">→</button>
                        </div>
                    </div>
                    <label class="nav-sim-check touch-target" title="Standard: Piper-Stimme (lokal). Wenn Wiedergabe fehlschlägt: Systemsprache (Safari). Navigation kurz antippen verbessert die erste Ansage auf dem iPhone.">
                        <input type="checkbox" id="nav-voice-on" checked>
                        <span class="nav-toggle-ui" aria-hidden="true"></span>
                        <span>Sprache</span>
                    </label>
                    <label class="nav-sim-check touch-target" title="Die Karte dreht mit der Fahrtrichtung (oben = voraus). Erleichtert das Einordnen von links und rechts.">
                        <input type="checkbox" id="nav-map-heading-on">
                        <span class="nav-toggle-ui" aria-hidden="true"></span>
                        <span>Karte Fahrtrichtung</span>
                    </label>
                    <button
                        type="button"
                        id="nav-volume-toggle"
                        class="nav-volume-toggle touch-target"
                        aria-controls="nav-volume-popover"
                        aria-expanded="false"
                        title="Lautstärke einstellen"
                    >Lautstärke</button>
                    <div id="nav-volume-popover" class="nav-volume-popover" hidden>
                        <div class="nav-volume-head">
                            <span class="nav-volume-title">Lautstärke</span>
                            <output id="nav-voice-volume-label" class="nav-volume-out" for="nav-voice-volume">100 %</output>
                        </div>
                        <input
                            type="range"
                            id="nav-voice-volume"
                            class="nav-volume-slider"
                            min="0"
                            max="100"
                            step="1"
                            value="100"
                            aria-label="Lautstärke der Sprachausgabe"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-valuenow="100"
                        >
                    </div>
                </div>
            </div>
        </div>
        </div>
        <div id="route-busy-overlay" class="route-busy-overlay" hidden aria-hidden="true">
            <div class="route-busy-card" role="dialog" aria-modal="true" aria-labelledby="route-busy-title">
                <div id="route-busy-visual" class="route-busy-visual" data-stage="route" aria-hidden="true">
                    <div class="route-orbit">
                        <svg class="route-orbit-map" viewBox="0 0 220 116" role="img">
                            <path class="route-orbit-grid" d="M18 30H202M18 58H202M18 86H202M52 14V102M100 14V102M148 14V102" />
                            <path class="route-orbit-line route-orbit-line-back" d="M24 82C54 24 92 104 119 55C145 9 168 28 198 36" />
                            <path class="route-orbit-line route-orbit-line-front" d="M24 82C54 24 92 104 119 55C145 9 168 28 198 36" />
                        </svg>
                        <span class="route-icon route-icon-start">●</span>
                        <span class="route-icon route-icon-bike">🚲</span>
                        <span class="route-icon route-icon-finish">⚑</span>
                    </div>
                    <div class="route-busy-steps">
                        <span class="route-busy-step" data-step="send"><span>⌁</span> Punkte</span>
                        <span class="route-busy-step" data-step="server"><span>◆</span> Routing</span>
                        <span class="route-busy-step" data-step="clean"><span>⚠</span> Prüfung</span>
                        <span class="route-busy-step" data-step="map"><span>⌖</span> Karte</span>
                    </div>
                </div>
                <h2 id="route-busy-title" class="route-busy-title">Route wird berechnet</h2>
                <p id="route-busy-detail" class="route-busy-detail"></p>
                <div id="route-progress-track" class="route-progress-track" aria-hidden="true">
                    <div id="route-progress-bar" class="route-progress-bar"></div>
                </div>
                <div id="route-busy-actions" class="route-busy-actions" hidden>
                    <button type="button" id="route-busy-close" class="btn btn-secondary">Schließen</button>
                    <button type="button" id="route-busy-nav-start" class="btn btn-primary" disabled>Navigation starten</button>
                </div>
            </div>
        </div>
        <div id="weather-start-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card weather-start-card" role="dialog" aria-modal="true" aria-labelledby="weather-start-title" aria-describedby="weather-start-copy">
                <div class="weather-start-head">
                    <div id="weather-start-anim" class="weather-start-anim" data-weather="unknown" aria-hidden="true">
                        <canvas id="weather-skycon" class="weather-skycon" width="128" height="128"></canvas>
                    </div>
                    <div class="weather-start-head-text">
                        <h2 id="weather-start-title" class="auth-dialog-title weather-start-title">Wetter am Start</h2>
                        <p id="weather-start-copy" class="auth-dialog-copy weather-start-copy">Einen Moment – der Wetterbericht wird geladen.</p>
                        <p id="weather-start-sub" class="weather-start-sub" hidden></p>
                    </div>
                </div>

                <div class="weather-start-body">
                    <div class="piper-tts-ride" aria-hidden="true"></div>
                </div>

                <div class="btn-row weather-start-actions">
                    <button type="button" id="weather-start-go" class="btn btn-primary" disabled>Los geht’s</button>
                    <button type="button" id="weather-start-cancel" class="btn btn-secondary">Abbrechen</button>
                </div>
            </div>
        </div>
        <div id="settings-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card settings-card" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-describedby="settings-copy">
                <h2 id="settings-title" class="auth-dialog-title">Einstellungen</h2>
                <p id="settings-copy" class="auth-dialog-copy">Sprachausgabe, TTS‑Engine und Anzeigeverhalten.</p>

                <div class="settings-section">
                    <p class="input-label">Sprachausgabe</p>
                    <label class="nav-sim-check touch-target" for="settings-voice-enabled">
                        <input type="checkbox" id="settings-voice-enabled" checked>
                        <span class="nav-toggle-ui" aria-hidden="true"></span>
                        <span>Sprachausgabe aktiv</span>
                    </label>
                    <label class="nav-sim-check touch-target" for="settings-fitness-voice-enabled">
                        <input type="checkbox" id="settings-fitness-voice-enabled" checked>
                        <span class="nav-toggle-ui" aria-hidden="true"></span>
                        <span>Fitness‑Sterne ansagen</span>
                    </label>
                    <p class="input-label settings-subhead">TTS‑Engine</p>
                    <div class="nr-segment-toggle" role="group" aria-label="TTS Engine auswählen">
                        <button type="button" id="tts-engine-global-piper" class="nr-segment-toggle-btn" aria-pressed="true">Piper</button>
                        <button type="button" id="tts-engine-global-system" class="nr-segment-toggle-btn" aria-pressed="false">System</button>
                    </div>
                </div>

                <div class="settings-section">
                    <p class="input-label">Bildschirm</p>
                    <label class="nav-sim-check touch-target" for="wake-lock-toggle">
                        <input type="checkbox" id="wake-lock-toggle">
                        <span class="nav-toggle-ui" aria-hidden="true"></span>
                        <span>Bildschirm wach halten</span>
                    </label>
                    <p class="hint hint-small">Verhindert das automatische Abdunkeln während der Nutzung (wenn vom Browser unterstützt).</p>
                </div>

                <div class="btn-row">
                    <button type="button" id="settings-close" class="btn btn-secondary">Schließen</button>
                </div>
            </div>
        </div>
        <div id="addressbook-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card addressbook-card" role="dialog" aria-modal="true" aria-labelledby="addressbook-title" aria-describedby="addressbook-copy">
                <h2 id="addressbook-title" class="auth-dialog-title">Adressbuch</h2>
                <p id="addressbook-copy" class="auth-dialog-copy">Gespeicherte Start- und Zielpunkte (automatisch bei Navigation-Start).</p>
                <div id="addressbook-list" class="addressbook-list" role="region" aria-label="Adressbuch Einträge"></div>
                <p id="addressbook-empty" class="hint hint-small" hidden>Noch keine Einträge. Starte einmal eine Navigation, dann wird Start/Ziel automatisch gespeichert.</p>
                <div class="btn-row">
                    <button type="button" id="addressbook-close" class="btn btn-secondary">Schließen</button>
                </div>
            </div>
        </div>
        <div id="addressbook-delete-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="addressbook-delete-title" aria-describedby="addressbook-delete-text">
                <h2 id="addressbook-delete-title" class="auth-dialog-title">Adressbuch-Eintrag löschen?</h2>
                <p id="addressbook-delete-text" class="auth-dialog-copy"></p>
                <div class="btn-row">
                    <button type="button" id="addressbook-delete-cancel" class="btn btn-secondary">Abbrechen</button>
                    <button type="button" id="addressbook-delete-confirm" class="btn btn-danger">Löschen</button>
                </div>
            </div>
        </div>
        <div id="addressbook-rename-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="addressbook-rename-title" aria-describedby="addressbook-rename-copy">
                <h2 id="addressbook-rename-title" class="auth-dialog-title">Adressbuch-Eintrag umbenennen</h2>
                <p id="addressbook-rename-copy" class="auth-dialog-copy">Gib einen Namen ein (z.B. „Zuhause → Arbeit“).</p>
                <label class="input-label" for="addressbook-rename-input">Name</label>
                <input type="text" id="addressbook-rename-input" class="input" maxlength="180" autocomplete="off">
                <div class="btn-row">
                    <button type="button" id="addressbook-rename-cancel" class="btn btn-secondary">Abbrechen</button>
                    <button type="button" id="addressbook-rename-confirm" class="btn btn-primary">Speichern</button>
                </div>
            </div>
        </div>
        <div id="saved-routes-manage-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="saved-routes-manage-title">
                <button type="button" id="saved-routes-manage-close" class="auth-dialog-close" aria-label="Schließen">×</button>
                <h2 id="saved-routes-manage-title" class="auth-dialog-title">Touren verwalten</h2>
                <p class="auth-dialog-copy">Touren aus der Cloud laden, umbenennen oder löschen.</p>
                <div class="auth-grid">
                    <input type="text" id="saved-route-title" class="input" placeholder="Name der aktuellen Route" maxlength="180" autocomplete="off">
                </div>
                <div class="btn-row">
                    <button type="button" id="btn-route-save" class="btn btn-primary" disabled>Aktuelle Route speichern</button>
                    <button type="button" id="btn-route-refresh" class="btn btn-secondary" disabled>Liste laden</button>
                </div>
                <ul id="saved-routes-list" class="saved-routes-list" role="region" aria-label="Gespeicherte Touren"></ul>
                <p id="saved-routes-message" class="hint hint-small" hidden></p>
            </div>
        </div>
        <div id="saved-route-delete-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="saved-route-delete-title" aria-describedby="saved-route-delete-text">
                <h2 id="saved-route-delete-title" class="auth-dialog-title">Gespeicherte Route löschen?</h2>
                <p id="saved-route-delete-text" class="auth-dialog-copy"></p>
                <div class="btn-row">
                    <button type="button" id="saved-route-delete-cancel" class="btn btn-secondary">Abbrechen</button>
                    <button type="button" id="saved-route-delete-confirm" class="btn btn-primary">Endgültig löschen</button>
                </div>
            </div>
        </div>
        <div id="saved-route-rename-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="saved-route-rename-title" aria-describedby="saved-route-rename-text">
                <h2 id="saved-route-rename-title" class="auth-dialog-title">Route umbenennen</h2>
                <p id="saved-route-rename-text" class="auth-dialog-copy">Neuen Namen für die gespeicherte Route eingeben:</p>
                <div class="auth-grid">
                    <input type="text" id="saved-route-rename-input" class="input" placeholder="Neuer Routenname" maxlength="180" autocomplete="off">
                </div>
                <div class="btn-row">
                    <button type="button" id="saved-route-rename-cancel" class="btn btn-secondary">Abbrechen</button>
                    <button type="button" id="saved-route-rename-confirm" class="btn btn-primary">Speichern</button>
                </div>
            </div>
        </div>
        <div id="nr-message-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="nr-message-title" aria-describedby="nr-message-text">
                <h2 id="nr-message-title" class="auth-dialog-title">Hinweis</h2>
                <p id="nr-message-text" class="auth-dialog-copy"></p>
                <div class="btn-row">
                    <button type="button" id="nr-message-ok" class="btn btn-primary">OK</button>
                </div>
            </div>
        </div>
        <div id="nr-ors-key-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="nr-ors-key-title" aria-describedby="nr-ors-key-copy">
                <h2 id="nr-ors-key-title" class="auth-dialog-title">OpenRouteService API-Key fehlt</h2>
                <div id="nr-ors-key-copy" class="auth-dialog-copy">
                    <p>Für Routenberechnung, Rundkurse (inkl. Wegpunkte-Modus) und die Turn-by-Turn-Navigation braucht Biky einen Zugang zur <strong>OpenRouteService</strong>-Schnittstelle. Dafür ist ein <strong>kostenloser API-Key</strong> nötig.</p>
                    <p><strong>So bekommst du den Key:</strong> Auf der OpenRouteService-Website ein Konto anlegen, im Dashboard einen API-Key erzeugen und kopieren.</p>
                    <p><a href="https://openrouteservice.org/dev/#/signup" class="btn btn-ghost btn-mini" target="_blank" rel="noopener noreferrer">Zur ORS-Registrierung</a> · <a href="https://openrouteservice.org/sign-up" class="btn btn-ghost btn-mini" target="_blank" rel="noopener noreferrer">ORS Sign-up &amp; Dashboard</a></p>
                    <p><strong>Key eintragen:</strong> Nach dem Anmelden im Bereich <strong>Konto</strong> (Kopfzeile) das Feld <strong>OpenRouteService API-Key</strong> ausfüllen und speichern. Ohne Anmeldung sind Routing und Navigation nicht verfügbar.</p>
                    <?php if ($nrOrsServerKeyConfigured): ?>
                        <p class="hint hint-small">Auf diesem Server ist zusätzlich ein Standard-Key hinterlegt – sobald du angemeldet bist, kann die App ihn nutzen, bis du einen eigenen Key einträgst.</p>
                    <?php else: ?>
                        <p class="hint hint-small">Wenn dein Verein oder Admin einen Standard-Key auf dem Server einträgt, reicht nach dem Login ggf. kein eigener Key – bis dahin brauchst du einen persönlichen Key wie oben beschrieben.</p>
                    <?php endif; ?>
                </div>
                <div class="btn-row">
                    <button type="button" id="nr-ors-key-open-konto" class="btn btn-primary">Zum Konto</button>
                    <button type="button" id="nr-ors-key-close" class="btn btn-secondary">Schließen</button>
                </div>
            </div>
        </div>
        <div id="nr-waypoints-clear-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="nr-waypoints-clear-title" aria-describedby="nr-waypoints-clear-text">
                <h2 id="nr-waypoints-clear-title" class="auth-dialog-title">Alle Wegpunkte löschen?</h2>
                <p id="nr-waypoints-clear-text" class="auth-dialog-copy"></p>
                <div class="btn-row">
                    <button type="button" id="nr-waypoints-clear-cancel" class="btn btn-secondary">Abbrechen</button>
                    <button type="button" id="nr-waypoints-clear-confirm" class="btn btn-danger">Alles löschen</button>
                </div>
            </div>
        </div>
        <div id="changelog-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card changelog-card" role="dialog" aria-modal="true" aria-labelledby="changelog-title" aria-describedby="changelog-body">
                <h2 id="changelog-title" class="auth-dialog-title">Was ist neu?</h2>
                <div id="changelog-body" class="changelog-body" role="region" aria-label="Letzte Aenderungen" tabindex="0">
                    <div class="changelog-day">
                        <div class="changelog-day-date"><strong>7. Mai 2026</strong> · Version 2.2</div>
                        <ul class="changelog-list">
                            <li>Rundkurs-Navigation: Wenn du von der Strecke abkommst, führt dich Biky jetzt zuverlässig zur <strong>nächsten Abbiegung in Fahrtrichtung</strong> zurück – nie zu einem Punkt, den du auf dem Rundkurs schon hinter dir hast.</li>
                            <li>Die App merkt sich, an welcher Abbiegung du zuletzt vorbeigekommen bist. Dadurch wird das Wieder-Aufnehmen der Tour bei großen Umwegen oder schlechtem GPS-Empfang deutlich stabiler.</li>
                            <li>Die Rückführungs-Route landet jetzt sanft tangential auf der geplanten Strecke, statt an einem Punkt anzudocken, der von der Seite oder gar rückwärts angesteuert würde.</li>
                            <li>Lange gerade Streckenabschnitte ohne Abbiegung werden korrekt erkannt: hier wählt Biky den geometrisch passendsten Wiedereinstieg, ebenfalls strikt vorwärts in Streckenrichtung.</li>
                            <li>Tour-Kilometer: Nach einer Rückführung zur Strecke <strong>oder einem „Zurück zum Startpunkt“</strong> springt der Kilometerzähler nicht mehr auf 0 – er läuft über die ganze Tour weiter. Auch Fahrtzeit und Fitnesspunkte werden weiter mitgezählt. Erst beim Klick auf „Beenden“ wird nichts mehr addiert.</li>
                        </ul>
                    </div>
                    <div class="changelog-day">
                        <div class="changelog-day-date"><strong>7. Mai 2026</strong> · Version 2.1</div>
                        <ul class="changelog-list">
                            <li>Beim Starten der App erscheint sofort der Anmelde-Bildschirm – kein extra Klick mehr nötig.</li>
                            <li>Konto und Einstellungen sind jetzt bequem über die Buttons in der Kopfzeile erreichbar.</li>
                            <li>Auf dem Handy werden dein Name und deine Fitnesspunkte oben im Kopfbereich zuverlässig angezeigt.</li>
                            <li>Routingprofil: Auch im rechten Panel antippbar – die Auswahl öffnet sich direkt.</li>
                            <li>Gespeicherte Touren merken sich das Routingprofil und laden es beim Öffnen wieder mit.</li>
                            <li>Touren speichern: Die App schlägt jetzt automatisch einen Namen vor (Ort · Länge · Routingprofil).</li>
                            <li>Tourenverwaltung: Datum/Uhrzeit werden immer im deutschen Format angezeigt.</li>
                            <li>Adressbuch: Es wird nichts mehr automatisch gespeichert – nur noch über die Buttons.</li>
                            <li>Wetter: „dry“ wird korrekt als „trocken“ angezeigt/angesagt.</li>
                            <li>Adressbuch: Start und Ziel lassen sich jetzt auch einzeln speichern und laden.</li>
                            <li>Wenn der Routing-Schlüssel fehlt, erscheint eine verständliche Erklärung (auf kleinen Handy-Screens scrollbar).</li>
                            <li>Die Karten-Buttons (Wegarten, Sackgassen) erscheinen nur noch, wenn eine berechnete Route auf der Karte liegt.</li>
                            <li>Rundkurs: Im Wegpunkte-Modus gibt es keinen „Neue Variante“-Button mehr – der gilt nur für den Kreis-Modus.</li>
                            <li>Konto: Im Konto-Fenster gibt es jetzt zusätzlich einen klaren „Schließen“-Button.</li>
                        </ul>
                    </div>
                    <div class="changelog-day">
                        <div class="changelog-day-date"><strong>6. Mai 2026</strong> · Version 2.0</div>
                        <ul class="changelog-list">
                            <li>Der Bildschirm bleibt während der Navigation wach (Schalter in den Einstellungen).</li>
                            <li>Wegpunkte können direkt auf der Karte gelöscht werden (kleines Menü am Punkt).</li>
                            <li>Neue Routen-Profile: „Kurvenreich“ (für mehr Abzweige) und „Feld-/Waldwege“ (Offroad).</li>
                            <li>Rundkurs: Du kannst jederzeit eine neue Variante berechnen lassen, ohne von vorn zu beginnen.</li>
                            <li>Sprachausgabe: Auswahl zwischen Piper (offline) und Systemstimme direkt im Menü.</li>
                            <li>Wetter am Start: Vor dem Losfahren siehst du die aktuelle Wetterlage am Startpunkt.</li>
                            <li>Adresssuche: Bessere Hinweise, wenn die Eingabe zu kurz ist.</li>
                            <li>Wegpunkte-Rundkurs: Die Route folgt jetzt zuverlässiger deinen gesetzten Punkten.</li>
                        </ul>
                    </div>
                    <p class="hint hint-small changelog-note">Hier werden alle Neuerungen mit Datum festgehalten.</p>
                </div>
                <div class="btn-row">
                    <button type="button" id="changelog-close" class="btn btn-secondary">Schließen</button>
                </div>
            </div>
        </div>
        <div id="nav-feedback-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="nav-feedback-title" aria-describedby="nav-feedback-copy">
                <h2 id="nav-feedback-title" class="auth-dialog-title">Feedback zur Navigation</h2>
                <p id="nav-feedback-copy" class="auth-dialog-copy">Wie war die Navigation? Ihr Feedback hilft uns, die Routen und Hinweise zu verbessern.</p>
                <div class="auth-grid">
                    <input type="text" id="nav-feedback-name" class="input" placeholder="Name" maxlength="120" autocomplete="name">
                    <input type="email" id="nav-feedback-email" class="input" placeholder="E-Mail-Adresse" maxlength="190" autocomplete="email">
                    <textarea id="nav-feedback-message" class="input nav-feedback-textarea" placeholder="Feedback zur Route oder Navigation" maxlength="3000" rows="5"></textarea>
                </div>
                <p id="nav-feedback-status" class="hint hint-small" hidden></p>
                <div class="btn-row">
                    <button type="button" id="nav-feedback-skip" class="btn btn-secondary">Überspringen</button>
                    <button type="button" id="nav-feedback-submit" class="btn btn-primary">Feedback senden</button>
                </div>
            </div>
        </div>
        <div id="konto-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card konto-dialog-card" role="dialog" aria-modal="true" aria-labelledby="konto-dialog-title">
                <button type="button" id="konto-dialog-close" class="auth-dialog-close" aria-label="Schließen">×</button>
                <h2 id="konto-dialog-title" class="auth-dialog-title">Konto</h2>
                <div class="konto-dialog-body">
                    <div id="panel-user-summary" class="panel-user-summary konto-panel-user-summary"<?= $currentUser ? '' : ' hidden' ?>>
                        <div class="panel-user-identity">
                            <span class="panel-user-kicker">Profil</span>
                            <span id="panel-user-name" class="panel-user-name"><?= $currentUser ? htmlspecialchars((string) $currentUser['display_name'], ENT_QUOTES, 'UTF-8') : '' ?></span>
                        </div>
                        <div class="panel-fitness-badge" title="Fitnesspunkte durch gefahrene Kilometer in der Navigation">
                            <span class="panel-fitness-icon" aria-hidden="true">★</span>
                            <div class="panel-fitness-badge-text">
                                <span id="panel-fitness-points" class="panel-fitness-value"><?= $currentUser ? (int) ($currentUser['fitness_points'] ?? 0) : 0 ?></span>
                                <span class="panel-fitness-label">Fitnesspunkte</span>
                            </div>
                        </div>
                    </div>
                    <p id="auth-guest" class="hint"<?= $currentUser ? ' hidden' : '' ?>>Ohne Anmeldung ist die Karte sichtbar; Routing und Adresssuche sind nach dem Login freigeschaltet.</p>
                    <div id="auth-user" class="auth-user-box"<?= $currentUser ? '' : ' hidden' ?>>
                        <p id="auth-user-label" class="auth-user-label">
                            <?php if ($currentUser): ?>
                                Angemeldet als <strong><?= htmlspecialchars($currentUser['display_name'], ENT_QUOTES, 'UTF-8') ?></strong> · <?= htmlspecialchars($currentUser['email'], ENT_QUOTES, 'UTF-8') ?>
                            <?php endif; ?>
                        </p>
                        <div class="btn-row">
                            <button type="button" id="btn-auth-logout" class="btn btn-secondary">Abmelden</button>
                        </div>
                    </div>
                    <div class="ors-key-box">
                        <label for="ors-api-key" class="input-label">OpenRouteService API-Key</label>
                        <input
                            type="password"
                            id="ors-api-key"
                            class="input"
                            placeholder="Eigenen ORS-API-Key eintragen"
                            value="<?= htmlspecialchars($orsApiKeyInit, ENT_QUOTES, 'UTF-8') ?>"
                            maxlength="512"
                            autocomplete="off"
                            autocapitalize="off"
                            autocorrect="off"
                            spellcheck="false"
                        >
                        <div class="btn-row btn-row-split">
                            <button type="button" id="btn-ors-api-key-save" class="btn btn-secondary">API-Key speichern</button>
                        </div>
                        <p class="hint hint-small">
                            Offiziellen ORS-Zugang anlegen und den Schlüssel im Dashboard kopieren:
                            <a href="https://openrouteservice.org/sign-up" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-mini">ORS Sign-up &amp; Dashboard</a>
                        </p>
                        <p class="hint hint-small">Wenn das Feld leer bleibt, wird der serverseitig konfigurierte Standard-Key verwendet.</p>
                    </div>
                    <?php if ($showNavDebugLog): ?>
                        <label class="checkbox-row">
                            <input type="checkbox" id="nav-debug-log-enabled"<?= $navDebugLogEnabledInit ? ' checked' : '' ?>>
                            Debug-Logdatei schreiben
                        </label>
                    <?php endif; ?>
                    <p id="auth-panel-message" class="hint hint-small" hidden></p>
                    <div id="auth-dialog" class="konto-auth-panel" role="region"<?= $currentUser ? ' hidden' : '' ?> aria-labelledby="auth-dialog-title" aria-hidden="<?= $currentUser ? 'true' : 'false' ?>">
                        <h3 id="auth-dialog-title" class="auth-dialog-title konto-auth-title">Anmelden</h3>
                        <p id="auth-dialog-copy" class="auth-dialog-copy"><?= $nrWordPressAuth
                            ? 'Melden Sie sich mit dem gleichen Benutzernamen bzw. der E-Mail und dem Passwort wie auf der Club-Website (WordPress) an.'
                            : 'Mit Ihrem Konto können Sie Routen berechnen, speichern und exportieren.' ?></p>
                        <div class="auth-grid">
                            <div id="auth-display-name-wrap" class="auth-display-name-wrap" hidden>
                                <input type="text" id="auth-display-name" class="input" placeholder="Anzeigename" maxlength="120" autocomplete="nickname">
                            </div>
                            <input type="<?= $nrWordPressAuth ? 'text' : 'email' ?>" id="auth-email" class="input" placeholder="<?= $nrWordPressAuth ? 'Benutzername oder E-Mail' : 'E-Mail' ?>" maxlength="<?= $nrWordPressAuth ? '120' : '190' ?>" autocomplete="username">
                            <input type="password" id="auth-password" class="input" placeholder="Passwort"<?= $nrWordPressAuth ? '' : ' minlength="8"' ?> autocomplete="current-password">
                            <div id="auth-register-api-wrap" class="auth-register-api-wrap" hidden>
                                <input type="text" id="auth-register-api-key" class="input" placeholder="OpenRouteService API-Key (optional)" maxlength="512" autocomplete="off" spellcheck="false">
                                <p class="hint hint-small auth-api-hint">Für Routing und Rundkurse braucht NatureRide einen kostenlosen OpenRouteService API-Key. Sie können ihn jetzt eintragen; er wird in Ihrem Benutzerprofil gespeichert. Noch keinen Schlüssel? Auf der OpenRouteService-Seite registrieren, im Dashboard einen API-Key erzeugen und hier einfügen: <a href="https://openrouteservice.org/dev/#/signup" target="_blank" rel="noopener noreferrer">OpenRouteService API-Key erstellen</a>.</p>
                            </div>
                        </div>
                        <div class="auth-primary-actions">
                            <button type="button" id="btn-auth-login" class="btn btn-primary">Anmelden</button>
                            <button type="button" id="btn-auth-register" class="btn btn-primary" hidden>Konto erstellen</button>
                        </div>
                        <div class="auth-secondary-actions"<?= $nrWordPressAuth ? ' hidden' : '' ?>>
                            <button type="button" id="btn-auth-toggle-register" class="btn btn-ghost">Neu registrieren</button>
                            <button type="button" id="btn-auth-forgot" class="btn btn-ghost">Passwort vergessen</button>
                        </div>
                        <p id="auth-message" class="hint hint-small" hidden></p>
                    </div>
                    <div class="btn-row">
                        <button type="button" id="konto-dialog-close-btn" class="btn btn-secondary">Schließen</button>
                    </div>
                </div>
            </div>
        </div>
        <div id="piper-tts-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="piper-tts-title" aria-describedby="piper-tts-copy">
                <h2 id="piper-tts-title" class="auth-dialog-title">Sprachausgabe wird vorbereitet</h2>
                <p id="piper-tts-copy" class="auth-dialog-copy">Das Sprachmodell wird geladen. Das kann beim ersten Mal kurz dauern.</p>
                <div class="piper-tts-ride" aria-hidden="true"></div>
                <div class="piper-tts-progress" aria-hidden="true">
                    <div id="piper-tts-progress-bar" class="piper-tts-progress-bar"></div>
                </div>
                <div id="piper-tts-status" class="piper-tts-status" aria-live="polite"></div>
                <div id="piper-tts-actions" class="btn-row">
                    <button type="button" id="piper-tts-activate" class="btn btn-primary">Audio aktivieren</button>
                    <button type="button" id="piper-tts-cancel" class="btn btn-secondary">Abbrechen</button>
                </div>
            </div>
        </div>
        <div id="tts-engine-dialog" class="auth-dialog-overlay" hidden aria-hidden="true">
            <div class="auth-dialog-card" role="dialog" aria-modal="true" aria-labelledby="tts-engine-title" aria-describedby="tts-engine-copy">
                <h2 id="tts-engine-title" class="auth-dialog-title">Sprachausgabe wählen</h2>
                <p id="tts-engine-copy" class="auth-dialog-copy">Welche Stimme möchtest du nutzen?</p>
                <div class="btn-row">
                    <button type="button" id="tts-engine-piper" class="btn btn-primary">Piper</button>
                    <button type="button" id="tts-engine-system" class="btn btn-secondary">System‑Stimme</button>
                </div>
                <p class="hint hint-small">Tipp: Piper benötigt beim ersten Laden etwas Zeit; danach ist es schnell.</p>
            </div>
        </div>
    </div>
    <script>
        window.NR_CSRF = <?= json_encode($csrf, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT) ?>;
        window.NR_BASE = <?= json_encode($nrBasePath, JSON_THROW_ON_ERROR) ?>;
        window.NR_USER = <?= json_encode($currentUser, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT) ?>;
        window.NR_AUTH_NOTICE = <?= json_encode($authNotice, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT) ?>;
        window.NR_WP_AUTH = <?= $nrWordPressAuth ? 'true' : 'false' ?>;
        window.NR_NAV_DEBUG_LOG_ENABLED = <?= json_encode($navDebugLogEnabledInit) ?>;
        window.NR_ORS_SERVER_KEY_CONFIGURED = <?= $nrOrsServerKeyConfigured ? 'true' : 'false' ?>;
    </script>
    <script src="<?= htmlspecialchars($geoHelpersHref, ENT_QUOTES, 'UTF-8') ?>"></script>
    <script type="module" src="<?= htmlspecialchars($piperTtsHref, ENT_QUOTES, 'UTF-8') ?>"></script>
    <script src="<?= htmlspecialchars($nrBasePath, ENT_QUOTES, 'UTF-8') ?>/assets/vendor/leaflet/leaflet.js"></script>
    <script src="<?= htmlspecialchars($nrBasePath, ENT_QUOTES, 'UTF-8') ?>/assets/vendor/skycons/skycons.js"></script>
    <script src="<?= htmlspecialchars($navigationJsHref, ENT_QUOTES, 'UTF-8') ?>" defer></script>
    <script src="<?= htmlspecialchars($appJsHref, ENT_QUOTES, 'UTF-8') ?>" defer></script>
</body>
</html>
