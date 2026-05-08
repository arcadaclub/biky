<?php

declare(strict_types=1);

/**
 * Natur- vs. Straßenanteil aus ORS extras.surface.summary (Flächenanteile in %).
 * Surface-Codes siehe ORS-Dokumentation „Extra Info → surface“.
 */
final class OrsExtras
{
    /**
     * @return array{surface_nature: float, asphalt: float}
     */
    public static function natureAsphaltFromExtras(?array $extras): array
    {
        if ($extras === null || !isset($extras['surface']['summary']) || !is_array($extras['surface']['summary'])) {
            return ['surface_nature' => 50.0, 'asphalt' => 50.0];
        }

        $naturePct = 0.0;
        $asphaltPct = 0.0;
        $unknownPct = 0.0;

        foreach ($extras['surface']['summary'] as $row) {
            if (!is_array($row)) {
                continue;
            }
            $value = (int) ($row['value'] ?? -1);
            $amount = (float) ($row['amount'] ?? 0);
            if ($amount <= 0) {
                continue;
            }
            if (self::isAsphaltLike($value)) {
                $asphaltPct += $amount;
            } elseif (self::isNatureLike($value)) {
                $naturePct += $amount;
            } else {
                $unknownPct += $amount;
            }
        }

        if ($unknownPct > 0) {
            $naturePct += $unknownPct * 0.55;
            $asphaltPct += $unknownPct * 0.45;
        }

        $sum = $naturePct + $asphaltPct;
        if ($sum < 1) {
            return ['surface_nature' => 50.0, 'asphalt' => 50.0];
        }

        return [
            'surface_nature' => round(100.0 * $naturePct / $sum, 1),
            'asphalt' => round(100.0 * $asphaltPct / $sum, 1),
        ];
    }

    /**
     * Asphalt, Beton, klassische befestigte Oberflächen in Ortslage.
     */
    private static function isAsphaltLike(int $surfaceId): bool
    {
        // ORS surface extra: 1 paved, 3–6, 14 paving stones — feste befahrbare Decken
        return in_array($surfaceId, [1, 3, 4, 5, 6, 14], true);
    }

    /**
     * Unbefestigt, lose, Wald-/Feldwege etc.
     */
    private static function isNatureLike(int $surfaceId): bool
    {
        return in_array($surfaceId, [2, 9, 10, 11, 12, 13, 15, 16, 17, 18], true);
    }
}
