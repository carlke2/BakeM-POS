# Start ZKTeco scanner service for SmartPOS (local PC with USB device)
$env:FINGERPRINT_CORS_ORIGIN = "http://localhost:5173,http://localhost:5174,https://betterfork.millenium.co.ke"
Write-Host "Starting fingerprint scanner (CORS includes betterfork.millenium.co.ke)..." -ForegroundColor Cyan
dotnet run
