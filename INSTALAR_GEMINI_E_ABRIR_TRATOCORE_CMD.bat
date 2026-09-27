@echo off
setlocal EnableExtensions
title TratoCore - Gemini + Browser Engine
cd /d "C:\TratoCore"

if not exist package.json (
  echo ERRO: C:\TratoCore nao encontrado.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js nao encontrado no PATH.
  pause
  exit /b 1
)

call npm install --no-audit --no-fund
if errorlevel 1 (
  echo ERRO: npm install falhou.
  pause
  exit /b 1
)

if not exist .env (
  echo.
  echo ATENCAO: C:\TratoCore\.env nao existe.
  echo Execute C:\TratoCore\CONFIGURAR_GEMINI.bat antes de analisar produtos.
  echo.
)

start "TRATOCORE SERVER" cmd /k "cd /d C:\TratoCore && npm start"
timeout /t 3 /nobreak >nul
start "" http://localhost:3000

echo.
echo TratoCore iniciado em http://localhost:3000
echo.
pause
endlocal
