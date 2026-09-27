@echo off
setlocal EnableExtensions
cd /d C:\TratoCore
title TratoCore - Teste Gemini
node C:\TratoCore\teste_gemini.js
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo TESTE GEMINI FALHOU. Codigo: %RC%
) else (
  echo TESTE GEMINI CONCLUIDO COM SUCESSO.
)
pause
exit /b %RC%
