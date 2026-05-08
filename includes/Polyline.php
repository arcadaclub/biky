<?php

declare(strict_types=1);

/**
 * Decodiert Google-kompatible Polyline (Precision 5, optional 3. Dimension Höhe in m).
 */
final class Polyline
{
    /**
     * @return list<array{0: float, 1: float, 2?: float}>
     */
    public static function decode(string $encoded, bool $includeElevation = false): array
    {
        $coordinates = [];
        $len = strlen($encoded);
        $index = 0;
        $lat = 0;
        $lng = 0;
        $ele = 0;

        while ($index < $len) {
            $result = 0;
            $shift = 0;
            do {
                if ($index >= $len) {
                    break 2;
                }
                $b = ord($encoded[$index++]) - 63;
                $result |= ($b & 0x1f) << $shift;
                $shift += 5;
            } while ($b >= 0x20);
            $deltaLat = ($result & 1) ? ~($result >> 1) : ($result >> 1);
            $lat += $deltaLat;

            $result = 0;
            $shift = 0;
            do {
                if ($index >= $len) {
                    break 2;
                }
                $b = ord($encoded[$index++]) - 63;
                $result |= ($b & 0x1f) << $shift;
                $shift += 5;
            } while ($b >= 0x20);
            $deltaLng = ($result & 1) ? ~($result >> 1) : ($result >> 1);
            $lng += $deltaLng;

            $latF = $lat / 1e5;
            $lngF = $lng / 1e5;

            if ($includeElevation) {
                $result = 0;
                $shift = 0;
                do {
                    if ($index >= $len) {
                        break 2;
                    }
                    $b = ord($encoded[$index++]) - 63;
                    $result |= ($b & 0x1f) << $shift;
                    $shift += 5;
                } while ($b >= 0x20);
                $deltaEle = ($result & 1) ? ~($result >> 1) : ($result >> 1);
                $ele += $deltaEle;
                $coordinates[] = [$latF, $lngF, $ele / 100.0];
            } else {
                $coordinates[] = [$latF, $lngF];
            }
        }

        return $coordinates;
    }
}
