<?php

declare(strict_types=1);

require_once __DIR__ . '/OrsExtras.php';

/**
 * ORS-Directions (GeoJSON) → Client-Payload (gemeinsam für route.php und route_roundtrip.php).
 */

/**
 * @param array<string, mixed> $geojson FeatureCollection
 * @return array{
 *   coords: list<array{0: float, 1: float}>,
 *   summary: array<string, mixed>,
 *   extras: array<string, mixed>|null,
 *   instructions: list<mixed>
 * }
 */
function nr_parse_ors_geojson(array $geojson): array
{
    $features = $geojson['features'] ?? null;
    if (!is_array($features) || !isset($features[0]) || !is_array($features[0])) {
        throw new RuntimeException('Keine Route in der Antwort.');
    }

    $feature = $features[0];
    $geometry = $feature['geometry'] ?? null;
    if (!is_array($geometry) || ($geometry['type'] ?? '') !== 'LineString') {
        throw new RuntimeException('Ungültige Geometrie.');
    }

    $coordinates = $geometry['coordinates'] ?? null;
    if (!is_array($coordinates)) {
        throw new RuntimeException('Keine Koordinaten.');
    }

    $line = nr_coords_from_linestring($coordinates);

    $props = $feature['properties'] ?? null;
    $summary = [];
    $extras = null;
    $instructions = [];

    if (is_array($props)) {
        if (isset($props['summary']) && is_array($props['summary'])) {
            $summary = $props['summary'];
        }
        if (isset($props['extras']) && is_array($props['extras'])) {
            $extras = $props['extras'];
        }
        if (isset($props['segments']) && is_array($props['segments'])) {
            foreach ($props['segments'] as $seg) {
                if (!is_array($seg) || !isset($seg['steps']) || !is_array($seg['steps'])) {
                    continue;
                }
                foreach ($seg['steps'] as $step) {
                    if (is_array($step)) {
                        $instructions[] = $step;
                    }
                }
            }
        }
    }

    return [
        'coords' => $line['coords'],
        'summary' => $summary,
        'extras' => $extras,
        'instructions' => $instructions,
    ];
}

/**
 * Typische Trailerverben aus Namens-Zwischenmatch entfernen (z. B. „… auf Goethestraße ab“).
 */
function nr_ors_trim_street_candidate(string $c): string
{
    $c = trim($c);
    if ($c === '') {
        return '';
    }
    $c = preg_replace('/\s+(ab|ein|an)\s*$/u', '', $c) ?? $c;
    $c = preg_replace('/\s+(abbiegen|einbiegen)\s*$/u', '', $c) ?? $c;
    $c = trim(preg_replace('/\s+/u', ' ', $c) ?? $c);

    return $c;
}

/**
 * Weg-/Straßenname nur aus Klartext-Anweisung (nach strip_tags).
 */
function nr_ors_extract_street_from_plain_instruction(string $plain): string
{
    $plain = trim(preg_replace('/\s+/u', ' ', $plain));
    if ($plain === '') {
        return '';
    }
    $patterns = [
        /* Deutsch: … auf (die) Musterstraße [ab] */
        '/\bauf\s+(?:(?:die|den|dem|der)\s+)?([^.,;]+?)(?:\.|,|;|$)/iu',
        /* … in (die) Musterstraße einbiegen / abbiegen in die … */
        '/\b(?:ab|ein)biegen\s+in\s+(?:(?:die|den|dem|der)\s+)?([^.,;]+?)(?:\.|,|;|$)/iu',
        '/\bin\s+(?:(?:die|den|dem|der)\s+)([^.,;]+?)(?:\s+(?:ein|ab)biegen)?(?:\.|,|;|$)/iu',
        /* auf der B27 weiterfahren / bleiben Sie auf der … */
        '/\bauf\s+der\s+([^.,;\s]+(?:\s+[^.,;\s]+){0,5}?)\s+(?:weiter|weiterfahren|bleib|folgen)/iu',
        '/\bbleib(?:en)?\s+Sie\s+auf\s+(?:der|dem)\s+([^.,;]+?)(?:\.|,|;|$)/iu',
        /* Englisch (Fallback) */
        '/\bonto\s+([^.,;]+?)(?:\.|,|;|$)/iu',
        '/\b(?:on|along)\s+the\s+([^.,;]+?)(?:\.|,|;|$)/iu',
        '/\b(?:Turn|Head)\s+[^.,]+?\s+onto\s+([^.,;]+?)(?:\.|,|;|$)/iu',
    ];
    foreach ($patterns as $re) {
        if (preg_match($re, $plain, $m) && isset($m[1])) {
            $c = nr_ors_trim_street_candidate(trim($m[1]));
            $parts = preg_split('/\s+und\s+/u', $c, 2);
            $c = trim(is_array($parts) && isset($parts[0]) ? $parts[0] : $c);
            if ($c !== '' && mb_strlen($c) <= 80 && !preg_match('/^(links|rechts|geradeaus|demnächst)$/iu', $c)) {
                return $c;
            }
        }
    }

    return '';
}

