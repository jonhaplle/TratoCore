@echo off
setlocal
cd /d "%~dp0"
echo ==============================================
echo TRATOCORE - INSTALACAO DA IA LOCAL
 echo ==============================================
where ollama >nul 2>nul
if errorlevel 1 (
  echo Ollama nao encontrado. Tentando instalar pelo winget...
  winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo Nao foi possivel instalar automaticamente o Ollama.
    echo Instale o Ollama e execute este arquivo novamente.
    pause
    exit /b 1
  )
)
echo.
echo Baixando o modelo de visao local gemma3:4b...
ollama pull gemma3:4b
if errorlevel 1 (
  echo Falha ao baixar o modelo.
  pause
  exit /b 1
)
echo.
echo IA LOCAL instalada. Agora abra o TratoCore normalmente.
pause
