@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org e tente de novo.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause
