@echo off
REM Executa o Gestão XML Agent em primeiro plano (útil para testar a configuração)
cd /d "%~dp0.."
node dist\agent.cjs
pause
