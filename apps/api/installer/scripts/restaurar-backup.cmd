@echo off
chcp 65001 >nul
setlocal
set "BASE=%~dp0.."
set "DATA=%ProgramData%\GestaoXmlServidor"
set "SVC=%BASE%\service\GestaoXmlApi.exe"
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
title Gestão XML - Restaurar backup
echo Backups disponíveis (mais recentes primeiro):
echo.
dir /b /o-d "%DATA%\backups\backup-*.tar.gz"
echo.
set /p "ARQ=Digite o nome do arquivo a restaurar (ou ENTER para cancelar): "
if "%ARQ%"=="" exit /b
if not exist "%DATA%\backups\%ARQ%" (echo Arquivo não encontrado. & pause & exit /b 1)
echo.
echo ATENÇÃO: os dados atuais serão substituídos pelos do backup (a versão atual fica guardada).
set /p "OK=Confirma? (S/N): "
if /i not "%OK%"=="S" exit /b
"%SVC%" stop
set "ENV_FILE=%DATA%\.env"
"%BASE%\node\node.exe" "%BASE%\app\dist\maintenance.js" restore "%DATA%\backups\%ARQ%"
"%SVC%" start
pause
