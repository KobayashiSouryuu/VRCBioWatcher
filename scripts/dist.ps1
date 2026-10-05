# ============================================================================
# Build the Windows installer / portable exe.
#
# WHY THIS SCRIPT INSTEAD OF PLAIN `electron-builder`:
#
#   electron-builder downloads two big toolchains on first run:
#     - winCodeSign   (exe metadata / icon editing)
#     - nsis          (the installer compiler)
#   By default both go to %LOCALAPPDATA%\electron-builder\Cache, which is
#   OUTSIDE the session workspace -- DSH's file sandbox rejects those writes
#   with EPERM, and the error looks like a network or antivirus problem.
#   Pointing ELECTRON_BUILDER_CACHE into the project (see .gitignore) fixes it.
#
#   Same reason as scripts/install-deps.ps1. See docs/DECISIONS.md 5.4.
#
# USAGE:
#   powershell -ExecutionPolicy Bypass -File scripts\dist.ps1          # installer + portable
#   powershell -ExecutionPolicy Bypass -File scripts\dist.ps1 dir      # unpacked folder only
#
# NOTE: keep this file ASCII-only (PowerShell 5.1 reads .ps1 as GBK).
# ============================================================================

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:electron_config_cache  = Join-Path $root '.electron-cache'
$env:ELECTRON_CACHE         = Join-Path $root '.electron-cache'
$env:ELECTRON_BUILDER_CACHE = Join-Path $root '.electron-builder-cache'

# electron-builder still has to fetch two toolchains (winCodeSign, nsis) from
# GitHub releases, and github.com is unreachable on some networks (including
# the one this project was developed on). The npmmirror mirror hosts the exact
# same files. Override by setting ELECTRON_BUILDER_BINARIES_MIRROR yourself.
#
# The Electron binary itself is NOT downloaded: electron-builder.yml points
# electronDist at node_modules/electron/dist.
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
    $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}

# NSIS (makensis) uses the TEMP directory for the compile-time state of its
# !tempfile directives. In a sandboxed shell TEMP can point at a per-invocation
# directory that makensis is not allowed to write, and the build dies with:
#     !tempfile: Unable to create temporary file!
#   Pointing TMP/TEMP at a project-local folder (already in .gitignore) removes
#   that dependency. Harmless for ordinary builds too -- it just keeps build
#   scratch files inside the project.
$tmp = Join-Path $root '.tmp'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$env:TMP = $tmp
$env:TEMP = $tmp

$mode = if ($args.Count -gt 0) { $args[0] } else { 'dist' }

Write-Host "project root              : $root"
Write-Host "electron-builder cache    : $env:ELECTRON_BUILDER_CACHE"
Write-Host "binaries mirror           : $env:ELECTRON_BUILDER_BINARIES_MIRROR"
Write-Host "build temp dir            : $env:TEMP"
Write-Host "mode                      : $mode"
Write-Host ""

Write-Host "---- 1/2  typecheck + build --------------------------------"
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "build FAILED (exit $LASTEXITCODE) -- nothing was packaged."
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "---- 2/2  package ------------------------------------------"
if ($mode -eq 'dir') {
    # Unpacked only: fastest, no NSIS download. Gives release\win-unpacked\.
    npx electron-builder --win --dir
} else {
    npx electron-builder --win
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "packaging FAILED (exit $LASTEXITCODE)"
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "---- artifacts ---------------------------------------------"
$release = Join-Path $root 'release'
if (Test-Path $release) {
    Get-ChildItem $release -File | ForEach-Object {
        $mb = [math]::Round($_.Length / 1MB, 1)
        Write-Host ("  {0,8} MB  {1}" -f $mb, $_.Name)
    }
    $unpacked = Join-Path $release 'win-unpacked'
    if (Test-Path $unpacked) {
        Write-Host ""
        Write-Host "  unpacked folder: release\win-unpacked  (run the .exe straight from there)"
    }
}
