@echo off
setlocal
cd /d C:\TratoCore
if not exist diagnostico_publicacao_ml.js (
  echo ERRO: diagnostico_publicacao_ml.js nao encontrado em C:\TratoCore
  pause
  exit /b 1
)
echo ============================================
echo TRATOCORE - DIAGNOSTICO PUBLICACAO ML
echo ============================================
node diagnostico_publicacao_ml.js
echo.
echo Codigo de saida: %ERRORLEVEL%
pause
