<?php

declare(strict_types=1);

$local = __DIR__ . '/config.local.php';
if (is_readable($local)) {
    /** @var array<string, mixed> */
    return require $local;
}

/** @var array<string, mixed> */
return require __DIR__ . '/config.example.php';
