@echo off
chcp 65001 >nul
setlocal
set "BASE=%~dp0.."
set "DATA=%ProgramData%\GestaoXmlServidor"
set "SVC=%BASE%\service\GestaoXmlApi.exe"
title Gestão XML - Status do servidor
echo.
echo === Serviço da API (GestaoXmlApi) ===
sc query GestaoXmlApi | findstr /i "STATE ESTADO"
echo.
echo === API respondendo? ===
curl.exe -s -m 5 http://127.0.0.1:3333/health || echo NÃO respondeu em http://127.0.0.1:3333
echo.
echo.
echo === Cloudflare Tunnel (Cloudflared) ===
sc query Cloudflared >nul 2>&1 && (sc query Cloudflared | findstr /i "STATE ESTADO") || echo Não instalado neste computador.
echo.
pause
