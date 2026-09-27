@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d C:\TratoCore
title TratoCore - Configurar Gemini

echo ==============================================
echo       CONFIGURAR GEMINI - TRATOCORE
echo ==============================================
echo.
echo Cole abaixo sua chave criada no Google AI Studio.
echo A chave sera gravada em C:\TratoCore\.env
echo Nao envie a chave para o chat.
echo.
set /p "GEMINI_KEY=GEMINI_API_KEY: "
if not defined GEMINI_KEY (
  echo.
  echo Nenhuma chave informada.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='C:\TratoCore\.env'; $key=$env:GEMINI_KEY; if(Test-Path $p){$s=Get-Content -Raw $p}else{$s=''}; if($s -match '(?m)^GEMINI_API_KEY='){ $s=[regex]::Replace($s,'(?m)^GEMINI_API_KEY=.*$','GEMINI_API_KEY='+[regex]::Escape($key).Replace('\\','\\\\')) } else { $s=$s.TrimEnd()+\"`r`nGEMINI_API_KEY=$key`r`n\" }; if($s -notmatch '(?m)^GEMINI_MODEL='){ $s=$s.TrimEnd()+\"`r`nGEMINI_MODEL=gemini-3.5-flash-lite`r`n\" }; Set-Content -Path $p -Value $s -Encoding UTF8" 
if errorlevel 1 (
  echo.
  echo ERRO ao gravar o .env.
  pause
  exit /b 1
)

echo.
echo Gemini configurado em C:\TratoCore\.env
echo Agora REINICIE o TratoCore.
pause
endlocal
