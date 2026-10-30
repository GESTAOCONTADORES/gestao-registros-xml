# Gestão XML Agent (Windows)

O agente é o **único** componente que acessa
`G:\Drives compartilhados\Departamento Pessoal\REGISTROS ROBO XML - PDF`.
Ele fica num computador/servidor do Departamento Pessoal e:

- envia um *heartbeat* a cada 15 s (o sistema mostra **Agente XML ● Online/Offline**
  e se a pasta raiz está acessível);
- busca trabalhos na API a cada 3 s: pesquisas, verificação de pastas, criação
  de pasta autorizada pelo Master e gravação de relatórios;
- **só faz conexões de saída** (HTTPS) para a `API_URL` configurada, autenticado
  com `AGENT_API_TOKEN`. Nenhuma porta é aberta e a unidade `G:` não é
  compartilhada.

## Instalação rápida (recomendada): `GestaoXmlAgent-Setup.exe`

Um único arquivo, **com o Node.js embutido**, que **não exige administrador**.

1. Entre no Windows com o usuário que tem o **Google Drive para computador** aberto.
2. Execute `GestaoXmlAgent-Setup-1.0.0.exe` e clique em **Próximo**.
3. Na tela **Conexão com o sistema**, informe:
   - **Endereço da API** (ex.: `https://api-registros.gestaocontadores.com.br`);
   - **Token do agente** (o mesmo `AGENT_API_TOKEN` da API);
   - **Pasta monitorada**: já vem preenchida com
     `G:\Drives compartilhados\Departamento Pessoal\REGISTROS ROBO XML - PDF`.
4. Clique em **Instalar**. Ao final o instalador **testa a pasta e a conexão** e
   mostra o resultado. O agente já fica em execução e o sistema web passa a
   mostrar **Agente XML ● Online**.

O que o instalador faz:
- instala em `%LOCALAPPDATA%\Programs\GestaoXmlAgent` (perfil do usuário: o
  token no `.env` fica protegido pelas permissões do próprio perfil);
- inicia o agente **sem janela a cada logon** (atalho na pasta Inicializar) e o
  **reinicia sozinho** se ele parar;
- cria no Menu Iniciar › **Gestão XML Agent**: *Iniciar agente*, *Parar agente*,
  *Testar conexão*, *Abrir logs*, *Editar configuração* e *Desinstalar*;
- registra o programa em *Configurações › Aplicativos* (desinstalação normal).

**Atualizar:** basta executar o novo `Setup.exe`. A configuração atual é
reaproveitada (os campos já vêm preenchidos) e o agente é reiniciado.
**Desinstalar:** Menu Iniciar › Gestão XML Agent › Desinstalar. Nenhum arquivo
da pasta do Google Drive é tocado.

### Instalação silenciosa (TI / várias máquinas)
Use aspas nos valores (o instalador usa `/` como separador de opções):
```bat
GestaoXmlAgent-Setup-1.0.0.exe /S /API="https://api-registros.gestaocontadores.com.br" /TOKEN="<token>" /ROOT="G:\Drives compartilhados\Departamento Pessoal\REGISTROS ROBO XML - PDF"
```
Código de saída `0` = instalado; `2` = parâmetros inválidos; `3` = Windows 32 bits.
Desinstalação silenciosa: `"%LOCALAPPDATA%\Programs\GestaoXmlAgent\Desinstalar.exe" /S`.

### Aviso do Windows SmartScreen
Enquanto o instalador não for **assinado digitalmente**, o Windows pode exibir
"O Windows protegeu o computador". Clique em **Mais informações › Executar assim
mesmo**. Para eliminar o aviso, adquira um certificado de assinatura de código
(de preferência EV) e gere o instalador com
`SIGN_PFX=certificado.pfx SIGN_PASSWORD=... npm run installer -w @gestao/windows-agent`.

### Gerar o instalador
```bash
sudo apt-get install nsis        # Linux (no Windows: instale o NSIS 3)
npm ci
npm run installer -w @gestao/windows-agent
```
Saída: `apps/windows-agent/release/GestaoXmlAgent-Setup-<versão>.exe`. O Node.js
oficial (win-x64) é baixado de nodejs.org e conferido por SHA-256. O GitHub
Actions também gera o instalador automaticamente (workflow *Instalador do agente*).

