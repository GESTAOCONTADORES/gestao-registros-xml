@echo off
chcp 65001 >nul
setlocal
set "BASE=%~dp0.."
set "DATA=%ProgramData%\GestaoXmlServidor"
set "SVC=%BASE%\service\GestaoXmlApi.exe"
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
title Gestão XML - Backup agora
echo O serviço será parado por alguns segundos para gerar um backup consistente.
"%SVC%" stop
set "ENV_FILE=%DATA%\.env"
"%BASE%\node\node.exe" "%BASE%\app\dist\maintenance.js" backup
"%SVC%" start
echo.
echo Backups em: %DATA%\backups
pause
