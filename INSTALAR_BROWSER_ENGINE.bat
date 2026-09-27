@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo TRATOCORE - INSTALACAO DO BROWSER ENGINE
echo ==============================================
echo.
call npm install
if errorlevel 1 (
  echo.
  echo ERRO: nao foi possivel instalar as dependencias.
  pause
  exit /b 1
)
echo.
echo Browser Engine instalado.
echo O TratoCore usara o Chrome ou Edge ja instalado.
echo.
pause
