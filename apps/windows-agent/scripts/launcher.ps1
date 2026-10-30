<#
  Gestão XML Agent — inicializador.
  Executa o agente sem janela, na sessão do usuário (onde a unidade G: do Google
  Drive existe), e o reinicia automaticamente se ele parar.
  Usado pelo atalho de inicialização do Windows e pela Tarefa Agendada.
#>
$ErrorActionPreference = 'SilentlyContinue'
$base  = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $base 'dist\agent.cjs'
$node  = Join-Path $base 'node\node.exe'
if (-not (Test-Path $node)) { $node = 'node.exe' }   # pacote sem Node embutido
$stopFlag = Join-Path $base 'parar.flag'

# uma única cópia do inicializador por usuário
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\GestaoXmlAgentLauncher', [ref]$created)
if (-not $created) { exit 0 }

Remove-Item $stopFlag -Force
Set-Location $base
try {
  while (-not (Test-Path $stopFlag)) {
    & $node $agent *> $null
    if (Test-Path $stopFlag) { break }
    Start-Sleep -Seconds 15   # reinício automático após falha
  }
} finally {
  $mutex.ReleaseMutex()
}
