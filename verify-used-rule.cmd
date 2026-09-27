@echo off
setlocal
cd /d C:\TratoCore
echo ===== ATTRIBUTE RESOLVER =====
findstr /n /i "ITEM_CONDITION 2230581 condition" api\services\ml\attributeResolver.service.js
echo.
echo ===== SYNTAX CHECK =====
node --check api\services\ml\attributeResolver.service.js
if errorlevel 1 exit /b 1
echo.
echo REGRA PRESENTE E SINTAXE OK.
echo Nenhum anuncio foi alterado.
pause
