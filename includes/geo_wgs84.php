<?php

declare(strict_types=1);

/**
 * Zielpunkt auf der Kugel (mittlerer Erdradius), für Entfernungen bis ca. 150 km ausreichend.
 * Bearing: Grad, Uhrzeigersinn von Norden (0° = Nord, 90° = Ost).
 *
 * @return array{0: float, 1: float} Breite, Länge in Grad (WGS84)
 */
function nr_geo_destination_sphere_m(float $latDeg, float $lonDeg, float $distanceM, float $bearingDeg): array
{
    $earthR = 6371000.0;
    $phi1 = deg2rad($latDeg);
    $lam1 = deg2rad($lonDeg);
    $theta = deg2rad($bearingDeg);
    $delta = $distanceM / $earthR;
    $sinPhi1 = sin($phi1);
    $cosPhi1 = cos($phi1);
    $sinDelta = sin($delta);
    $cosDelta = cos($delta);
    $sinPhi2 = $sinPhi1 * $cosDelta + $cosPhi1 * $sinDelta * cos($theta);
    $sinPhi2 = min(1.0, max(-1.0, $sinPhi2));
    $phi2 = asin($sinPhi2);
    $lam2 = $lam1 + atan2(sin($theta) * $sinDelta * $cosPhi1, $cosDelta - $sinPhi1 * $sinPhi2);
    $lon2Deg = rad2deg($lam2);
    if ($lon2Deg > 180.0) {
        $lon2Deg -= 360.0;
    } elseif ($lon2Deg < -180.0) {
        $lon2Deg += 360.0;
    }

    return [rad2deg($phi2), $lon2Deg];
}
