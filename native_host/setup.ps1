# WhisperLiveKit Native Messaging Host Setup
# Run once after loading the extension in Chrome.
#
# Usage (from repo root OR from native_host/):
#   powershell -ExecutionPolicy Bypass -File native_host\setup.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== WhisperLiveKit Setup ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Find Python + wlk
# ---------------------------------------------------------------------------
$pythonExe = (Get-Command python -ErrorAction SilentlyContinue)?.Source
if (-not $pythonExe) {
    # Try .venv relative to repo root
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) {
        $pythonExe = $venvPython
    } else {
        Write-Host "Error: python not found. Activate your venv or add Python to PATH." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Python: $pythonExe" -ForegroundColor Gray

# Derive wlk.exe from the same Scripts directory as python.exe
$scriptsDir = Split-Path -Parent $pythonExe
$wlkExe = Join-Path $scriptsDir "wlk.exe"
if (-not (Test-Path $wlkExe)) {
    Write-Host "Error: wlk.exe not found at $wlkExe" -ForegroundColor Red
    Write-Host "Make sure WhisperLiveKit is installed in the active environment:" -ForegroundColor Yellow
    Write-Host "  pip install -e ." -ForegroundColor Yellow
    exit 1
}
Write-Host "wlk:    $wlkExe" -ForegroundColor Gray

# ---------------------------------------------------------------------------
# 2. Write host.bat with hardcoded Python path (so Chrome can find it)
# ---------------------------------------------------------------------------
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostPy    = Join-Path $scriptDir "host.py"
$hostBat   = Join-Path $scriptDir "host.bat"

@"
@echo off
"$pythonExe" "$hostPy"
"@ | Set-Content -Path $hostBat -Encoding ASCII
Write-Host "host.bat written: $hostBat" -ForegroundColor Gray

# ---------------------------------------------------------------------------
# 3. Inject wlk path into host.py via environment variable in host.bat
#    (host.py reads WLK_EXE env var; falls back to 'wlk' if not set)
# ---------------------------------------------------------------------------
@"
@echo off
set WLK_EXE=$wlkExe
"$pythonExe" "$hostPy"
"@ | Set-Content -Path $hostBat -Encoding ASCII
Write-Host "host.bat updated with WLK_EXE path" -ForegroundColor Gray

# ---------------------------------------------------------------------------
# 4. Prompt for extension ID
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Step: Find your extension ID" -ForegroundColor Cyan
Write-Host "  1. Open Chrome → chrome://extensions"
Write-Host "  2. Enable 'Developer mode' (top-right toggle)"
Write-Host "  3. Find 'WhisperLiveKit Tab Capture' and copy the ID (32 chars)"
Write-Host ""
$extId = Read-Host "Paste extension ID"
$extId = $extId.Trim()

if ($extId.Length -ne 32) {
    Write-Host "Warning: expected 32 characters, got $($extId.Length). Continuing anyway..." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 5. Write NM manifest
# ---------------------------------------------------------------------------
$manifestPath = Join-Path $scriptDir "com.whisperlivekit.host.json"
$manifest = [ordered]@{
    name            = "com.whisperlivekit.host"
    description     = "WhisperLiveKit process manager"
    path            = $hostBat
    type            = "stdio"
    allowed_origins = @("chrome-extension://$extId/")
} | ConvertTo-Json -Depth 3

Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8
Write-Host "Manifest: $manifestPath" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 6. Write registry key
# ---------------------------------------------------------------------------
$regKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.whisperlivekit.host"
New-Item -Path $regKey -Force | Out-Null
Set-ItemProperty -Path $regKey -Name "(Default)" -Value $manifestPath
Write-Host "Registry: $regKey" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 7. Create transcripts folder
# ---------------------------------------------------------------------------
$transcriptsDir = "C:\MeetingTranscripts"
if (-not (Test-Path $transcriptsDir)) {
    New-Item -ItemType Directory -Path $transcriptsDir | Out-Null
    Write-Host "Created: $transcriptsDir" -ForegroundColor Green
} else {
    Write-Host "Exists:  $transcriptsDir" -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Click the WhisperLiveKit icon in Chrome to start a session." -ForegroundColor Cyan
Write-Host "Transcripts save to: $transcriptsDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Re-run this script if you reinstall the extension (new ID)." -ForegroundColor Gray
