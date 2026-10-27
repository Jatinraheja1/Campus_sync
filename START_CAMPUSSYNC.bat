@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (echo Run SETUP_WINDOWS.bat first.& pause & exit /b 1)
if not exist server\node_modules (echo Backend dependencies missing. Run SETUP_WINDOWS.bat first.& pause & exit /b 1)
if not exist server\.env (echo Missing server\.env. Run SETUP_WINDOWS.bat and configure it.& pause & exit /b 1)
if not exist .env (echo Missing root .env. Run SETUP_WINDOWS.bat first.& pause & exit /b 1)
start "CampusSync API" cmd /k "cd /d ""%~dp0"" && npm run api:dev"
timeout /t 2 /nobreak >nul
start "CampusSync Frontend" cmd /k "cd /d ""%~dp0"" && npm run dev"
timeout /t 3 /nobreak >nul
start "" http://localhost:5173
echo CampusSync startup commands launched. If the API reports a database error, check PostgreSQL and server\.env.
