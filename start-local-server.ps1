$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Starting Exam Tracker server only on http://localhost:5000 ..." -ForegroundColor Green
node server.js
