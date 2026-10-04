@echo off
chcp 65001 >nul
title Casa Clean Service - Serveur Web
cd /d "%~dp0"

echo ========================================================
echo   Casa Clean Service - Lancement du site local
echo ========================================================
echo.

:: Verification de Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERREUR] Node.js n'est pas installe ou introuvable dans le PATH.
    echo Veuillez installer Node.js depuis https://nodejs.org
    pause
    exit /b 1
)

:: Liberation du port 3000 si un ancien processus est reste ouvert
echo [1/3] Verification et liberation du port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: Verification des dependances
echo [2/3] Verification des modules npm...
if not exist "node_modules" (
    echo Installation des dependances en cours...
    call npm install
)

:: Ouverture automatique du navigateur dans 2 secondes
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

:: Demarrage du serveur
echo [3/3] Demarrage du serveur...
echo.
echo ========================================================
echo  Site Web Client    : http://localhost:3000
echo  Panneau Admin      : http://localhost:3000/admin-login
echo ========================================================
echo  (Appuyez sur Ctrl+C pour arreter le serveur)
echo.

node server.js
if %errorlevel% neq 0 (
    echo.
    echo [ERREUR] Le serveur s'est arrete avec une erreur.
    pause
)
