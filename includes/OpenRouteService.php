<?php

declare(strict_types=1);

/**
 * Schlanker ORS-Client für Shared-Hosting-Betrieb.
 */
final class OpenRouteService
{
    private string $baseUrl;
    private string $apiKey;

    /** @var float|null Monotonic: letzter ORS-Request (Burst-Schutz) */
    private static ?float $lastOrsRequestMono = null;

    public function __construct(string $baseUrl, string $apiKey)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->apiKey = trim($apiKey);
    }

    /**
     * @param list<array{0: float, 1: float}> $pointsWgs84 Lat, Lon
     * @return array<string, mixed>
     */
    public function route(array $pointsWgs84, string $profil, ?float $maxDetourKm = null): array
    {
        return $this->routeWithMeta($pointsWgs84, $profil, $maxDetourKm)['geojson'];
    }

    /**
     * @param list<array{0: float, 1: float}> $pointsWgs84 Lat, Lon
     * @return array{geojson: array<string, mixed>, detour_capped: bool}
     */
    public function routeWithMeta(array $pointsWgs84, string $profil, ?float $maxDetourKm = null, bool $tightSnap = false): array
    {
        $this->assertReady();
        if (count($pointsWgs84) < 2) {
            throw new RuntimeException('Mindestens Start- und Zielpunkt erforderlich.');
        }

        $coordinates = self::toLonLatCoords($pointsWgs84);
        $slug = self::engineProfileSlug($profil);
        $n = count($coordinates);
        $radiuses = self::waypointSnapRadiiList($n, $profil, $tightSnap);

        $body = self::buildRequestBody($profil, $coordinates, $radiuses);
        $primary = $this->postGeoJson($slug, $body);

        if ($maxDetourKm === null) {
            return ['geojson' => $primary, 'detour_capped' => false];
        }

        $baselineBody = self::buildMinimalBodyWithPreference(
            $coordinates,
            self::waypointSnapRadiiList($n, 'gravel'),
            'fastest'
        );
        $baseline = $this->postGeoJson('cycling-regular', $baselineBody);
        $primaryDistance = self::routeDistanceM($primary);
        $baselineDistance = self::routeDistanceM($baseline);

        if ($primaryDistance <= 1.0 || $baselineDistance <= 1.0) {
            return ['geojson' => $primary, 'detour_capped' => false];
        }

        $detourLimitM = max(0.0, min(150.0, $maxDetourKm)) * 1000.0;
        if (($primaryDistance - $baselineDistance) <= $detourLimitM + 80.0) {
            return ['geojson' => $primary, 'detour_capped' => false];
        }

        return ['geojson' => $baseline, 'detour_capped' => true];
    }

    /**
     * @param list<array{0: float, 1: float}> $pointsWgs84Closed Lat, Lon, letzter Punkt = erster
     * @return array{geojson: array<string, mixed>, detour_capped: bool}
     */
    public function routeRoundtripLoopWithMeta(array $pointsWgs84Closed, string $profil): array
    {
        $this->assertReady();
        if (count($pointsWgs84Closed) <= 50) {
            return $this->routeRoundtripWithMeta($pointsWgs84Closed, $profil);
        }

        if (!function_exists('nr_merge_ors_roundtrip_geojsons')) {
            require_once __DIR__ . '/route_geojson.php';
        }

        $chunks = self::splitClosedLoopWaypointsForOrs($pointsWgs84Closed, 50);
        $parts = [];
        foreach ($chunks as $chunk) {
            $parts[] = $this->routeRoundtripWithMeta($chunk, $profil)['geojson'];
        }

        return [
            'geojson' => nr_merge_ors_roundtrip_geojsons($parts),
            'detour_capped' => false,
        ];
    }

    /**
     * Wegpunkte-Schleife: alle Nutzer-Wegpunkte in Reihenfolge verbinden (Start = Ende).
     * Statt einer einzigen ORS-Route werden die Teilstrecken jeweils zwischen zwei Punkten geroutet
     * und anschließend zu einer Route zusammengeführt. Dadurch werden die Wegpunkte so gut wie
     * möglich tatsächlich angefahren.
     *
     * @param list<array{0: float, 1: float}> $pointsWgs84Closed Lat, Lon (letzter Punkt = erster)
     * @return array{geojson: array<string, mixed>, detour_capped: bool}
     */
    public function routeWaypointsLoopWithMeta(array $pointsWgs84Closed, string $profil): array
    {
        $this->assertReady();
        $pts = self::normalizeClosedLoopWaypoints($pointsWgs84Closed);
        $n = count($pts);
        if ($n < 3) {
            throw new RuntimeException('Mindestens drei Wegpunkte (inkl. Start=Ende) erforderlich.');
        }
        if (!function_exists('nr_merge_ors_roundtrip_geojsons')) {
            require_once __DIR__ . '/route_geojson.php';
        }
        $parts = [];
        // Jede Kante der Schleife separat routen: (p0->p1), (p1->p2), ..., (p(n-2)->p(n-1))
        for ($i = 0; $i < $n - 1; $i++) {
            $a = $pts[$i];
            $b = $pts[$i + 1];
            // Bei doppelten Punkten (z. B. Tippfehler/Drag) Segment überspringen.
            if (abs($a[0] - $b[0]) < 1e-8 && abs($a[1] - $b[1]) < 1e-8) {
                continue;
            }
            $parts[] = $this->routeWithMeta([$a, $b], $profil, null, true)['geojson'];
        }

        return [
            'geojson' => nr_merge_ors_roundtrip_geojsons($parts),
            'detour_capped' => false,
        ];
    }

    /**
     * @param list<array{0: float, 1: float}> $pointsWgs84Closed
     * @return list<array{0: float, 1: float}>
     */
    private static function normalizeClosedLoopWaypoints(array $pointsWgs84Closed): array
    {
        $out = [];
        $eps = 1e-7;
        foreach ($pointsWgs84Closed as $p) {
            if (!is_array($p) || count($p) < 2) {
                continue;
            }
            $lat = (float) $p[0];
            $lon = (float) $p[1];
            if (!is_finite($lat) || !is_finite($lon)) {
                continue;
            }
            $prev = $out[count($out) - 1] ?? null;
            if (is_array($prev) && abs($prev[0] - $lat) < $eps && abs($prev[1] - $lon) < $eps) {
                continue;
            }
            $out[] = [$lat, $lon];
        }
        if (count($out) >= 2) {
            $first = $out[0];
            $last = $out[count($out) - 1];
            if (abs($first[0] - $last[0]) >= $eps || abs($first[1] - $last[1]) >= $eps) {
                $out[] = $first;
            }
        }
        return $out;
    }

    /**
     * @param list<array{0: float, 1: float}> $pointsWgs84 Lat, Lon
     * @return array{geojson: array<string, mixed>, detour_capped: bool}
     */
    public function routeRoundtripWithMeta(array $pointsWgs84, string $profil): array
    {
        $this->assertReady();
        if (count($pointsWgs84) < 2) {
            throw new RuntimeException('Mindestens Start- und Zielpunkt erforderlich.');
        }

        $coordinates = self::toLonLatCoords($pointsWgs84);
        $slug = self::engineProfileSlug($profil);
        $radiuses = self::waypointSnapRadiiList(count($coordinates), $profil);
        $body = self::buildRoundtripRequestBody($profil, $coordinates, $radiuses);

        return [
            'geojson' => $this->postGeoJson($slug, $body),
            'detour_capped' => false,
        ];
    }

    private function assertReady(): void
    {
        if ($this->apiKey === '') {
            throw new RuntimeException('OpenRouteService API-Key fehlt. Bitte config.local.php (openrouteservice.api_key) setzen.');
        }
        if ($this->baseUrl === '') {
            throw new RuntimeException('OpenRouteService-URL fehlt. Bitte config.local.php (openrouteservice.base_url) setzen.');
        }
    }

    /**
     * @param list<array{0: float, 1: float}> $pointsWgs84
     * @return list<array{0: float, 1: float}>
     */
    private static function toLonLatCoords(array $pointsWgs84): array
    {
        $coordinates = [];
        foreach ($pointsWgs84 as $p) {
            $coordinates[] = [(float) $p[1], (float) $p[0]];
        }

        return $coordinates;
    }

    private static function engineProfileSlug(string $profil): string
    {
        return match ($profil) {
            'ruhig', 'radwege' => 'cycling-road',
            'gravel' => 'cycling-regular',
            'natur', 'abenteuer', 'offroad', 'kurvig' => 'cycling-mountain',
            default => 'cycling-regular',
        };
    }

    /**
     * Suchradius pro Wegpunkt (Meter) fürs Snappen auf das Straßen-/Wegenetz.
     * 800 m überall erzeugt oft Parallelstraßen-Sprünge; zu klein (z. B. 125 m) scheitert bei
     * Kreis-Hilfspunkten auf Acker/Wald. Zwischenwerte + Retry bei ORS-404 (siehe postGeoJson).
     */
    private static function waypointSnapRadiiM(int $waypointCount, string $profil, bool $tightSnap): int
    {
        $n = max(2, $waypointCount);
        $dense = $n >= 22;
        $many = $n >= 11;

        $m = match ($profil) {
            'radwege' => $dense ? 205 : ($many ? 200 : 215),
            'ruhig' => $dense ? 240 : ($many ? 185 : 230),
            'gravel' => $dense ? 300 : ($many ? 235 : 310),
            'abenteuer' => $dense ? 220 : ($many ? 190 : 235),
            'offroad' => $dense ? 320 : ($many ? 255 : 335),
            // Kurvenreich: engeres Snapping, damit die Route häufiger auf kleine Wege/Abzweige "greift".
            'kurvig' => $dense ? 230 : ($many ? 195 : 240),
            default => $dense ? 285 : ($many ? 220 : 295),
        };

        if (!$tightSnap) {
            return max(200, min(520, $m));
        }
        // Wegpunkte-Modus: so nah wie möglich an die Wegpunkte snappen.
        // Falls ORS den Punkt nicht findet, erweitert postGeoJson() die radiuses automatisch (404-Retry).
        $tight = match ($profil) {
            'offroad' => 140,
            'gravel' => 120,
            default => 110,
        };
        $tightAdj = $dense ? (int) max(70, $tight - 10) : ($many ? (int) max(75, $tight - 5) : $tight);
        return max(60, min(220, $tightAdj));
    }

    /**
     * @return list<int>
     */
    private static function waypointSnapRadiiList(int $waypointCount, string $profil, bool $tightSnap = false): array
    {
        $n = max(0, $waypointCount);
        $r = self::waypointSnapRadiiM(max(2, $waypointCount), $profil, $tightSnap);

        return array_fill(0, $n, $r);
    }

    /**
     * @param list<array{0: float, 1: float}> $coordinates Lon, Lat
     * @param list<int> $radiuses
     * @return array<string, mixed>
     */
    private static function buildRequestBody(string $profil, array $coordinates, array $radiuses): array
    {
        $body = self::buildMinimalBodyWithPreference($coordinates, $radiuses, 'recommended');

        if ($profil === 'ruhig') {
            $body['preference'] = 'recommended';
        } elseif ($profil === 'radwege') {
            $body['preference'] = 'recommended';
            self::applyRoadCyclingOptions($body);
        } elseif ($profil === 'gravel') {
            $body['preference'] = 'shortest';
        } elseif ($profil === 'offroad') {
            $body['preference'] = 'shortest';
            $body['options'] = [
                'avoid_features' => ['ferries', 'fords', 'steps'],
                'profile_params' => [
                    'weightings' => [
                        // ORS kann Oberflächen nicht hart "erzwingen"; offroad wird über Profil + shortest modelliert.
                        // Wir wählen mittlere Steigungs-Toleranz (0–3).
                        'steepness_difficulty' => 2,
                    ],
                ],
            ];
        } elseif ($profil === 'kurvig') {
            // Viele Abzweige: shortest + mountain-Profil erzeugt tendenziell kleinteiligere Wege.
            $body['preference'] = 'shortest';
        } elseif ($profil === 'abenteuer') {
            $body['preference'] = 'shortest';
        }

        return $body;
    }

    /**
     * @param list<array{0: float, 1: float}> $coordinates Lon, Lat
     * @param list<int> $radiuses
     * @return array<string, mixed>
     */
    private static function buildMinimalBodyWithPreference(array $coordinates, array $radiuses, string $preference): array
    {
        return [
            'coordinates' => $coordinates,
            'extra_info' => ['surface', 'waytype', 'steepness'],
            'preference' => $preference,
            'units' => 'm',
            'language' => 'de',
            'instructions' => true,
            'radiuses' => $radiuses,
        ];
    }

    /**
     * ORS unterstützt für cycling-* nur wenige harte Ausschlüsse. Radweg/Straße wird deshalb über
     * cycling-road + Vermeidung von nicht radfahrtypischen Hindernissen modelliert.
     *
     * @param array<string, mixed> $body
     */
    private static function applyRoadCyclingOptions(array &$body): void
    {
        $body['options'] = [
            'avoid_features' => ['ferries', 'fords', 'steps'],
            'profile_params' => [
                'weightings' => [
                    'steepness_difficulty' => 0,
                ],
            ],
        ];
    }

    /**
     * @param list<array{0: float, 1: float}> $coordinates Lon, Lat
     * @param list<int> $radiuses
     * @return array<string, mixed>
     */
    private static function buildRoundtripRequestBody(string $profil, array $coordinates, array $radiuses): array
    {
        $body = match ($profil) {
            'gravel', 'offroad', 'abenteuer' => self::buildMinimalBodyWithPreference($coordinates, $radiuses, 'shortest'),
            default => self::buildMinimalBodyWithPreference($coordinates, $radiuses, 'recommended'),
        };
        if ($profil === 'radwege') {
            self::applyRoadCyclingOptions($body);
        }

        return $body;
    }

    /**
     * @param list<array{0: float, 1: float}> $closedLoopLatLon
     * @return list<list<array{0: float, 1: float}>>
     */
    private static function splitClosedLoopWaypointsForOrs(array $closedLoopLatLon, int $maxCoords): array
    {
        $n = count($closedLoopLatLon);
        if ($n <= $maxCoords) {
            return [$closedLoopLatLon];
        }

        $chunks = [];
        $start = 0;
        while ($start < $n - 1) {
            $endExclusive = min($start + $maxCoords, $n);
            $chunks[] = array_values(array_slice($closedLoopLatLon, $start, $endExclusive - $start));
            if ($endExclusive >= $n) {
                break;
            }
            $start = $endExclusive - 1;
        }

        return $chunks;
    }

    private function postGeoJson(string $slug, array $body): array
    {
        $maxWiden = 4;
        $widenCount = 0;
        $rateLimitRound = 0;
        $rateLimitPauses = [2, 4, 7, 12, 20, 35];
        $maxRateLimitRounds = count($rateLimitPauses);

        while (true) {
            self::throttleOrsBurst();

            $url = $this->baseUrl . '/v2/directions/' . rawurlencode($slug) . '/geojson';
            $payload = json_encode($body, JSON_THROW_ON_ERROR);

            $ch = curl_init($url);
            if ($ch === false) {
                throw new RuntimeException('cURL konnte nicht initialisiert werden.');
            }

            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => [
                    'Authorization: ' . $this->apiKey,
                    'Content-Type: application/json',
                    'Accept: application/geo+json, application/json;q=0.9',
                    'Accept-Language: de',
                ],
                CURLOPT_POSTFIELDS => $payload,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 30,
            ]);

            $raw = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err = curl_error($ch);
            curl_close($ch);

            if ($raw === false) {
                throw new RuntimeException('Netzwerkfehler bei OpenRouteService' . ($err !== '' ? ': ' . $err : '.'));
            }

            /** @var mixed $json */
            $json = json_decode($raw, true);
            if (!is_array($json)) {
                throw new RuntimeException('Ungültige OpenRouteService-Antwort.');
            }

            if ($code < 400) {
                return $json;
            }

            $errMsg = self::formatOrsError($json, $code);

            if ($code === 429) {
                if ($rateLimitRound >= $maxRateLimitRounds) {
                    throw new RuntimeException($errMsg);
                }
                sleep($rateLimitPauses[$rateLimitRound]);
                $rateLimitRound++;
                continue;
            }

            if (
                $code === 404
                && $widenCount < $maxWiden
                && str_contains($errMsg, 'Could not find routable point')
                && self::widenRequestRadiuses($body)
            ) {
                $widenCount++;
                continue;
            }

            throw new RuntimeException($errMsg);
        }
    }

    /**
     * Kurze Pause zwischen ORS-Anfragen (Rundkurs erzeugt viele Calls); reduziert HTTP 429.
     */
    private static function throttleOrsBurst(): void
    {
        $minGap = 0.22;
        $now = microtime(true);
        if (self::$lastOrsRequestMono !== null) {
            $elapsed = $now - self::$lastOrsRequestMono;
            if ($elapsed < $minGap) {
                usleep((int) (($minGap - $elapsed) * 1_000_000));
            }
        }
        self::$lastOrsRequestMono = microtime(true);
    }

    /**
     * Vergrößert alle Einträge in $body['radiuses'] für einen erneuten ORS-Versuch.
     *
     * @param array<string, mixed> $body
     */
    private static function widenRequestRadiuses(array &$body): bool
    {
        if (!isset($body['radiuses']) || !is_array($body['radiuses']) || $body['radiuses'] === []) {
            return false;
        }
        $coords = $body['coordinates'] ?? null;
        if (!is_array($coords) || $coords === []) {
            return false;
        }
        $n = count($coords);
        $first = $body['radiuses'][0] ?? 0;
        $cur = is_numeric($first) ? (int) round((float) $first) : 0;
        if ($cur < 1) {
            $cur = 200;
        }
        $wider = min(800, max($cur + 120, (int) round($cur * 2.15)));
        if ($wider <= $cur) {
            return false;
        }
        $body['radiuses'] = array_fill(0, $n, $wider);

        return true;
    }

    /**
     * @param array<string, mixed> $json
     */
    private static function routeDistanceM(array $json): float
    {
        $features = $json['features'] ?? null;
        if (!is_array($features) || !isset($features[0]) || !is_array($features[0])) {
            return 0.0;
        }
        $summary = $features[0]['properties']['summary'] ?? null;
        if (!is_array($summary)) {
            return 0.0;
        }

        return isset($summary['distance']) ? (float) $summary['distance'] : 0.0;
    }

    /**
     * @param array<string, mixed> $json
     */
    private static function formatOrsError(array $json, int $code): string
    {
        $msg = '';
        if (isset($json['error']) && is_array($json['error']) && isset($json['error']['message']) && is_string($json['error']['message'])) {
            $msg = $json['error']['message'];
        } elseif (isset($json['message']) && is_string($json['message'])) {
            $msg = $json['message'];
        }

        return 'OpenRouteService-Fehler (HTTP ' . $code . ')' . ($msg !== '' ? ': ' . trim($msg) : '.');
    }
}