> Se uma política de grupo (GPO) da empresa bloquear scripts PowerShell, a
> inicialização automática não funcionará; nesse caso use a instalação manual
> como Windows Service (seção 3.B) ou peça à TI uma exceção para a pasta do agente.

---

## Instalação manual (alternativa)

## 1. Requisitos
- Windows 10/11 ou Windows Server com **Google Drive para computador** logado
  numa conta com acesso ao Drive compartilhado do DP.
- **Node.js 20 LTS ou superior** (https://nodejs.org) — marque "Add to PATH".
- Acesso de saída HTTPS ao endereço da API.

## 2. ⚠️ Ponto crítico: a unidade G: existe só na sessão do usuário
O Google Drive para computador cria a unidade `G:` **dentro da sessão de quem
fez login** (por isso o instalador roda o agente na sessão do usuário). Um Windows Service padrão (conta *LocalSystem*) roda em outra
sessão e normalmente **não enxerga `G:`**. Por isso há duas formas de instalação:

| Forma | Quando usar |
|---|---|
| **A. Tarefa Agendada "ao fazer logon"** (recomendada) | Computador do DP que fica ligado e com o usuário logado (pode ficar com a tela bloqueada). Funciona sempre com o Google Drive. |
| **B. Windows Service** com a conta do usuário do Drive | Servidor onde o Drive esteja disponível para a conta do serviço (ex.: Drive configurado para a mesma conta, ou pasta sincronizada em disco local/compartilhamento de rede). |

Em qualquer caso, o sistema web mostra em *Configurações* se a pasta está
acessível — se aparecer **inacessível**, a forma de instalação precisa ser revista.

> Alternativa robusta para servidores: configurar o Google Drive no modo
> **"Espelhar arquivos"** e apontar `ROOT_PATH` para a pasta espelhada local
> (ex.: `C:\Users\dp\Meu Drive\...`), que é visível para serviços.

## 3. Instalação
1. No computador de desenvolvimento (ou pelo CI), gere o pacote:
   ```bash
   npm ci
   npm run package -w @gestao/windows-agent
   ```
   Resultado: `apps/windows-agent/release/GestaoXmlAgent/`.
2. Copie a pasta `GestaoXmlAgent` para o Windows, por exemplo
   `C:\GestaoXmlAgent`.
3. Copie `.env.example` para `.env` e preencha:
   ```env
   API_URL=https://api.seudominio.com.br
   AGENT_API_TOKEN=<mesmo valor da API>
   ROOT_PATH=G:\Drives compartilhados\Departamento Pessoal\REGISTROS ROBO XML - PDF
   ```
   Proteja o arquivo: botão direito → Propriedades → Segurança → somente o
   usuário do agente e Administradores.
4. Teste em primeiro plano: dê dois cliques em `scripts\start-agent.cmd`.
   Deve aparecer `Gestão XML Agent 1.0.0 iniciado` e `Pasta monitorada: ... (acessível)`.
   Feche a janela.

### A. Tarefa Agendada (recomendada com Google Drive)
Logado com o usuário que tem o Drive:
```powershell
powershell -ExecutionPolicy Bypass -File C:\GestaoXmlAgent\scripts\install-task.ps1
```
A tarefa inicia a cada logon, roda oculta, sem limite de tempo, e reinicia em
caso de falha. Remover: `scripts\uninstall-task.ps1`.

### B. Windows Service
PowerShell **como Administrador**:
```powershell
cd C:\GestaoXmlAgent
npm install node-windows@1.0.0-beta.8
$env:SERVICE_ACCOUNT = "DOMINIO\usuario.do.drive"
$env:SERVICE_PASSWORD = "senha-da-conta"
node scripts\install-service.cjs
```
O serviço **GestaoXmlAgent** aparece em `services.msc` (início automático,
reinício em falha). Remover: `node scripts\uninstall-service.cjs`.

Também é possível usar o NSSM (https://nssm.cc):
`nssm install GestaoXmlAgent "C:\Program Files\nodejs\node.exe" "C:\GestaoXmlAgent\dist\agent.cjs"`
e, na aba *Log on*, informar a conta do usuário do Drive.

## 4. Configuração (`.env`)
| Variável | Padrão | Descrição |
|---|---|---|
| `API_URL` | — | Endereço da API (HTTPS obrigatório fora de localhost) |
| `AGENT_API_TOKEN` | — | Token compartilhado com a API (mín. 24 caracteres) |
| `ROOT_PATH` | `G:\Drives compartilhados\...\REGISTROS ROBO XML - PDF` | Pasta raiz |
| `REPORTS_FOLDER_NAME` | `RELATORIOS ROBO` | Subpasta dos relatórios |
| `DATA_DIR` | `C:\ProgramData\GestaoXmlAgent` | Cache e logs |
| `POLL_INTERVAL_MS` / `HEARTBEAT_INTERVAL_MS` | 3000 / 15000 | Intervalos |
| `BATCH_MAX_FILES` / `BATCH_MAX_MB` | 50 / 16 | Tamanho dos lotes enviados |
| `MAX_XML_FILE_MB` | 20 | Arquivos maiores viram "erro" |
| `LOG_RETENTION_DAYS` | 30 | Retenção dos logs |

## 5. Como a pesquisa funciona
1. Recebe a lista `{empresa, nome da pasta}` cadastrada pelo Master — nunca um caminho.
   O nome é validado e o caminho final precisa estar **dentro** de `ROOT_PATH`.
2. Localiza todos os `.xml` (recursivo, sem seguir atalhos/links) → total real
   para a barra de progresso. Pasta inexistente → "Pasta não encontrada" (nunca é criada).
3. Para cada arquivo: tamanho + data → **cache local**; se mudou (ou "verificação
   completa"), lê o arquivo, calcula o **SHA-256** e extrai a competência.
4. Filtra pelo mês/ano pedido.
5. Em lotes: pergunta à API quais hashes já existem. Já existentes → contados
   como "já importados" (o conteúdo nem é enviado). Novos → enviados; a API
   recalcula o SHA-256 e grava com `UNIQUE(file_hash)`.
6. XML corrompido, sem permissão etc. → registrado como erro, o lote continua.
7. Cancelamento do Master → para após o arquivo atual; o que já foi importado fica.
8. Encerramento do Windows/serviço → termina o arquivo atual e informa a API.

## 6. Relatórios
Cada relatório gerado no sistema é gravado em:
```text
RELATORIOS ROBO\<ano>\<MM - MÊS>\Relatorio_XML_DP_<referência>_<data>_<hora>.pdf
```
As subpastas de ano/mês são criadas automaticamente dentro de `RELATORIOS ROBO`.
Um arquivo existente nunca é sobrescrito (é acrescentado `_2`, `_3`...).

## 7. Logs
`C:\ProgramData\GestaoXmlAgent\logs\agent-AAAA-MM-DD.log` — um arquivo por dia,
removidos após `LOG_RETENTION_DAYS`:
```text
2026-10-30 11:30:01 INFO Pesquisa iniciada (execução #12, 82 empresa(s), período 10/2026)
2026-10-30 11:30:02 INFO Empresa ABC
2026-10-30 11:30:03 INFO 182 arquivos encontrados
2026-10-30 11:30:04 INFO 12 arquivos novos
2026-10-30 11:30:05 INFO 170 duplicados
2026-10-30 11:30:05 ERROR copias\arquivo.xml - XML inválido: ... (linha 3, coluna 7)
```

## 8. Problemas comuns
| Sintoma | Causa provável / solução |
|---|---|
| Sistema mostra **Offline** | Agente parado, sem internet, `API_URL` errada ou token diferente da API. Veja o log do dia. |
| Online, mas **pasta inacessível** | Agente rodando fora da sessão do Google Drive (ver seção 2) ou `ROOT_PATH` incorreto. |
| "Pasta não encontrada" numa empresa | O nome cadastrado difere do nome da pasta no Drive (acentos/espaços). Corrija em *Empresas* ou use *Criar pasta* (Master). |
| Primeira pesquisa demorada | Arquivos "somente online" do Drive são baixados na primeira leitura; as próximas usam o cache. |
| Execução marcada como **Falha** | O agente ficou mais de `AGENT_RUN_STALE_SECONDS` sem se comunicar. Basta pesquisar de novo: nada é importado em duplicidade. |
