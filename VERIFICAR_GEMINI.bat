@echo off
setlocal
cd /d C:\TratoCore
title TratoCore - Verificar Gemini
echo ==============================================
echo      VERIFICACAO REAL DO GEMINI
echo ==============================================
echo.
if not exist "C:\TratoCore\.env" (
  echo ERRO: C:\TratoCore\.env nao existe.
  pause
  exit /b 1
)
findstr /B "GEMINI_API_KEY=" "C:\TratoCore\.env" >nul
if errorlevel 1 (
  echo ERRO: GEMINI_API_KEY nao encontrada no .env
  pause
  exit /b 2
)
if not exist "C:\TratoCore\teste_gemini.js" (
  echo ERRO: teste_gemini.js nao encontrado.
  pause
  exit /b 3
)
node "C:\TratoCore\teste_gemini.js"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo GEMINI OK.
) else (
  echo GEMINI FALHOU. Codigo: %RC%
)
pause
exit /b %RC%
