@echo off
chcp 65001 >nul
title Gestão XML - Link de teste temporário
echo.
echo  ==================================================================
echo   LINK DE TESTE TEMPORÁRIO (Cloudflare, sem conta e sem domínio)
echo  ==================================================================
echo.
echo   - O sistema fica acessível pela internet SOMENTE enquanto esta
echo     janela estiver aberta. Para encerrar, feche a janela.
echo   - Qualquer pessoa com o link vê a tela de login: envie só para
echo     quem vai testar. A cada abertura o endereço muda.
echo   - Procure abaixo a linha com  https://....trycloudflare.com
echo     (aparece em alguns segundos) e abra no navegador.
echo.
"%~dp0..\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://127.0.0.1:3333
echo.
echo O link foi encerrado.
pause
