@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title TratoCore - Atualizar para Gemini

echo ============================================================
echo        TRATOCORE - ATUALIZAR PARA GEMINI
echo ============================================================
echo.

echo [1/5] Parando somente o processo que estiver usando a porta 3000...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo PID %%P encontrado na porta 3000. Encerrando...
    taskkill /PID %%P /F >nul 2>nul
)

echo [2/5] Atualizando arquivos do TratoCore em C:\TratoCore...
if not exist "C:\TratoCore" mkdir "C:\TratoCore"
robocopy "%~dp0" "C:\TratoCore" /E /R:2 /W:1 /XF ".env" /XD ".git" "node_modules" "storage" "backups" >nul
if errorlevel 8 (
    echo ERRO: falha ao copiar os arquivos.
    pause
    exit /b 1
)

echo [3/5] Preservando a configuracao atual...
if not exist "C:\TratoCore\.env" (
    if exist "%~dp0.env" copy /Y "%~dp0.env" "C:\TratoCore\.env" >nul
)
if not exist "C:\TratoCore\.env" (
    echo AVISO: C:\TratoCore\.env nao existe.
    echo Execute CONFIGURAR_GEMINI.bat dentro de C:\TratoCore.
)

echo [4/5] Instalando/verificando dependencias...
cd /d C:\TratoCore
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo ERRO no npm install.
    pause
    exit /b 1
)

echo.
echo [5/5] Iniciando TratoCore com Gemini...
start "TRATOCORE - GEMINI" cmd /k "cd /d C:\TratoCore && node api/server.js"

echo Aguardando localhost:3000...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i-lt40;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:3000/api -TimeoutSec 2;if($r.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Seconds 1}; if(-not $ok){exit 1}"
if errorlevel 1 (
    echo.
    echo ERRO: TratoCore nao respondeu em localhost:3000.
    echo Verifique a janela CMD do servidor.
    pause
    exit /b 1
)

start "" "http://localhost:3000"
echo.
echo ============================================================
echo TRATOCORE ATUALIZADO E ABERTO COM GEMINI
echo ============================================================
echo.
echo IMPORTANTE: se aparecer erro de GEMINI_API_KEY, execute:
echo C:\TratoCore\CONFIGURAR_GEMINI.bat
echo.
pause
endlocal
