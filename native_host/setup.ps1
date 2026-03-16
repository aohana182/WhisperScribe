# Whisper Local Tool — Native Messaging Host Setup
# Run once after loading the extension in Chrome.
#
# Usage (from repo root OR from native_host/):
#   powershell -ExecutionPolicy Bypass -File native_host\setup.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Whisper Local Tool Setup ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Find Python
# ---------------------------------------------------------------------------
$pythonExe = (Get-Command python -ErrorAction SilentlyContinue)?.Source
if (-not $pythonExe) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) {
        $pythonExe = $venvPython
    } else {
        Write-Host "Error: python not found. Add Python to PATH or activate your venv." -ForegroundColor Red
        exit 1
    }
}
Write-Host "Python: $pythonExe" -ForegroundColor Gray

# ---------------------------------------------------------------------------
# 2. Verify server.py exists at repo root
# ---------------------------------------------------------------------------
$repoRoot = Split-Path -Parent $PSScriptRoot
$serverPy = Join-Path $repoRoot "server.py"
if (-not (Test-Path $serverPy)) {
    Write-Host "Error: server.py not found at $serverPy" -ForegroundColor Red
    exit 1
}
Write-Host "Server: $serverPy" -ForegroundColor Gray

# ---------------------------------------------------------------------------
# 3. Write host.bat (Chrome NM requires an executable, not a .py file)
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
# 4. Prompt for extension ID
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Step: Find your extension ID" -ForegroundColor Cyan
Write-Host "  1. Open Chrome -> chrome://extensions"
Write-Host "  2. Enable 'Developer mode' (top-right toggle)"
Write-Host "  3. Find 'Whisper Local Tool' and copy the ID (32 chars)"
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
    description     = "Whisper Local Tool process manager"
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
Write-Host "Click the Whisper Local Tool icon in Chrome to start a session." -ForegroundColor Cyan
Write-Host "Transcripts save to: $transcriptsDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Re-run this script if you reinstall the extension (new ID)." -ForegroundColor Gray
