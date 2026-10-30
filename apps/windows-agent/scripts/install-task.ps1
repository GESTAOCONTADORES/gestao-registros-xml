<#
  Gestão XML Agent — instalação como Tarefa Agendada "ao fazer logon".

  Esta é a forma MAIS CONFIÁVEL quando a pasta está no Google Drive para computador:
  o agente roda dentro da sessão do usuário que tem a unidade G: montada,
  em segundo plano (sem janela) e é reiniciado automaticamente em caso de falha.

  Uso (PowerShell, logado com o usuário que tem o Google Drive):
    powershell -ExecutionPolicy Bypass -File .\scripts\install-task.ps1
#>
$ErrorActionPreference = 'Stop'
$base   = Split-Path -Parent $PSScriptRoot
$script = Join-Path $base 'dist\agent.cjs'
$node   = (Get-Command node.exe -ErrorAction Stop).Source

if (-not (Test-Path $script)) { throw "Arquivo não encontrado: $script" }
if (-not (Test-Path (Join-Path $base '.env'))) { throw 'Crie o arquivo .env (a partir de .env.example) antes de instalar.' }

$taskName = 'GestaoXmlAgent'
$action   = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $base
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Hidden
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Gestão XML Agent — Departamento Pessoal / REGISTROS XML-PDF' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Tarefa '$taskName' instalada e iniciada. Confira no sistema web: 'Agente XML ● Online'."
