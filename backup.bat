@echo off
title Trato Core - GitHub
color 0A

cd /d "%~dp0"

git --version >nul 2>nul
if errorlevel 1 (
    echo Git nao encontrado.
    pause
    exit /b
)

echo ==========================================
echo          TRATO CORE - GITHUB
echo ==========================================
echo.

git status

echo.
set /p MSG=Descricao do commit: 

if "%MSG%"=="" (
    echo Commit cancelado.
    pause
    exit /b
)

git add .

git commit -m "%MSG%"

if errorlevel 1 (
    echo.
    echo Nenhuma alteracao para enviar ou ocorreu um erro.
    pause
    exit /b
)

git push

echo.
echo ==========================================
echo Projeto enviado ao GitHub com sucesso.
echo ==========================================

pause