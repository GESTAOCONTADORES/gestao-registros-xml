# Remove a Tarefa Agendada do Gestão XML Agent
Stop-ScheduledTask -TaskName 'GestaoXmlAgent' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'GestaoXmlAgent' -Confirm:$false
Write-Host 'Tarefa removida.'
