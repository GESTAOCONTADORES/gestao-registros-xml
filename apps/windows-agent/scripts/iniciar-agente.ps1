<# Gestão XML Agent — inicia o agente em segundo plano (atalho "Iniciar agente"). #>
$ErrorActionPreference = 'SilentlyContinue'
$base = Split-Path -Parent $PSScriptRoot
Remove-Item (Join-Path $base 'parar.flag') -Force
Start-Process -WindowStyle Hidden -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$PSScriptRoot\launcher.ps1`""
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show('Gestão XML Agent iniciado. Em alguns segundos o sistema web mostrará "Agente XML ● Online".', 'Gestão XML Agent') | Out-Null
