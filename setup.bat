@echo off
setlocal
cd /d "%~dp0"
echo Luspa Barbershop - Windows setup
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or later from https://nodejs.org
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example. Edit it and set ADMIN_PASSWORD_HASH and SESSION_SECRET.
) else (
  echo Existing .env found; leaving it unchanged.
)
echo Installing packages...
call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)
echo Setup complete. Edit .env, then run npm start.
pause
