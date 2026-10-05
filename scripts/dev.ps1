# ============================================================================
# Development launcher.
#
# WHY THIS SCRIPT EXISTS
#
#   DSH hardens the session workspace directory: it injects a sandbox ACE
#   (a `S-1-4-*` entry) that a plain directory never has.  Inside such a
#   directory Chromium cannot create its renderer child process, so Electron
#   dies with:
#
#       render-process-gone: reason=launch-failed  exitCode=18
#
#   ...and no window ever appears.  Proven by an A/B test on this machine:
#   the very same app and the very same launch procedure work when the
#   Electron *executable* lives outside the workspace, and fail inside it.
#   See docs/DECISIONS.md 5.12.
#
# THE WORKAROUND
#
#   Keep the source code inside the workspace (where it can be edited), but
#   run Electron from a clean copy of its runtime outside the workspace.
#   electron-vite honours the ELECTRON_EXEC_PATH environment variable for
#   exactly this (node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:142).
#
# HOW IT DECIDES
#
#   - workspace carries a DSH sandbox ACE  -> use the clean runtime copy
#   - workspace looks normal              -> plain `npm run dev`
#
#   So on an ordinary machine this script does exactly what `npm run dev`
#   does, and the workaround stays invisible.  Use -ForceCleanRuntime to
#   force the workaround, or -Plain to force the plain path.
#
# USAGE
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 -ForceCleanRuntime
#
# NOTE: keep this file ASCII-only.  Windows PowerShell 5.1 decodes .ps1 files
#       as GBK unless they carry a UTF-8 BOM, and mangled non-ASCII text can
#       silently swallow following statements (this already happened once).
# ============================================================================

param(
    [switch]$ForceCleanRuntime,
    [switch]$Plain
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# The clean runtime lives in the per-user app data directory, never in C:\ root.
$runtimeDir = Join-Path $env:LOCALAPPDATA 'vrcbw-runtime\electron'
$runtimeExe = Join-Path $runtimeDir 'dist\electron.exe'
$sourceDist = Join-Path $root 'node_modules\electron\dist'

function Test-DshHardenedWorkspace {
    # Heuristic: DSH injects an ACE for an unresolvable S-1-4-* identity into
    # the workspace root.  A plain directory never has one.
    try {
        $aclText = (icacls $root 2>&1 | Out-String)
        return ($aclText -match 'S-1-4-')
    } catch {
        return $false
    }
}

function Invoke-PlainDev {
    Write-Host "==> running plain 'npm run dev'"
    npm run dev
    exit $LASTEXITCODE
}

if ($Plain) { Invoke-PlainDev }

$useCleanRuntime = $ForceCleanRuntime -or (Test-DshHardenedWorkspace)
if (-not $useCleanRuntime) { Invoke-PlainDev }

Write-Host "==> workspace is DSH-hardened; Electron will run from a clean copy outside it"
Write-Host "    code stays here : $root"
Write-Host "    electron binary : $runtimeExe"
Write-Host ""

if (-not (Test-Path $runtimeExe)) {
    if (-not (Test-Path $sourceDist)) {
        throw "Electron runtime not found at $sourceDist. Run scripts\install-deps.ps1 first."
    }
    Write-Host "    first run: copying the Electron runtime (~240 MB), please wait..."
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    Copy-Item $sourceDist (Join-Path $runtimeDir 'dist') -Recurse -Force
    if (-not (Test-Path $runtimeExe)) {
        throw "copy failed; $runtimeExe is still missing"
    }
    Write-Host "    copy finished"
    Write-Host ""
}

$env:ELECTRON_EXEC_PATH = $runtimeExe
Write-Host "    ELECTRON_EXEC_PATH = $env:ELECTRON_EXEC_PATH"
Write-Host ""
Write-Host "==> running 'npm run dev'"

npm run dev
exit $LASTEXITCODE
