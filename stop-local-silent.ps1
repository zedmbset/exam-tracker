$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidDir = Join-Path (Join-Path $root ".local") "pids"

function Stop-TrackedProcess {
    param(
        [string]$Name,
        [string]$PidFile
    )

    if (-not (Test-Path -LiteralPath $PidFile)) {
        Write-Host "$Name is not tracked."
        return
    }

    $pidValue = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if (-not $pidValue) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        Write-Host "$Name PID file was empty."
        return
    }

    $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $process.Id -Force
        Write-Host "$Name stopped (PID $pidValue)."
    } else {
        Write-Host "$Name was already stopped."
    }

    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

Stop-TrackedProcess -Name "Telegram worker" -PidFile (Join-Path $pidDir "worker.pid")
Stop-TrackedProcess -Name "Exam Tracker server" -PidFile (Join-Path $pidDir "server.pid")
