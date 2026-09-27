@echo off
title Trato Core - Instalacao
color 0A

cd /d "%~dp0"

echo ==========================================
echo        INSTALADOR TRATO CORE
echo ==========================================
echo.

:: Verifica Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado.
    echo Instale o Node.js antes de continuar.
    pause
    exit /b
)

:: Verifica npm
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERRO] NPM nao encontrado.
    pause
    exit /b
)

echo.
echo Instalando dependencias...
call npm install

if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b
)

echo.
echo ==========================================
echo Instalacao concluida com sucesso.
echo ==========================================
pause