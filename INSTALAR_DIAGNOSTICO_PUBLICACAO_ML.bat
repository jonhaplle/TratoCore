@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================
echo TRATOCORE - INSTALAR DIAGNOSTICO ML
echo ============================================
echo.

if not exist "diagnostico_publicacao_ml.js" (
  echo ERRO: diagnostico_publicacao_ml.js nao existe nesta pasta.
  pause
  exit /b 1
)

if not exist "C:\TratoCore" (
  echo ERRO: C:\TratoCore nao foi encontrada.
  pause
  exit /b 2
)

if exist "C:\TratoCore\diagnostico_publicacao_ml.js" (
  copy /Y "C:\TratoCore\diagnostico_publicacao_ml.js" "C:\TratoCore\diagnostico_publicacao_ml.js.antes" >nul
)

copy /Y "diagnostico_publicacao_ml.js" "C:\TratoCore\diagnostico_publicacao_ml.js" >nul
copy /Y "DIAGNOSTICAR_PUBLICACAO_ML.bat" "C:\TratoCore\DIAGNOSTICAR_PUBLICACAO_ML.bat" >nul

if not exist "C:\TratoCore\diagnostico_publicacao_ml.js" (
  echo ERRO: nao foi possivel copiar o diagnostico para C:\TratoCore.
  pause
  exit /b 3
)

echo OK: diagnostico instalado em C:\TratoCore.
echo.
echo Agora execute:
echo C:\TratoCore\DIAGNOSTICAR_PUBLICACAO_ML.bat
echo.
pause
