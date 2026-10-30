# Arquitetura — Departamento Pessoal / REGISTROS XML-PDF

Este documento é a "primeira entrega" pedida na Seção 60 da especificação:
arquitetura, árvore de diretórios, modelo do banco, fluxo e riscos técnicos.

---

## 1. Visão geral

```text
┌──────────────────────┐  HTTPS (JWT + refresh cookie)  ┌──────────────────────┐
│  Navegador (DP)      │ ─────────────────────────────▶ │  API (Node/Fastify)  │
│  React + Vite        │ ◀───── SSE (progresso real) ── │  apps/api            │
│  Cloudflare Pages    │                                 └──────────┬───────────┘
└──────────────────────┘                                            │ SQL
                                                                     ▼
                                                          ┌──────────────────────┐
                                                          │  PostgreSQL          │
                                                          │  (fila de jobs,      │
                                                          │   registros, XMLs)   │
                                                          └──────────▲───────────┘
                                                                     │
         HTTPS de SAÍDA (Bearer AGENT_API_TOKEN) — o agente busca jobs│
┌──────────────────────┐ ───────────────────────────────▶ API /agent/*
│ Gestão XML Agent     │   heartbeat · próximo job · progresso · upload
│ (Windows, Node.js)   │
│ apps/windows-agent   │ ──▶ G:\Drives compartilhados\Departamento Pessoal\REGISTROS ROBO XML - PDF
└──────────────────────┘
```

Fluxo exigido pela especificação:

```text
Cloudflare (front-end)
↓
API
↓
Banco (fila de jobs + dados)
↓
Windows Agent  (busca jobs na API, nunca o contrário)
↓
G:\
```

### Decisão importante: o agente só faz conexões de SAÍDA

A especificação diz que "o agente deverá aceitar comunicação somente da API
autorizada". A forma mais segura de garantir isso é o agente **não abrir
nenhuma porta**: ele próprio conecta na URL configurada da API (HTTPS),
autentica com `AGENT_API_TOKEN` e pergunta "há trabalho para mim?". Assim:

- nenhuma porta é aberta no Windows / firewall / roteador;
- não existe compartilhamento público da unidade `G:`;
- funciona atrás de NAT, proxy corporativo e Wi-Fi do escritório;
- a API nunca envia caminhos: envia IDs e o `folder_name` cadastrado pelo
  Master, que o agente valida contra a pasta raiz (proteção contra path
  traversal dos dois lados).

### Onde fica cada responsabilidade

| Camada | Responsabilidades |
|---|---|
| **Web** (`apps/web`) | Login, solicitação de acesso, dashboard, gráficos, pesquisa e progresso, registros, downloads, relatórios, empresas, usuários, histórico, auditoria, notificações, configurações. |
| **API** (`apps/api`) | Autenticação (Argon2id + JWT 15 min + refresh token rotativo em cookie httpOnly), autorização por perfil **no backend**, rate limiting, auditoria, fila de jobs para o agente, recepção dos arquivos, deduplicação final (`UNIQUE(file_hash)`), geração de HTML/PDF/ZIP, relatórios PDF, e-mail SMTP, notificações, SSE de progresso. |
| **Agente** (`apps/windows-agent`) | Heartbeat, varredura das pastas, SHA-256, cache incremental, parser XML, filtro por competência, upload dos novos, progresso real, cancelamento seguro, verificação/criação (autorizada) de pastas, gravação dos relatórios em `RELATORIOS ROBO`, logs com rotação. |
| **Banco** (`packages/database`) | Migrations SQL versionadas, conexão PostgreSQL (produção) ou PGlite (Postgres embutido, desenvolvimento/testes), seed do Master. |
| **Parser** (`packages/xml-parser`) | Leitura tolerante de XML (eSocial, NF-e e genéricos), extração de metadados sem quebrar quando campos não existem. |
| **Shared** (`packages/shared`) | Tipos, enums, validações (zod), meses, helpers de competência e identificador de usuário. |

---

## 2. Árvore de diretórios

