@echo off
REM Gestão XML Agent — testa a configuração (.env), a pasta monitorada e a conexão com a API
chcp 65001 >nul
cd /d "%~dp0.."
set NODE=node\node.exe
if not exist "%NODE%" set NODE=node.exe
echo.
"%NODE%" dist\agent.cjs --check
echo.
if %ERRORLEVEL%==0 (echo Tudo certo.) else (echo Corrija os itens acima. Use o atalho "Editar configuracao" e depois "Iniciar agente".)
echo.
pause
