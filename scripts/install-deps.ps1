# ============================================================================
# Install project dependencies (and verify the Electron binary is really there).
#
# WHY THIS SCRIPT EXISTS INSTEAD OF PLAIN `npm install`:
#
#   DSH's file sandbox blocks writes outside the session workspace, and blocks
#   child processes that capture output through piped stdio. Both break npm:
#
#     1) npm cache        -> %LOCALAPPDATA%\npm-cache  (redirected by .npmrc)
#     2) Electron binary  -> the env var name changed: electron/install.js now
#                            reads `electron_config_cache` (lowercase), NOT
#                            `ELECTRON_CACHE`. Getting this wrong makes the
#                            download fail with EPERM writing to
#                            %LOCALAPPDATA%\electron -- which looks like a
#                            permissions problem but is really a wrong var name.
#     3) postinstall runs -> npm captures script output via piped stdio, which
#                            the sandbox rejects with `spawn EPERM`.
#                            Worked around with --foreground-scripts. If a
#                            transitive script still pipes (esbuild does), this
#                            script must be run with wider sandbox permissions.
#
#   All of the above produce npm errors that say "EPERM" and look like an
#   antivirus / file-lock problem. They are not. See docs/DECISIONS.md 5.4.
#
# NOTE: keep this file ASCII-only.
#   Windows PowerShell 5.1 reads .ps1 files as GBK (ANSI) unless they have a
#   UTF-8 BOM. Non-ASCII characters get mangled, and a mangled quote can
#   silently swallow following statements. This already happened once: it made
#   an env var assignment disappear with no error at all.
#
# USAGE:
#   powershell -ExecutionPolicy Bypass -File scripts\install-deps.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-deps.ps1 ci
#   powershell -ExecutionPolicy Bypass -File scripts\install-deps.ps1 verify
# ============================================================================

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$cacheRoot = Join-Path $root '.electron-cache'

# `electron_config_cache` is the name electron/install.js actually reads.
# The uppercase ELECTRON_CACHE is kept for other tooling / older versions.
$env:electron_config_cache  = $cacheRoot
$env:ELECTRON_CACHE         = $cacheRoot
$env:ELECTRON_BUILDER_CACHE = Join-Path $root '.electron-builder-cache'

$mode = if ($args.Count -gt 0) { $args[0] } else { 'install' }

function Get-PkgVersion([string]$name) {
    $p = Join-Path $root "node_modules\$name\package.json"
    if (Test-Path $p) { return (Get-Content $p -Raw | ConvertFrom-Json).version }
    return $null
}

# The Electron npm package's postinstall downloads ~100MB. npm can silently skip
# it (for example after an earlier failed install), leaving every JS package in
# place but no electron.exe -- and then `npm run dev` fails with a confusing
# error. So we always verify, and repair by running the installer directly.
function Repair-ElectronBinary {
    $exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
    if (Test-Path $exe) { return $true }

    Write-Host ""
    Write-Host "electron.exe is MISSING -- running node_modules\electron\install.js ..."
    Write-Host "(cache target: $cacheRoot)"
    node node_modules/electron/install.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host "electron installer exited with code $LASTEXITCODE"
    }
    return (Test-Path $exe)
}

function Show-Report {
    Write-Host ""
    Write-Host "---- installed versions --------------------------------------"
    foreach ($p in @('electron', 'electron-vite', 'vite', 'react', 'react-dom',
                     'typescript', '@vitejs/plugin-react', '@types/node')) {
        $v = Get-PkgVersion $p
        if ($v) { Write-Host ("  {0,-24} {1}" -f $p, $v) }
        else    { Write-Host ("  {0,-24} MISSING" -f $p) }
    }

    $exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
    Write-Host ""
    if (Test-Path $exe) {
        $mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
        Write-Host "  electron.exe             present ($mb MB)"
        Write-Host ""
        Write-Host "---- electron --version --------------------------------------"
        & $exe --version
        Write-Host ""
        Write-Host "OK. next step: npm run dev"
    } else {
        Write-Host "  electron.exe             STILL MISSING"
        Write-Host ""
        Write-Host "The app cannot start without it. Likely causes:"
        Write-Host "  - no network access to github.com (electron binaries are hosted there)"
        Write-Host "  - the sandbox blocked the download; re-run this script with wider"
        Write-Host "    sandbox permissions."
    }
}

Write-Host "project root            : $root"
Write-Host "electron_config_cache   : $env:electron_config_cache"
Write-Host "npm cache               : $root\.npm-cache   (from .npmrc)"
Write-Host ""

switch ($mode) {
    'verify' {
        [void](Repair-ElectronBinary)
        Show-Report
    }
    'ci' {
        # --foreground-scripts: makes npm inherit stdio for lifecycle scripts
        # instead of capturing it through a pipe (which the sandbox rejects).
        npm ci --foreground-scripts --no-audit --no-fund
        [void](Repair-ElectronBinary)
        Show-Report
    }
    default {
        npm install --foreground-scripts --no-audit --no-fund
        [void](Repair-ElectronBinary)
        Show-Report
    }
}
