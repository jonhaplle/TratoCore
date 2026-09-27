@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title TratoCore - Atualizar Gemini

echo ============================================================
echo      TRATOCORE - ATUALIZAR PARA GEMINI
 echo ============================================================
echo.

echo [1/6] Parando o processo que usa a porta 3000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo PID %%P encontrado. Encerrando...
    taskkill /PID %%P /F >nul 2>nul
)

echo [2/6] Copiando arquivos para C:\TratoCore...
if not exist "C:\TratoCore" mkdir "C:\TratoCore"
robocopy "%~dp0" "C:\TratoCore" /E /R:2 /W:1 /XF ".env" "*.zip" /XD ".git" "node_modules" "storage" "backups" >nul
if errorlevel 8 (
    echo ERRO: falha ao copiar os arquivos.
    pause
    exit /b 1
)

echo [3/6] Corrigindo configuracao do Gemini...
if not exist "C:\TratoCore\corrigir_gemini_config.js" (
    echo ERRO: arquivo de configuracao nao encontrado.
    pause
    exit /b 1
)
node C:\TratoCore\corrigir_gemini_config.js
if errorlevel 1 (
    echo ERRO: GEMINI_API_KEY ausente ou configuracao invalida.
    echo Execute C:\TratoCore\CONFIGURAR_GEMINI.bat
    pause
    exit /b 1
)

echo [4/6] Instalando/verificando dependencias...
cd /d C:\TratoCore
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo ERRO no npm install.
    pause
    exit /b 1
)

node --check api/services/local-ai.service.js
if errorlevel 1 (
    echo ERRO de sintaxe no servico Gemini.
    pause
    exit /b 1
)

echo [5/6] Testando chave e modelos Gemini...
call C:\TratoCore\TESTAR_GEMINI.bat
if errorlevel 1 (
    echo.
    echo O Gemini nao passou no teste. TratoCore nao sera iniciado.
    pause
    exit /b 1
)

echo [6/6] Iniciando TratoCore...
start "TRATOCORE - GEMINI" cmd /k "cd /d C:\TratoCore && node api/server.js"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i-lt40;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:3000/api -TimeoutSec 2;if($r.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Seconds 1}; if(-not $ok){exit 1}"
if errorlevel 1 (
    echo ERRO: TratoCore nao respondeu em localhost:3000.
    echo Verifique a janela do servidor.
    pause
    exit /b 1
)

start "" "http://localhost:3000"
echo.
echo ============================================================
echo TRATOCORE ATUALIZADO E TESTADO
 echo ============================================================
echo Modelo: gemini-3.5-flash-lite
 echo Gemini: chave encontrada e modelo validado
 echo.
pause
endlocal
