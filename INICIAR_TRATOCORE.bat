@echo off
setlocal
title TratoCore - Inicializacao

echo ==========================================
echo        TRATO CORE - INICIALIZACAO
echo ==========================================
echo.

cd /d C:\TratoCore

if errorlevel 1 (
    echo ERRO: C:\TratoCore nao foi encontrado.
    pause
    exit /b 1
)

echo [1/5] Verificando Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo ERRO: Node.js nao encontrado no PATH.
    pause
    exit /b 1
)

echo [2/5] Verificando ngrok...
where ngrok >nul 2>nul
if errorlevel 1 (
    echo ERRO: ngrok nao encontrado no PATH.
    pause
    exit /b 1
)

echo [3/5] Abrindo ngrok...
start "TratoCore - NGROK" cmd /k "cd /d C:\TratoCore && ngrok http 3000"

echo.
echo Aguardando ngrok e atualizando .env...
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\TratoCore\tools\atualizar-ngrok.ps1"

if errorlevel 1 (
    echo.
    echo ERRO ao configurar o ngrok.
    pause
    exit /b 1
)

echo.
echo [4/5] Abrindo TratoCore em modo DEV...
start "TratoCore - DEV" cmd /k "cd /d C:\TratoCore && npm run dev"

echo.
echo Aguardando servidor TratoCore...

powershell -NoProfile -Command ^
"$ok=$false; for($i=0;$i -lt 30;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:3000/api -TimeoutSec 2;if($r.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Seconds 1}; if(-not $ok){exit 1}"

if errorlevel 1 (
    echo.
    echo ERRO: TratoCore nao respondeu em http://localhost:3000/api
    pause
    exit /b 1
)

echo.
echo [5/5] Abrindo projeto...

where code >nul 2>nul
if not errorlevel 1 (
    start "" code "C:\TratoCore"
) else (
    start "" explorer "C:\TratoCore"
)

echo.
echo ==========================================
echo        TRATO CORE ONLINE
echo ==========================================
echo.
echo Local: http://localhost:3000
echo API:   http://localhost:3000/api
echo.
echo Ambiente pronto.
echo ==========================================
echo.

pause
endlocal
