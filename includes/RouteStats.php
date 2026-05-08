<?php

declare(strict_types=1);

/**
 * Berechnet Distanzen pro road_class (legacy/GraphHopper-ähnliches detail-Format) und Geometrie.
 */
final class RouteStats
{
    /**
     * @param list<array{0: float, 1: float}> $coords Lat, Lon
     * @param list<array{0: int, 1: int, 2: string}>|null $roadClassDetails
     * @return array{surface_nature: float, asphalt: float, nature_m: float, asphalt_m: float}
     */
    public static function natureAsphaltSplit(array $coords, ?array $roadClassDetails): array
    {
        $totalM = self::polylineLengthMeters($coords);
        if ($totalM < 1 || $roadClassDetails === null || $roadClassDetails === []) {
            return [
                'surface_nature' => 50.0,
                'asphalt' => 50.0,
                'nature_m' => $totalM * 0.5,
                'asphalt_m' => $totalM * 0.5,
            ];
        }

        $natureM = 0.0;
        $asphaltM = 0.0;
        $lastIndex = max(0, count($coords) - 1);

        foreach ($roadClassDetails as $triple) {
            if (!is_array($triple) || count($triple) < 3) {
                continue;
            }
            $from = max(0, min($lastIndex, (int) $triple[0]));
            $to = max(0, min($lastIndex, (int) $triple[1]));
            $cls = strtoupper((string) $triple[2]);
            $segM = self::partialLength($coords, $from, $to);
            if (self::isStrongNature($cls)) {
                $natureM += $segM;
            } elseif (self::isStrongAsphalt($cls)) {
                $asphaltM += $segM;
            } else {
                $natureM += $segM * 0.55;
                $asphaltM += $segM * 0.45;
            }
        }

        $sum = $natureM + $asphaltM;
        if ($sum < 1) {
            return [
                'surface_nature' => 50.0,
                'asphalt' => 50.0,
                'nature_m' => $totalM * 0.5,
                'asphalt_m' => $totalM * 0.5,
            ];
        }

        return [
            'surface_nature' => round(100.0 * $natureM / $sum, 1),
            'asphalt' => round(100.0 * $asphaltM / $sum, 1),
            'nature_m' => $natureM,
            'asphalt_m' => $asphaltM,
        ];
    }

    /**
     * @param list<array{0: float, 1: float}> $coords
     */
    private static function polylineLengthMeters(array $coords): float
    {
        $sum = 0.0;
        for ($i = 1, $n = count($coords); $i < $n; $i++) {
            $sum += self::haversineM(
                $coords[$i - 1][0],
                $coords[$i - 1][1],
                $coords[$i][0],
                $coords[$i][1]
            );
        }

        return $sum;
    }

    /**
     * @param list<array{0: float, 1: float}> $coords
     */
    private static function partialLength(array $coords, int $from, int $to): float
    {
        if ($to <= $from) {
            return 0.0;
        }
        $sum = 0.0;
        for ($i = $from + 1; $i <= $to; $i++) {
            if (!isset($coords[$i], $coords[$i - 1])) {
                break;
            }
            $sum += self::haversineM(
                $coords[$i - 1][0],
                $coords[$i - 1][1],
                $coords[$i][0],
                $coords[$i][1]
            );
        }

        return $sum;
    }

    private static function haversineM(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $earth = 6371000.0;
        $p1 = deg2rad($lat1);
        $p2 = deg2rad($lat2);
        $dphi = deg2rad($lat2 - $lat1);
        $dlambda = deg2rad($lon2 - $lon1);
        $a = sin($dphi / 2) ** 2 + cos($p1) * cos($p2) * sin($dlambda / 2) ** 2;

        return 2 * $earth * atan2(sqrt($a), sqrt(1 - $a));
    }

    private static function isStrongNature(string $cls): bool
    {
        return in_array(
            $cls,
            ['TRACK', 'PATH', 'BRIDLEWAY', 'FOOTWAY', 'PEDESTRIAN', 'STEPS', 'CYCLEWAY'],
            true
        );
    }

    private static function isStrongAsphalt(string $cls): bool
    {
        return in_array(
            $cls,
            ['MOTORWAY', 'TRUNK', 'PRIMARY', 'SECONDARY', 'TERTIARY', 'RESIDENTIAL', 'LIVING_STREET', 'ROAD'],
            true
        );
    }
}
