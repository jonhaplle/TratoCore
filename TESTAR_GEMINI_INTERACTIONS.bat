@echo off
setlocal
cd /d C:\TratoCore
if not exist "teste_gemini_interactions.js" (
  echo ERRO: teste_gemini_interactions.js nao encontrado.
  pause
  exit /b 1
)
echo ====================================
echo   TRATOCORE - TESTE GEMINI INTERACTIONS
echo ====================================
echo.
node teste_gemini_interactions.js
pause
