@echo off
setlocal
title TratoCore - Abrir por CMD
cd /d C:\TratoCore
if not exist package.json (
  echo C:\TratoCore nao encontrado.
  pause
  exit /b 1
)
where node >nul 2>nul || (echo Node.js nao encontrado.&pause&exit /b 1)
start "TratoCore - SERVIDOR" cmd /k "cd /d C:\TratoCore && npm start"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i-lt40;$i++){try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:3000/api -TimeoutSec 2;if($r.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Seconds 1}; if(-not $ok){exit 1}"
if errorlevel 1 echo O servidor nao respondeu. Confira a janela CMD.
start "" "http://localhost:3000"
endlocal
