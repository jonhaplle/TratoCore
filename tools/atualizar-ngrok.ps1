$ErrorActionPreference = "Stop"

$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env"
$ngrokApi = "http://127.0.0.1:4040/api/tunnels"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "       TRATO CORE - CONFIGURANDO NGROK" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$url = $null

for ($i = 0; $i -lt 30; $i++) {

    try {
        $data = Invoke-RestMethod `
            -Uri $ngrokApi `
            -Method Get `
            -TimeoutSec 2

        $tunnel = $data.tunnels |
            Where-Object { $_.public_url -like "https://*" } |
            Select-Object -First 1

        if ($tunnel) {
            $url = $tunnel.public_url.TrimEnd("/")
            break
        }
    }
    catch {
        Start-Sleep -Seconds 1
    }

    Start-Sleep -Seconds 1
}

if (-not $url) {
    Write-Host "ERRO: URL HTTPS do ngrok nao encontrada." -ForegroundColor Red
    exit 1
}

$redirect = "$url/api/ml/callback"

Write-Host "NGROK:"
Write-Host $url -ForegroundColor Yellow
Write-Host ""

Write-Host "CALLBACK MERCADO LIVRE:"
Write-Host $redirect -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path $envFile)) {
    Write-Host "ERRO: arquivo .env nao encontrado:" -ForegroundColor Red
    Write-Host $envFile -ForegroundColor Red
    exit 1
}

$content = Get-Content $envFile -Raw

if ($content -match '(?m)^APP_URL=.*$') {
    $content = [regex]::Replace(
        $content,
        '(?m)^APP_URL=.*$',
        "APP_URL=$url"
    )
}
else {
    $content = $content.TrimEnd() + "`r`nAPP_URL=$url`r`n"
}

if ($content -match '(?m)^ML_REDIRECT_URI=.*$') {
    $content = [regex]::Replace(
        $content,
        '(?m)^ML_REDIRECT_URI=.*$',
        "ML_REDIRECT_URI=$redirect"
    )
}
else {
    $content = $content.TrimEnd() + "`r`nML_REDIRECT_URI=$redirect`r`n"
}

Set-Content `
    -Path $envFile `
    -Value $content `
    -Encoding UTF8

Write-Host "==========================================" -ForegroundColor Green
Write-Host "        .ENV ATUALIZADO COM SUCESSO" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "APP_URL=$url"
Write-Host "ML_REDIRECT_URI=$redirect"
Write-Host ""
exit 0

