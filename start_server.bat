@echo off
chcp 65001 >nul
title Steamstrike: Tactical Arena Server
cd /d "%~dp0"

echo ========================================================================
echo        ⚙ STEAMSTRIKE: TACTICAL ARENA - GAME SERVER LAUNCHER ⚙
echo ========================================================================
echo.
echo [1/3] Перевірка середовища Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ПОМИЛКА] Node.js не знайдено в системній змінній PATH!
    echo Будь ласка, завантажте та встановіть Node.js: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [2/3] Запуск клієнта у браузері (http://localhost:3000)...
timeout /t 1 /nobreak >nul
start http://localhost:3000

echo [3/3] Запуск сервера Steamstrike (порт 3000, 30 Hz)...
echo.
echo ========================================================================
echo   Сервер активний. Для зупинки натисніть Ctrl+C або закрийте це вікно.
echo ========================================================================
echo.

node server/index.js

if %errorlevel% neq 0 (
    echo.
    echo [УВАГА] Сервер завершив роботу з кодом помилки: %errorlevel%
    pause
)
