@echo off
setlocal

echo ==========================================
echo APLICANDO TESTE DE CATALOGO POR DOMINIO
echo ==========================================

copy /Y C:\TratoCore\teste_catalogo.js C:\TratoCore\teste_catalogo.js.antes-domain2

powershell -NoProfile -Command "$p='C:\TratoCore\teste_catalogo.js'; $s=Get-Content $p -Raw; $s=$s -replace 'const data = await apiService\.searchProducts\(\{[\s\S]*?q,\s*limit: 10\s*\}\);', 'const data = await apiService.searchProducts({ q, domain_id: ''MLB-GAME_CONSOLES'', limit: 10 });'; Set-Content -Path $p -Value $s -Encoding UTF8"

echo.
echo ==========================================
echo CONFERINDO ALTERACAO
echo ==========================================

findstr /N /C:"domain_id: 'MLB-GAME_CONSOLES'" C:\TratoCore\teste_catalogo.js

echo.
echo ==========================================
echo VALIDANDO JAVASCRIPT
echo ==========================================

node --check C:\TratoCore\teste_catalogo.js

if errorlevel 1 (
    echo.
    echo ERRO: JavaScript invalido.
    echo Restaurando backup...
    copy /Y C:\TratoCore\teste_catalogo.js.antes-domain2 C:\TratoCore\teste_catalogo.js
    exit /b 1
)

echo.
echo ==========================================
echo ALTERACAO OK
echo ==========================================

pause