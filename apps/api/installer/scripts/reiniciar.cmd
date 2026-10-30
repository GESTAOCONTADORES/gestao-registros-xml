@echo off
chcp 65001 >nul
setlocal
set "BASE=%~dp0.."
set "DATA=%ProgramData%\GestaoXmlServidor"
set "SVC=%BASE%\service\GestaoXmlApi.exe"
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'" & exit /b)
title Gestão XML - Reiniciar servidor
"%SVC%" restart
echo Aguardando a API...
"%BASE%\node\node.exe" "%BASE%\tools\setup.cjs" wait-health --port 3333 --timeout 60 && echo API no ar. || echo A API não respondeu. Veja os logs em %DATA%\logs
pause
