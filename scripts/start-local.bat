@echo off
REM SmartPOS local stack — run each service in its own terminal, or use start-local.ps1
echo SmartPOS local setup
echo.
echo 1. Backend:    cd backend ^&^& npm run dev          (http://localhost:5000)
echo 2. Frontend:   cd frontend ^&^& npm run dev         (http://localhost:5173)
echo 3. Scanner:    cd FingerprintScanner ^&^& dotnet run (http://127.0.0.1:17890)
echo.
echo First-time only:
echo   cd backend ^&^& npm install ^&^& npx prisma db push ^&^& npm run db:seed
echo   cd frontend ^&^& npm install
echo.
echo Fingerprint: scanner must run on the same Windows PC as the USB device.
echo Open http://localhost:5173 in the browser on that PC.