```text
gestao-registros-xml/
├── apps/
│   ├── web/                    React + TS + Vite + Tailwind (Cloudflare Pages)
│   │   ├── public/
│   │   │   ├── assets/logo-gestao-contadores.png   (arquivo oficial — a fornecer)
│   │   │   ├── _redirects      SPA fallback no Cloudflare Pages
│   │   │   └── _headers        cabeçalhos de segurança
│   │   └── src/
│   │       ├── api/            cliente HTTP, refresh automático, leitor SSE
│   │       ├── auth/           contexto de sessão
│   │       ├── components/     Header, Sidebar, UserMenu, NotificationBell, MetricCard,
│   │       │                   CompanySelector, MonthSelector, YearSelector, ImportProgress,
│   │       │                   ImportSummary, CompanyBarChart, MonthlyChart, RecordsTable,
│   │       │                   UserApprovalModal, CompanyModal, ConfirmDialog,
│   │       │                   LoadingState, EmptyState, ErrorState, ...
│   │       └── pages/          Login, SolicitarAcesso, Dashboard, Pesquisar, Registros,
│   │                           Empresas, Relatorios, Notificacoes, Usuarios, Historico,
│   │                           Auditoria, Configuracoes
│   ├── api/                    Node + TS + Fastify
│   │   └── src/
│   │       ├── routes/         auth, users, companies, runs, files, dashboard, reports,
│   │       │                   notifications, settings, audit, agent
│   │       ├── services/       audit, mail, notifications, jobs, render (HTML/PDF), zip
│   │       └── plugins/        auth (JWT, RBAC), errors
│   └── windows-agent/          Node + TS (serviço do Windows)
│       ├── src/                api-client, scanner, processor, cache, logger, jobs
│       └── scripts/            instalar/remover serviço, tarefa agendada
├── packages/
│   ├── shared/
│   ├── database/               migrations/*.sql, migrate, seed
│   └── xml-parser/
├── docs/
│   ├── ARQUITETURA.md  INSTALACAO.md  AGENTE-WINDOWS.md
│   ├── CLOUDFLARE.md   BANCO-DE-DADOS.md  SEGURANCA.md
├── .env.example  README.md  package.json  docker-compose.yml
```

---

## 3. Modelo do banco (resumo)

Detalhes completos e índices em [BANCO-DE-DADOS.md](BANCO-DE-DADOS.md).

| Tabela | Finalidade |
|---|---|
| `users` | usuários, perfil (`MASTER`/`USER`), status (`PENDING`/`ACTIVE`/`REJECTED`/`BLOCKED`), hash Argon2id, controle de tentativas de login. |
| `refresh_tokens` | refresh tokens (apenas hash SHA-256), rotação e revogação. |
| `companies` | empresas, CNPJ único, `folder_name` único, status, situação da pasta (`FOUND`/`NOT_FOUND`/`UNKNOWN`). |
| `import_runs` | execuções (lotes): filtros, contadores, progresso real, status, cancelamento. |
| `import_run_companies` | progresso por empresa dentro de cada execução. |
| `import_run_files` | **todo** arquivo visto em cada execução: `IMPORTED` / `DUPLICATE` / `ERROR` + mensagem. É o histórico de importação por arquivo e permite consultar arquivos com erro. |
| `imported_files` | registros únicos. **`file_hash` com `UNIQUE`** — principal proteção contra duplicidade. Metadados extraídos (`xml_metadata` JSONB) + colunas de busca (CPF, trabalhador, tipo, protocolo...). |
| `imported_file_contents` | bytes originais do XML (`BYTEA`), sem nenhuma alteração. |
| `agent_jobs` | fila API → agente (`SCAN`, `CHECK_FOLDERS`, `CREATE_FOLDER`, `SAVE_REPORT`). |
| `agent_status` | último heartbeat, versão, caminhos e acessibilidade da pasta. |
| `notifications` | central de notificações por usuário. |
| `reports` | relatórios gerados (filtros, PDF, caminho no Drive). |
| `audit_logs` | auditoria (usuário, ação, entidade, IP, detalhes, data/hora). |
| `settings` | configurações (ex.: notificações por e-mail). |

---

## 4. Fluxo de uma pesquisa (lote)

```text
1. Usuário escolhe empresas + mês/ano → vê o resumo → "Iniciar pesquisa"
2. API valida (agente online? já há execução ativa?) → cria import_run + agent_job(SCAN)
3. Agente (polling a cada 3 s) recebe o job com a lista de {company_id, folder_name}
4. Agente enumera os .xml de todas as pastas → total real conhecido
5. Para cada arquivo:
      stat → cache (caminho+tamanho+data) → se mudou: lê + SHA-256 + parser
      filtra pela competência pedida
6. A cada lote de até 50 arquivos:
      POST /agent/runs/:id/check-hashes  → API diz quais hashes já existem
      já existe  → DUPLICATE (contabilizado, conteúdo nem é enviado)
      não existe → POST /agent/runs/:id/files (conteúdo + metadados)
                   API recalcula o SHA-256 dos bytes recebidos e faz
                   INSERT ... ON CONFLICT (file_hash) DO NOTHING
                   → corrida/duplicado dentro do mesmo lote também vira DUPLICATE
7. Erros (XML inválido, sem permissão de leitura...) viram ERROR e o lote continua
8. Cada POST devolve { cancelRequested } → o agente para após o arquivo atual
9. API atualiza import_runs → SSE envia ao navegador → barra 0–100 % real
10. Final: status, notificação para os usuários, e-mail (se ativado), auditoria
```

