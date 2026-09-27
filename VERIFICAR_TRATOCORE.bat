@echo off
setlocal
cd /d C:\TratoCore
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $ErrorActionPreference='Continue'; Write-Host '=== TRATOCORE DOCTOR ===' -ForegroundColor Cyan; Write-Host ('Node: ' + (node --version)); Write-Host ('NPM:  ' + (npm --version)); Write-Host ('Pasta: ' + (Get-Location)); Write-Host ('package.json: ' + (Test-Path '.\package.json')); Write-Host ('.env: ' + (Test-Path '.\.env')); if (Test-Path '.\.env') { $hasGemini = Select-String -Path '.\.env' -Pattern '^GEMINI_API_KEY=\S' -Quiet; Write-Host ('Gemini configurado: ' + $hasGemini) }; $p = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue; Write-Host ('PostgreSQL 5432: ' + [bool]$p); node --check api/server.js; node --check api/services/local-ai.service.js; node --check api/services/ml/publish.service.js; Write-Host 'Checks de sintaxe concluídos.' -ForegroundColor Green }"
pause
