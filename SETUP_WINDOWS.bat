@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo CampusSync - Windows dependency setup
echo ============================================
where node >nul 2>nul || (echo ERROR: Install Node.js 22 LTS or newer from https://nodejs.org/ & pause & exit /b 1)
where npm >nul 2>nul || (echo ERROR: npm was not found. Reinstall Node.js. & pause & exit /b 1)
node -v
echo Installing frontend dependencies. This requires an internet connection on first run.
call npm install
if errorlevel 1 (echo ERROR: Frontend dependency installation failed. Check your internet/proxy and try again. & pause & exit /b 1)
echo Installing backend dependencies.
call npm run api:install
if errorlevel 1 (echo ERROR: Backend dependency installation failed. & pause & exit /b 1)
if not exist server\.env copy server\.env.example server\.env >nul
if not exist .env copy .env.example .env >nul
echo.
echo Dependencies installed. Next:
echo 1. Install and start PostgreSQL 14 or newer.
echo 2. Edit server\.env and set DATABASE_URL and a private JWT_SECRET (32+ characters).
echo 3. Run npm run api:migrate then npm run api:seed.
echo 4. Edit .env and set VITE_API_URL=http://localhost:4000.
echo 5. Double-click START_CAMPUSSYNC.bat.
echo See PROJECT_SETUP.md for details.
pause
