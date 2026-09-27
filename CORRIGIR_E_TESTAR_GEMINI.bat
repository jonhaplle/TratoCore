@echo off
setlocal EnableExtensions
cd /d C:\TratoCore
title TratoCore - Corrigir e Testar Gemini

echo ==============================================
echo   CORRIGIR E TESTAR GEMINI - TRATOCORE
echo ==============================================
echo.

if not exist "C:\TratoCore\.env" (
  echo ERRO: C:\TratoCore\.env nao existe.
  echo Execute CONFIGURAR_GEMINI.bat primeiro.
  pause
  exit /b 1
)

node C:\TratoCore\corrigir_gemini_config.js
if errorlevel 1 (
  echo ERRO ao corrigir a configuracao do Gemini.
  pause
  exit /b 1
)

echo.
call C:\TratoCore\TESTAR_GEMINI.bat
exit /b %ERRORLEVEL%
