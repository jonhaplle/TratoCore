@echo off
title Trato Core
color 0A
:menu
cls
echo ===============================
echo         TRATO CORE
echo ===============================
echo.
echo 1 - Iniciar Servidor
echo 2 - Backup para GitHub
echo 3 - Atualizar Projeto
echo 4 - Instalar Dependencias
echo 5 - Abrir VS Code
echo 6 - Abrir Pasta do Projeto
echo 7 - Sair
echo.
set /p op=Escolha:

if "%%op%%"=="1" goto servidor
if "%%op%%"=="2" call backup.bat & goto menu
if "%%op%%"=="3" call atualizar.bat & goto menu
if "%%op%%"=="4" call instalar.bat & goto menu
if "%%op%%"=="5" goto vscode
if "%%op%%"=="6" explorer .
if "%%op%%"=="7" exit
goto menu

:servidor
call npm start
pause
goto menu

:vscode
code .
if errorlevel 1 echo VS Code nao encontrado.
pause
goto menu
