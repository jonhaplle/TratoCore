@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0"
set "DEST=C:\TratoCore"
echo ============================================
echo TRATOCORE - AUTO PREENCHIMENTO MARCA/MODELO
echo ============================================
echo.
if not exist "%ROOT%api\services\ml\publish.service.js" (
  echo ERRO: publish.service.js nao encontrado no pacote.
  pause
  exit /b 1
)
if not exist "%DEST%" (
  echo ERRO: C:\TratoCore nao existe.
  pause
  exit /b 1
)
copy /Y "%ROOT%api\services\ml\publish.service.js" "%DEST%\api\services\ml\publish.service.js" >nul
if errorlevel 1 (
  echo ERRO: falha ao copiar publish.service.js
  pause
  exit /b 1
)
copy /Y "%ROOT%api\services\local-ai.service.js" "%DEST%\api\services\local-ai.service.js" >nul
if errorlevel 1 (
  echo ERRO: falha ao copiar local-ai.service.js
  pause
  exit /b 1
)
node -c "%DEST%\api\services\ml\publish.service.js"
if errorlevel 1 (
  echo ERRO: JavaScript invalido.
  pause
  exit /b 1
)
node -c "%DEST%\api\services\local-ai.service.js"
if errorlevel 1 (
  echo ERRO: local-ai.service.js invalido.
  pause
  exit /b 1
)
echo.
echo CORRECAO INSTALADA COM SUCESSO.
echo O TratoCore agora tenta identificar automaticamente marca/modelo com Gemini
pause
