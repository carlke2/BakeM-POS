# SmartPOS — start all local services (Windows PowerShell)
# Usage: .\scripts\start-local.ps1

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "SmartPOS local stack" -ForegroundColor Cyan
Write-Host ""

function Start-ServiceWindow {
    param([string]$Title, [string]$Dir, [string]$Command)
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "cd '$Dir'; Write-Host '$Title' -ForegroundColor Green; $Command"
    )
}

# Backend
Start-ServiceWindow "SmartPOS Backend :5000" "$Root\backend" "npm run dev"

Start-Sleep -Seconds 2

# Frontend
Start-ServiceWindow "SmartPOS Frontend :5173" "$Root\frontend" "npm run dev"

Start-Sleep -Seconds 1

# Fingerprint scanner (skip if already running)
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:17890/health" -TimeoutSec 2
    if ($health.deviceConnected) {
        Write-Host "Fingerprint scanner already running ($($health.deviceCount) device(s))" -ForegroundColor Green
    } else {
        Start-ServiceWindow "Fingerprint Scanner :17890" "$Root\FingerprintScanner" "dotnet run"
    }
} catch {
    Start-ServiceWindow "Fingerprint Scanner :17890" "$Root\FingerprintScanner" "dotnet run"
}

Write-Host ""
Write-Host "Opened 2-3 terminals. Open http://localhost:5173 on this PC." -ForegroundColor Yellow
Write-Host "Health checks:" -ForegroundColor Gray
Write-Host "  Backend:  http://localhost:5000/health"
Write-Host "  Scanner:  http://127.0.0.1:17890/health"
