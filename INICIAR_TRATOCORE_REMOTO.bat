@echo off
cd /d %~dp0
echo ======================================
echo TRATOCORE - SERVIDOR CENTRAL
 echo Porta 3000 - acesso por tunel externo
 echo ======================================
call npm start
pause