/**
 * Straßen-/Wegname aus ORS-Schritt (GeoJSON segments.steps): oft in `instruction` (HTML),
 * manchmal nur in `name` / `street_name` / `way_name`.
 *
 * @param array<string, mixed> $step
 */
function nr_ors_step_street_name(array $step): string
{
    foreach (['name', 'street_name', 'way_name', 'wayName', 'streetName'] as $key) {
        if (!isset($step[$key]) || !is_string($step[$key])) {
            continue;
        }
        $candidate = trim($step[$key]);
        if ($candidate === '' || strcasecmp($candidate, 'null') === 0) {
            continue;
        }
        if (preg_match('/^unnamed$/i', $candidate)) {
            continue;
        }
        if (mb_strlen($candidate) > 120) {
            $candidate = mb_substr($candidate, 0, 120);
        }

        return $candidate;
    }
    $instr = isset($step['instruction']) && is_string($step['instruction']) ? $step['instruction'] : '';
    if ($instr === '') {
        return '';
    }
    $plain = trim(preg_replace('/\s+/u', ' ', strip_tags($instr)));
    if ($plain === '') {
        return '';
    }
    $fromPlain = nr_ors_extract_street_from_plain_instruction($plain);
    if ($fromPlain !== '') {
        return $fromPlain;
    }

    return '';
}

/**
 * @param list<mixed> $rawSteps
 * @return list<array{instruction: string, step_distance_m: float, type: int, way_start_index: int|null, way_end_index: int|null, street: string}>
 */
function nr_normalize_navigation_steps(array $rawSteps, int $coordCount): array
{
    $out = [];
    $maxIdx = max(0, $coordCount - 1);

    $stepCount = count($rawSteps);
    foreach ($rawSteps as $idx => $step) {
        if (!is_array($step)) {
            continue;
        }
        $instr = isset($step['instruction']) && is_string($step['instruction']) ? $step['instruction'] : '';
        $dist = isset($step['distance']) ? (float) $step['distance'] : 0.0;
        $type = isset($step['type']) ? (int) $step['type'] : 0;
        $street = nr_ors_step_street_name($step);

        $wp = $step['way_points'] ?? $step['wayPoints'] ?? null;
        $startIdx = null;
        $endIdx = null;
        if (is_array($wp) && count($wp) >= 2) {
            $startIdx = (int) $wp[0];
            if ($startIdx < 0) {
                $startIdx = 0;
            }
            if ($startIdx > $maxIdx) {
                $startIdx = $maxIdx;
            }
            $endIdx = (int) $wp[1];
            if ($endIdx < 0) {
                $endIdx = 0;
            }
            if ($endIdx > $maxIdx) {
                $endIdx = $maxIdx;
            }
        }

        $isIntermediateFinish = $type === 10 && (
            ($endIdx !== null && $endIdx < $maxIdx)
            || ($endIdx === null && $idx < $stepCount - 1)
        );
        if ($isIntermediateFinish) {
            $type = 6;
            $instr = 'Dem Verlauf folgen';
        }

        $out[] = [
            'instruction' => $instr,
            'step_distance_m' => $dist,
            'type' => $type,
            'way_start_index' => $startIdx,
            'way_end_index' => $endIdx,
            'street' => $street,
        ];
    }

    return $out;
}

/**
 * @param list<mixed> $coordinates GeoJSON [lon, lat] oder [lon, lat, ele]
 * @return array{coords: list<array{0: float, 1: float}>}
 */
function nr_coords_from_linestring(array $coordinates): array
{
    $coords = [];
    foreach ($coordinates as $c) {
        if (!is_array($c) || count($c) < 2) {
            continue;
        }
        $lon = (float) $c[0];
        $lat = (float) $c[1];
        $coords[] = [$lat, $lon];
    }
    if ($coords === []) {
        throw new RuntimeException('Leere Geometrie.');
    }

    return [
        'coords' => $coords,
    ];
}

/**
 * @param array<string, mixed> $geojson ORS GeoJSON FeatureCollection
 * @param array<string, mixed> $extraFields z. B. roundtrip_variant, roundtrip_seed
 * @return array<string, mixed>
 */
