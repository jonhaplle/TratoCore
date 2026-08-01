@echo off
cd /d %%~dp0
echo Instalando dependencias...
call npm install
echo.
echo Instalacao concluida.
pause
