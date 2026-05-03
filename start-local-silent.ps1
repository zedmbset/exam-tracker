$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerDir = Join-Path $root "workers\telegram"
$localDir = Join-Path $root ".local"
$logDir = Join-Path $localDir "logs"
$pidDir = Join-Path $localDir "pids"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $pidDir | Out-Null

$serverOut = Join-Path $logDir "server.out.log"
$serverErr = Join-Path $logDir "server.err.log"
$workerOut = Join-Path $logDir "worker.out.log"
$workerErr = Join-Path $logDir "worker.err.log"

$serverPidFile = Join-Path $pidDir "server.pid"
$workerPidFile = Join-Path $pidDir "worker.pid"
$startupMutex = New-Object System.Threading.Mutex($false, "Local\ExamTrackerStartLocalSilent")
$mutexAcquired = $false

function Get-ListeningProcessId {
    param(
        [int]$Port
    )

    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($connection) {
        return $connection.OwningProcess
    }

    return $null
}

function Test-TrackedProcess {
    param(
        [string]$PidFile
    )

    if (-not (Test-Path -LiteralPath $PidFile)) {
        return $null
    }

    $pidValue = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if (-not $pidValue) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        return $null
    }

    $process = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
    if (-not $process) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        return $null
    }

    return $process
}

function Get-ProcessLabel {
    param(
        [int]$ProcessId
    )

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
        return $process.ProcessName
    }

    return "unknown"
}

try {
    if (-not $startupMutex.WaitOne(15000)) {
        throw "Another Exam Tracker startup is already in progress. Wait a few seconds and try again."
    }
    $mutexAcquired = $true

    $trackedServer = Test-TrackedProcess -PidFile $serverPidFile
    $trackedWorker = Test-TrackedProcess -PidFile $workerPidFile

    $serverPortOwner = Get-ListeningProcessId -Port 5000
    $workerPortOwner = Get-ListeningProcessId -Port 8000

    $reuseServer = $false
    $reuseWorker = $false

    if ($serverPortOwner) {
        if ($trackedServer -and $trackedServer.Id -eq $serverPortOwner) {
            $reuseServer = $true
        } else {
            throw "Port 5000 is already in use by PID $serverPortOwner ($(Get-ProcessLabel -ProcessId $serverPortOwner)). Stop it first or use stop-local-silent.ps1 if it belongs to this app."
        }
    }

    if ($workerPortOwner) {
        if ($trackedWorker -and $trackedWorker.Id -eq $workerPortOwner) {
            $reuseWorker = $true
        } else {
            throw "Port 8000 is already in use by PID $workerPortOwner ($(Get-ProcessLabel -ProcessId $workerPortOwner)). Stop it first or use stop-local-silent.ps1 if it belongs to this app."
        }
    }

    if ($reuseWorker) {
        $workerProcess = $trackedWorker
    } else {
        $workerProcess = Start-Process -FilePath "python" `
            -ArgumentList "worker.py" `
            -WorkingDirectory $workerDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $workerOut `
            -RedirectStandardError $workerErr `
            -PassThru
        Set-Content -LiteralPath $workerPidFile -Value $workerProcess.Id
    }

    if ($reuseServer) {
        $serverProcess = $trackedServer
    } else {
        $serverProcess = Start-Process -FilePath "node" `
            -ArgumentList "server.js" `
            -WorkingDirectory $root `
            -WindowStyle Hidden `
            -RedirectStandardOutput $serverOut `
            -RedirectStandardError $serverErr `
            -PassThru
        Set-Content -LiteralPath $serverPidFile -Value $serverProcess.Id
    }

    Start-Sleep -Seconds 4

    $serverPortOwner = Get-ListeningProcessId -Port 5000
    $workerPortOwner = Get-ListeningProcessId -Port 8000

    if (-not $serverPortOwner) {
        throw "Exam Tracker server did not bind to port 5000. Check $serverErr"
    }

    if (-not $workerPortOwner) {
        throw "Telegram worker did not bind to port 8000. Check $workerErr"
    }

    Start-Process "http://localhost:5000/telegram"

    Write-Host "Exam Tracker started silently."
    Write-Host "Server PID: $($serverProcess.Id)$(if ($reuseServer) { ' (reused)' })"
    Write-Host "Worker PID: $($workerProcess.Id)$(if ($reuseWorker) { ' (reused)' })"
    Write-Host "Logs:"
    Write-Host "  $serverOut"
    Write-Host "  $serverErr"
    Write-Host "  $workerOut"
    Write-Host "  $workerErr"
}
finally {
    if ($mutexAcquired) {
        $startupMutex.ReleaseMutex() | Out-Null
    }
    $startupMutex.Dispose()
}
