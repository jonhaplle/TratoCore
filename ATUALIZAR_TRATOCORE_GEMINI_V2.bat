@echo off
setlocal EnableExtensions DisableDelayedExpansion
title TratoCore - Atualizar Gemini V2
cd /d "%~dp0"

echo ============================================================
echo       TRATOCORE - ATUALIZAR PARA GEMINI V2
echo ============================================================
echo.

echo [1/6] Encerrando apenas o processo que usa a porta 3000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /PID %%P /F >nul 2>nul
)

echo [2/6] Copiando arquivos para C:\TratoCore...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0copy_tratocore.ps1"
if errorlevel 1 (
  echo.
  echo ERRO: a copia falhou.
  echo Execute este arquivo como ADMINISTRADOR.
  pause
  exit /b 1
)

echo [3/6] Verificando arquivos essenciais...
if not exist "C:\TratoCore\package.json" (echo ERRO: package.json nao foi copiado.&pause&exit /b 2)
if not exist "C:\TratoCore\teste_gemini.js" (echo ERRO: teste_gemini.js nao foi copiado.&pause&exit /b 3)
if not exist "C:\TratoCore\corrigir_gemini_config.js" (echo ERRO: corrigir_gemini_config.js nao foi copiado.&pause&exit /b 4)

echo [4/6] Instalando/verificando dependencias...
cd /d C:\TratoCore
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo ERRO: npm install falhou.
  pause
  exit /b 5
)

echo [5/6] Validando configuracao e API do Gemini...
node C:\TratoCore\corrigir_gemini_config.js
if errorlevel 1 (
  echo.
  echo ERRO: GEMINI_API_KEY nao esta configurada em C:\TratoCore\.env
  echo Execute C:\TratoCore\CONFIGURAR_GEMINI.bat
  pause
  exit /b 6
)
call C:\TratoCore\TESTAR_GEMINI.bat
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo Gemini nao passou no teste. O TratoCore NAO sera iniciado.
  pause
  exit /b %RC%
)

echo [6/6] Iniciando TratoCore...
start "TRATOCORE - GEMINI" cmd /k "cd /d C:\TratoCore && npm start"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false;for($i=0;$i-lt40;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:3000/api -TimeoutSec 2;if($r.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Seconds 1};if(-not $ok){exit 1}"
if errorlevel 1 (
  echo ERRO: TratoCore nao respondeu em localhost:3000.
  echo Verifique a janela CMD do servidor.
  pause
  exit /b 7
)
start "" "http://localhost:3000"
echo.
echo ============================================================
echo TRATOCORE ATUALIZADO E GEMINI VALIDADO COM SUCESSO
echo ============================================================
pause
endlocal
