@echo off
chcp 65001 >nul
setlocal
set "BASE=%~dp0.."
set "DATA=%ProgramData%\GestaoXmlServidor"
set "SVC=%BASE%\service\GestaoXmlApi.exe"
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
start "" notepad.exe "%DATA%\DADOS-DE-ACESSO.txt"