function nr_build_client_route_from_geojson(array $geojson, string $profil, ?float $maxDetourKm, bool $detourCapped, array $extraFields = []): array
{
    $parsed = nr_parse_ors_geojson($geojson);
    $coords2d = $parsed['coords'];
    $summary = $parsed['summary'];
    $extras = $parsed['extras'];

    $split = OrsExtras::natureAsphaltFromExtras($extras);
    $surfaceSegments = nr_normalize_surface_segments($extras, count($coords2d));

    $navSteps = nr_normalize_navigation_steps($parsed['instructions'], count($coords2d));

    $distanceM = (float) ($summary['distance'] ?? 0);
    $durationSec = (float) ($summary['duration'] ?? 0);
    $base = [
        'ok' => true,
        'distance' => round($distanceM / 1000, 2),
        'duration' => (int) max(1, round($durationSec / 60)),
        'surface_nature' => $split['surface_nature'],
        'asphalt' => $split['asphalt'],
        'geometry' => array_map(static function (array $c): array {
            return [(float) $c[0], (float) $c[1]];
        }, $coords2d),
        'surface_segments' => $surfaceSegments,
        'instructions' => $parsed['instructions'],
        'navigation' => ['steps' => $navSteps],
        'profil' => $profil,
        'max_detour_km' => $maxDetourKm,
        'detour_capped' => $detourCapped,
    ];

    return array_merge($base, $extraFields);
}

/**
 * @param array<string, mixed>|null $extras
 * @return list<array{from_index:int,to_index:int,surface_value:int}>
 */
function nr_normalize_surface_segments(?array $extras, int $coordCount): array
{
    if ($extras === null || !isset($extras['surface']['values']) || !is_array($extras['surface']['values'])) {
        return [];
    }
    $maxIdx = max(0, $coordCount - 1);
    $out = [];
    foreach ($extras['surface']['values'] as $row) {
        if (!is_array($row) || count($row) < 3) {
            continue;
        }
        $from = max(0, min($maxIdx, (int) $row[0]));
        $to = max(0, min($maxIdx, (int) $row[1]));
        if ($to <= $from) {
            $to = min($maxIdx, $from + 1);
        }
        if ($to <= $from) {
            continue;
        }
        $out[] = [
            'from_index' => $from,
            'to_index' => $to,
            'surface_value' => (int) $row[2],
        ];
    }

    return $out;
}

/**
 * way_points eines Chunk-Schritts auf den Indexbereich der zusammengefügten LineString-Koordinaten abbilden.
 *
 * @param array<string, mixed> $step
 * @return array<string, mixed>
 */
function nr_remap_ors_chunk_step_waypoints(array $step, int $baseIdx, bool $skipFirst, bool $isFirstChunk): array
{
    $mapLocalToMerged = static function (int $localIdx) use ($baseIdx, $skipFirst, $isFirstChunk): int {
        if ($isFirstChunk) {
            return max(0, $localIdx);
        }
        if ($skipFirst) {
            if ($localIdx <= 0) {
                return max(0, $baseIdx - 1);
            }

            return $baseIdx + $localIdx - 1;
        }

        return $baseIdx + $localIdx;
    };

    $wp = $step['way_points'] ?? $step['wayPoints'] ?? null;
    if (!is_array($wp) || count($wp) < 2) {
        return $step;
    }
    $a = $mapLocalToMerged(max(0, (int) $wp[0]));
    $b = $mapLocalToMerged(max(0, (int) $wp[1]));
    if ($b < $a) {
        $t = $a;
        $a = $b;
        $b = $t;
    }
    $step['way_points'] = [$a, $b];
    unset($step['wayPoints']);

    return $step;
}

/**
 * Mehrere ORS-Directions-GeoJSONs (je ein LineString-Feature) zu einer Route zusammenfügen
 * (z. B. Rundkurs in ≤50-Koordinaten-Chunks). Summiert Distanz/Dauer/Höhe; Navigations-Segmente
 * werden an die zusammengefügte Geometrie angepasst (way_points-Indizes pro Chunk verschoben).
 *
 * @param list<array<string, mixed>> $featureCollections ORS FeatureCollection mit genau einem Feature
 * @return array<string, mixed> ORS-ähnliche FeatureCollection
 */
