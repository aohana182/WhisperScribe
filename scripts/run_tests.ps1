#!/usr/bin/env pwsh
# run_tests.ps1 — unified test runner for WhisperLiveKit Chrome Extension
#
# Usage:
#   .\scripts\run_tests.ps1             # run all automated tests (L1-L3)
#   .\scripts\run_tests.ps1 -Layer L1   # run only L1 unit tests
#   .\scripts\run_tests.ps1 -Layer L2   # run only L2 integration tests
#   .\scripts\run_tests.ps1 -Layer L3   # run only L3 JS tests
#   .\scripts\run_tests.ps1 -All        # L1+L2+L3 + print L4-L6 checklists

param(
    [string]$Layer = "all",
    [switch]$All
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Venv = "$Root\.venv\Scripts\python.exe"
$ExtDir = "$Root\chrome-extension"

$failed = @()
$passed = @()

function Run-Step {
    param([string]$Name, [scriptblock]$Command)
    Write-Host ""
    Write-Host "=== $Name ===" -ForegroundColor Cyan
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
        $script:passed += $Name
        Write-Host "[PASS] $Name" -ForegroundColor Green
    } catch {
        $script:failed += $Name
        Write-Host "[FAIL] $Name — $_" -ForegroundColor Red
    }
}

# ---------------------------------------------------------------------------
# L1 + L2 — Python tests
# ---------------------------------------------------------------------------
if ($Layer -in @("all", "L1", "L2") -or $All) {
    Run-Step "L1 — Save endpoint unit tests (sanitize/filename)" {
        & $Venv -m pytest "$Root\tests\test_save_endpoint.py" -k "TestSanitizeTitle or TestMakeFilename" -v
    }
    Run-Step "L2 — Save endpoint integration tests (POST /save via httpx)" {
        & $Venv -m pytest "$Root\tests\test_save_endpoint.py" -k "TestSaveEndpoint" -v
    }
    Run-Step "L1+L2 — Native Messaging host tests" {
        & $Venv -m pytest "$Root\tests\test_native_host.py" -v
    }
}

# ---------------------------------------------------------------------------
# L3 — JS unit tests (Vitest)
# ---------------------------------------------------------------------------
if ($Layer -in @("all", "L3") -or $All) {
    Run-Step "L3 — JS unit tests (Vitest)" {
        Push-Location $ExtDir
        npm test
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
foreach ($s in $passed) { Write-Host "  PASS  $s" -ForegroundColor Green }
foreach ($s in $failed) { Write-Host "  FAIL  $s" -ForegroundColor Red }

if ($All -or $Layer -eq "all") {
    Write-Host ""
    Write-Host "=== L4-L6 Manual Checklist ===" -ForegroundColor Yellow
    Write-Host @"

L4 — System tests (run after: wlk server warm, extension loaded, setup.ps1 done)
  [ ] L4.1  YouTube tab: click icon → record 30s → stop → file in C:\MeetingTranscripts\
  [ ] L4.2  Muted tab + mic only: speak 3 sentences → verify transcript
  [ ] L4.3  Dual stream: YouTube + mic → both voices in transcript
  [ ] L4.4  Second session: close window, reopen → health check passes immediately
  [ ] L4.5  Force-close window during recording → backup in chrome.storage.local
  [ ] L4.6  Kill wlk mid-session → error message + backup readable

L5 — WebRTC capture (platform gate — must pass before ship)
  [ ] L5.1  Chrome-to-Chrome WebRTC call (two tabs) → tab audio captured
  [ ] L5.2  Google Meet solo call → both mic + tab in transcript
  [ ] L5.3  Yandex Telemost → transcript saved correctly
  [ ] L5.4  Zoom Web → tab audio captured

L6 — UAT
  [ ] L6.1  30-min Telemost call → file correct, both voices, timestamp in filename
  [ ] L6.2  Fresh Chrome profile: setup.ps1 + install → first session works
  [ ] L6.3  90-min session → no memory leak, backup fires, file saves

"@
}

if ($failed.Count -gt 0) {
    Write-Host "$($failed.Count) step(s) failed." -ForegroundColor Red
    exit 1
} else {
    Write-Host "All automated tests passed." -ForegroundColor Green
}
