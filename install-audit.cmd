@echo off
setlocal
cd /d C:\TratoCore
if not exist tools mkdir tools
copy /Y "%~dp0audit-ml-used-categories.js" "tools\audit-ml-used-categories.js"
echo.
echo ===== VALIDANDO AUDITOR =====
node --check tools\audit-ml-used-categories.js
if errorlevel 1 exit /b 1
echo.
echo ===== VERIFICANDO API =====
findstr /n /i "searchUserItems" api\services\ml\api.service.js
echo.
echo INSTALACAO DO AUDITOR CONCLUIDA.
echo Agora rode:
echo node tools\audit-ml-used-categories.js --validate
pause
