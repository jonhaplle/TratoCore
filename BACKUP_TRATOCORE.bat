@echo off
setlocal
net session >nul 2>&1
if not "%errorlevel%"=="0" (
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='C:\TratoCore'; $dst=Join-Path $src ('backup\manual_'+(Get-Date -Format yyyyMMdd_HHmmss)); New-Item -ItemType Directory -Force -Path $dst | Out-Null; Get-ChildItem -LiteralPath $src -Force | Where-Object {$_.Name -notin @('node_modules','backup')} | ForEach-Object { Copy-Item $_.FullName -Destination $dst -Recurse -Force }; Write-Host ('Backup criado em '+$dst) -ForegroundColor Green"
pause
