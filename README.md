# NatureRide Navigator

Webbasierte Fahrrad-Navigation mit **OpenStreetMap**, **Leaflet** (Karte) und **OpenRouteService** (Routing über PHP-Backend). Natur-/Asphalt-Anteile werden aus ORS **surface**-Extras abgeleitet; GPX-Export und responsive UI.

## Voraussetzungen

- PHP 8.x mit `curl`, `json`, `dom`, `mbstring`, `session`
- Apache/Nginx oder PHP Built-in Server
- **HTTPS** für zuverlässige GPS-Nutzung
- Kostenloser [OpenRouteService API-Key](https://openrouteservice.org/dev/#/signup) (kostenloses Kontingent)

## Installation

1. Projekt ins Webroot kopieren.
2. `cp config/config.example.php config/config.local.php`
3. In `config/config.local.php`: **`openrouteservice.api_key`** eintragen.
4. Datenbank-Zugang in `private/db.local.php` hinterlegen.
5. Schreibrechte für `cache/`.
6. Aufruf z. B. `https://localhost/biketour/index.php`.

## Anmeldung und gespeicherte Routen

- Nutzer können sich registrieren und anmelden.
- Für angemeldete Nutzer lassen sich Routen speichern, laden und löschen.
- Die benötigten MySQL-Tabellen `nr_users` und `nr_saved_routes` werden beim ersten Zugriff automatisch angelegt.
- Das Verzeichnis `private/` ist per `.htaccess` für Apache gesperrt. Bei Nginx sollte ein entsprechender Deny-Block ebenfalls gesetzt werden.

## Navigation (iPhone / mobil)

Nach der Routenberechnung: **Navigation starten** öffnet die Turn-by-Turn-Ansicht (Abstand zum Manöver, ORS-Abbiegetext, Straßenname). **GPS-Simulation** bewegt eine Positionsmarke entlang der Route (Tempo wählbar) – für Tests ohne echtes GPS. Nutzung von **HTTPS** und Standortfreigabe für Live-GPS empfohlen.

## Routing (ORS)

| UI-Profil | ORS-Profil | Anmerkung |
|-----------|------------|-----------|
| Naturroute, Gravel, Abenteuer | `cycling-mountain` | `steepness_difficulty` je nach Profil |
| Ruhige Route | `cycling-regular` | u. a. weniger „trail-lastig“ |

Die Route wird als GeoJSON-**LineString** verarbeitet.

## API-Endpunkte

| Datei | Zweck |
|--------|--------|
| `api/route.php` | POST Routing |
| `api/export_gpx.php` | GPX |
| `api/geocode.php` | Ortssuche (Nominatim-Proxy) |
| `api/settings.php` | Session-Einstellungen |
| `api/auth_register.php` / `api/auth_login.php` / `api/auth_logout.php` | Konto |
| `api/saved_routes.php` | Eigene Routen speichern / laden |

POST-Endpunkte (außer Geocode GET): Header `X-CSRF-Token` wie in `index.php`.

## Karten-Tiles

Standard: OSM-Tiles – Nutzungsrichtlinien beachten.

## Lizenz

Projektcode für NatureRide Navigator; Kartendaten © OpenStreetMap-Mitwirkende; Routing über OpenRouteService (deren Nutzungsbedingungen beachten).
