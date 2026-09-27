@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo =====================================================
echo TRATOCORE - CORRECAO PRODUTOS / ABERTURA
 echo =====================================================

if not exist "api\server.js" (
  echo ERRO: execute este arquivo a partir da pasta tc_current do pacote.
  pause
  exit /b 1
)

if not exist "C:\TratoCore" mkdir "C:\TratoCore"

echo [1/4] Encerrando servidor anterior...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1

echo [2/4] Copiando arquivos corrigidos...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$src=(Resolve-Path '.').Path; $dst='C:\TratoCore'; Get-ChildItem -LiteralPath $src -Force | Where-Object { $_.Name -notin @('.env','node_modules','storage') } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force }"
if errorlevel 1 (
  echo ERRO na copia.
  pause
  exit /b 1
)

echo [3/4] Verificando JS...
cd /d C:\TratoCore
node --check public\produtos.js
if errorlevel 1 goto erro
node --check api\server.js
if errorlevel 1 goto erro

if not exist "C:\TratoCore\.env" echo AVISO: .env nao encontrado. Preserve/configure sua chave e DB.

echo [4/4] Pronto.
echo.
echo Correcoes aplicadas:
echo - clique na linha de Produto abre o ID correto
necho - titulo da linha fica navegavel
necho - health check de PostgreSQL disponivel em /api/health

echo.
echo Iniciando TratoCore...
start "TratoCore" cmd /k "cd /d C:\TratoCore && npm start"
timeout /t 3 >nul
start "" http://localhost:3000
exit /b 0

:erro
echo ERRO: validacao JavaScript falhou.
pause
exit /b 1
