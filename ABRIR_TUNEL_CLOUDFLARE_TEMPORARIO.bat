@echo off
cd /d %~dp0
echo ======================================
echo TRATOCORE - TUNEL PUBLICO TEMPORARIO
 echo ======================================
echo.
echo Este modo cria um endereco publico HTTPS temporario.
echo Copie o endereco trycloudflare.com exibido abaixo.
echo.
cloudflared tunnel --url http://localhost:3000
pause
