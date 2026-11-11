@echo off
setlocal
title Trato Vendedor - Voz do Marcos

set "PYTHON=%USERPROFILE%\Downloads\.venv_qwen\Scripts\python.exe"
set "TRATO_VENDEDOR_VOICE_REF=%USERPROFILE%\Downloads\marcos_voz_referencia_nova.wav"

if not exist "%PYTHON%" (
  echo ERRO: Ambiente Qwen nao encontrado:
  echo %PYTHON%
  pause
  exit /b 1
)

if not exist "%TRATO_VENDEDOR_VOICE_REF%" (
  echo ERRO: Audio de referencia nao encontrado:
  echo %TRATO_VENDEDOR_VOICE_REF%
  echo Ajuste TRATO_VENDEDOR_VOICE_REF no arquivo BAT se necessario.
  pause
  exit /b 1
)

cd /d "%~dp0"
"%PYTHON%" server.py
pause
