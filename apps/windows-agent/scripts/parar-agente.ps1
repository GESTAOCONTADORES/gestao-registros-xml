<#
  Gestão XML Agent — para o agente desta instalação (sem afetar outros programas Node.js).
  Uso: atalho "Parar agente" ou  powershell -ExecutionPolicy Bypass -File parar-agente.ps1 [-Quiet]
#>
param([switch]$Quiet)
$ErrorActionPreference = 'SilentlyContinue'
$base  = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $base 'dist\agent.cjs'
New-Item -ItemType File -Path (Join-Path $base 'parar.flag') -Force | Out-Null

$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($agent.ToLower()) }
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force }

if (-not $Quiet) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('O Gestão XML Agent foi parado. Para iniciar novamente use o atalho "Iniciar agente" ou reinicie o computador.', 'Gestão XML Agent') | Out-Null
}
