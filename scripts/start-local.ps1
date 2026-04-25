$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$workerDir = Join-Path $repoRoot "workers\telegram"
$rootEnv = Join-Path $repoRoot ".env"

Write-Host "Starting Exam Tracker locally..." -ForegroundColor Cyan

if (-not (Test-Path $rootEnv)) {
  Write-Warning "Root .env not found at $rootEnv"
} else {
  $workerUrlLine = Get-Content $rootEnv | Where-Object { $_ -match '^TELEGRAM_WORKER_URL=' } | Select-Object -First 1
  if ($workerUrlLine -and $workerUrlLine -notmatch '^TELEGRAM_WORKER_URL=http://localhost:8000/?$') {
    Write-Warning "Your root .env TELEGRAM_WORKER_URL is not localhost:8000."
    Write-Warning "Current value: $workerUrlLine"
  }
}

$workerConnection = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($workerConnection) {
  Write-Host "Worker already running on port 8000." -ForegroundColor Yellow
} else {
  $workerCommand = "Set-Location '$workerDir'; python worker.py"
  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $workerCommand
  )
  Write-Host "Opened a new PowerShell window for the Telegram worker." -ForegroundColor Green
}

$serverConnection = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($serverConnection) {
  Write-Host "Main app already running on port 5000." -ForegroundColor Yellow
  Write-Host "Open http://localhost:5000/telegram once the worker is ready." -ForegroundColor Cyan
  exit 0
}

Write-Host "Starting Node server in this window..." -ForegroundColor Green
Set-Location $repoRoot
node server.js