function nr_merge_ors_roundtrip_geojsons(array $featureCollections): array
{
    if ($featureCollections === []) {
        throw new RuntimeException('Keine Routen zum Zusammenfügen.');
    }

    $mergedCoords = [];
    $mergedRawSteps = [];
    $distanceM = 0.0;
    $durationS = 0.0;
    $ascentM = 0.0;
    $descentM = 0.0;
    $firstExtras = null;
    $mergedSurfaceValues = [];
    $eps = 1e-5;

    foreach ($featureCollections as $ci => $fc) {
        $features = $fc['features'] ?? null;
        if (!is_array($features) || !isset($features[0]) || !is_array($features[0])) {
            throw new RuntimeException('Ungültige ORS-Antwort (Feature).');
        }
        $feature = $features[0];
        $geometry = $feature['geometry'] ?? null;
        if (!is_array($geometry) || ($geometry['type'] ?? '') !== 'LineString') {
            throw new RuntimeException('Ungültige ORS-Geometrie.');
        }
        $coords = $geometry['coordinates'] ?? null;
        if (!is_array($coords) || $coords === []) {
            throw new RuntimeException('Leere Routen-Geometrie.');
        }

        $baseIdx = count($mergedCoords);
        $skipFirst = false;
        if ($ci === 0) {
            foreach ($coords as $pt) {
                if (is_array($pt) && count($pt) >= 2) {
                    $mergedCoords[] = $pt;
                }
            }
        } else {
            $first = $coords[0];
            if (!is_array($first) || count($first) < 2) {
                throw new RuntimeException('Ungültige Koordinate.');
            }
            $last = $mergedCoords[count($mergedCoords) - 1] ?? null;
            if (is_array($last) && count($last) >= 2
                && abs((float) $first[0] - (float) $last[0]) < $eps
                && abs((float) $first[1] - (float) $last[1]) < $eps) {
                $skipFirst = true;
            }
            $startIdx = $skipFirst ? 1 : 0;
            for ($j = $startIdx, $jn = count($coords); $j < $jn; $j++) {
                $pt = $coords[$j];
                if (is_array($pt) && count($pt) >= 2) {
                    $mergedCoords[] = $pt;
                }
            }
        }

        try {
            $parsedChunk = nr_parse_ors_geojson($fc);
            $isFirstChunk = $ci === 0;
            foreach ($parsedChunk['instructions'] as $rawStep) {
                if (!is_array($rawStep)) {
                    continue;
                }
                $mergedRawSteps[] = nr_remap_ors_chunk_step_waypoints($rawStep, $baseIdx, $skipFirst, $isFirstChunk);
            }
        } catch (Throwable) {
            /* Chunk ohne gültige Schritte ignorieren */
        }

        $props = $feature['properties'] ?? null;
        if (is_array($props)) {
            if ($firstExtras === null && isset($props['extras']) && is_array($props['extras'])) {
                $firstExtras = $props['extras'];
            }
            if (isset($props['extras']['surface']['values']) && is_array($props['extras']['surface']['values'])) {
                $offset = $baseIdx - ($skipFirst ? 1 : 0);
                foreach ($props['extras']['surface']['values'] as $row) {
                    if (!is_array($row) || count($row) < 3) {
                        continue;
                    }
                    $mergedSurfaceValues[] = [
                        $offset + (int) $row[0],
                        $offset + (int) $row[1],
                        (int) $row[2],
                    ];
                }
            }
            $summary = $props['summary'] ?? null;
            if (is_array($summary)) {
                $distanceM += (float) ($summary['distance'] ?? 0);
                $durationS += (float) ($summary['duration'] ?? 0);
                $ascentM += (float) ($summary['ascent'] ?? $summary['total_ascent'] ?? 0);
                $descentM += (float) ($summary['descent'] ?? $summary['total_descent'] ?? 0);
            }
        }
    }

    if ($mergedCoords === []) {
        throw new RuntimeException('Leere zusammengefügte Geometrie.');
    }
    if ($firstExtras === null) {
        $firstExtras = [];
    }
    if ($mergedSurfaceValues !== []) {
        if (!isset($firstExtras['surface']) || !is_array($firstExtras['surface'])) {
            $firstExtras['surface'] = [];
        }
        $firstExtras['surface']['values'] = $mergedSurfaceValues;
    }

    return [
        'type' => 'FeatureCollection',
        'features' => [
            [
                'type' => 'Feature',
                'properties' => [
                    'summary' => [
                        'distance' => $distanceM,
                        'duration' => $durationS,
                        'ascent' => $ascentM,
                        'descent' => $descentM,
                    ],
                    'segments' => $mergedRawSteps !== []
                        ? [
                            [
                                'steps' => $mergedRawSteps,
                            ],
                        ]
                        : [],
                    'extras' => $firstExtras,
                ],
                'geometry' => [
                    'type' => 'LineString',
                    'coordinates' => $mergedCoords,
                ],
            ],
        ],
    ];
}
