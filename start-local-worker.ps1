$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerDir = Join-Path $root "workers\telegram"
Set-Location $workerDir

Write-Host "Starting Telegram worker only on http://localhost:8000 ..." -ForegroundColor Green
python worker.py