O navegador pode ser fechado: o estado vive no banco (`GET /runs/active`).
Se o agente parar de se comunicar durante uma execução, um vigia na API marca
a execução como `FAILED` após `AGENT_RUN_STALE_SECONDS` (o que já foi
importado permanece).

---

## 5. Riscos técnicos identificados

| # | Risco | Impacto | Mitigação adotada |
|---|---|---|---|
| 1 | **Google Drive para computador monta `G:` por sessão de usuário.** Um Windows Service rodando como `LocalSystem` normalmente **não enxerga** `G:`. | Agente "online" mas sem acesso à pasta. | Agente informa no heartbeat se a pasta raiz está acessível (UI mostra o alerta). Documentado: serviço rodando com a conta do usuário que tem o Drive logado **ou** Tarefa Agendada "ao fazer logon" (script incluso) — esta é a opção mais confiável. |
| 2 | Leitura de milhares de arquivos via Drive (arquivos "somente online" são baixados sob demanda). | Execuções lentas na primeira vez. | Cache incremental local (caminho+tamanho+data → hash/competência), verificação de hash em lotes, conteúdo só é enviado se o hash for novo. Opção "verificação completa" ignora o cache. |
| 3 | Competência nem sempre existe no XML. | Arquivo fora do filtro de mês. | Ordem de tentativa: `perApur`/competência do evento → datas do evento → data de modificação do arquivo. A origem fica registrada (`competence_source`). |
| 4 | XMLs com dados pessoais (LGPD) armazenados na nuvem. | Exposição de dados de empregados. | Conteúdo só sai do banco após autenticação + autorização, com log de download; sem URLs públicas; nada é enviado a serviços externos/IA. Recomenda-se banco gerenciado com criptografia em repouso, na região Brasil. Alternativa documentada: hospedar a API e o banco na própria rede, expostos por Cloudflare Tunnel. |
| 5 | Front no Cloudflare Pages e API em outro domínio → cookies entre sites. | Refresh token bloqueado pelo navegador. | Recomendado usar subdomínios do mesmo domínio (`app.` e `api.`) → `SameSite=Lax`. Configurável (`COOKIE_SAMESITE=none`) quando não for possível. |
| 6 | Cloudflare Workers não executam Fastify/Argon2/PDFKit nativamente. | Backend não pode rodar "dentro" do Pages. | API como container Node (Dockerfile incluso) em VM/Render/Railway/Fly ou no servidor interno + Cloudflare Tunnel. Front no Pages. Documentado em CLOUDFLARE.md. |
| 7 | Uma única execução por vez. | Dois cliques simultâneos gerariam varreduras concorrentes. | API rejeita nova pesquisa enquanto houver execução ativa (mensagem clara). |
| 8 | SSE atrás de proxies que fazem buffer. | Barra "trava". | Cabeçalhos `X-Accel-Buffering: no`, heartbeat de 15 s, e o front reconecta e reconsulta o banco automaticamente. |
| 9 | Logo oficial ainda não fornecida. | — | Caminho reservado `apps/web/public/assets/logo-gestao-contadores.png`. Enquanto não existir, é exibido apenas o nome "Gestão Contadores" em texto (nenhuma logo inventada). |

---

## 6. Decisões que diferem levemente do texto da especificação (informadas)

1. **SQLite opcional em desenvolvimento → PGlite.** Em vez de SQLite foi usado
   PGlite (PostgreSQL real compilado em WebAssembly). O SQL é idêntico ao de
   produção, eliminando divergências de dialeto. Nenhuma instalação extra é
   necessária. PostgreSQL continua sendo o banco de produção.
2. **Comunicação API → Agente por fila + polling (saída do agente)** em vez de
   a API chamar o agente diretamente (ver seção 1). A segurança exigida
   (`AGENT_API_TOKEN`, somente a API autorizada) é preservada e reforçada.
3. **Progresso para o navegador via SSE**; do agente para a API via HTTPS
   periódico (a cada lote/arquivo), refletido no banco.
4. **Usuário comum pode iniciar pesquisa e gerar relatório** (Seção 58 itens 6
   e 16). Cancelar pesquisa é exclusivo do Master (Seção 44).
5. **"Auditoria"** foi adicionada como item de menu do Master (consultar logs).
