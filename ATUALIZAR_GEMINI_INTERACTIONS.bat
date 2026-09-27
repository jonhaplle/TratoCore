@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo   TRATOCORE - ATUALIZAR GEMINI INTERACTIONS
echo ================================================
echo.

if not exist "api\services\local-ai.service.js" (
    echo ERRO: esta pasta nao parece ser o pacote do TratoCore.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$src=(Resolve-Path '.').Path; $dst='C:\TratoCore'; if(!(Test-Path $dst)){New-Item -ItemType Directory -Path $dst -Force | Out-Null}; $exclude=@('.env','node_modules','storage','backups','.git'); Get-ChildItem -LiteralPath $src -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force }; Write-Host 'Arquivos atualizados em C:\TratoCore'"

if errorlevel 1 (
  echo ERRO: falha ao copiar os arquivos.
  pause
  exit /b 1
)

if not exist "C:\TratoCore\api\services\local-ai.service.js" (
  echo ERRO: arquivo principal nao foi copiado.
  pause
  exit /b 1
)

if not exist "C:\TratoCore\teste_gemini_interactions.js" (
  echo ERRO: teste_gemini_interactions.js nao foi copiado.
  pause
  exit /b 1
)

echo.
echo [1/3] Arquivos copiados.
echo [2/3] Verificando JavaScript...
node --check "C:\TratoCore\api\services\local-ai.service.js"
if errorlevel 1 (
  echo ERRO: JavaScript invalido.
  pause
  exit /b 1
)

echo [3/3] Verificacao concluida.
echo.
echo Agora execute:
echo   C:\TratoCore\TESTAR_GEMINI_INTERACTIONS.bat
echo.
echo O .env existente foi preservado.
pause
