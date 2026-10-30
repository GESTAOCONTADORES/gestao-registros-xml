# Departamento Pessoal / REGISTROS XML-PDF

Sistema interno da **Gestão Contadores** para pesquisar, catalogar, processar e
disponibilizar os arquivos XML da pasta compartilhada do Departamento Pessoal,
sem importar duas vezes o mesmo arquivo, com dashboard, relatórios em PDF,
notificações e auditoria.

```text
Navegador (Cloudflare Pages)  →  API (Node/Fastify)  →  PostgreSQL
                                        ↑
                Gestão XML Agent (Windows) — conexão de SAÍDA, token próprio
                                        ↓
     G:\Drives compartilhados\Departamento Pessoal\REGISTROS ROBO XML - PDF
```

O sistema web **nunca** acessa `G:\`. Quem lê a pasta é o **Gestão XML Agent**,
instalado num computador do DP que tem o Google Drive montado.
Arquitetura, modelo de dados e riscos: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

| Pasta | Conteúdo |
|---|---|
| `apps/web` | Front-end React + TypeScript + Vite + Tailwind (Cloudflare Pages) |
| `apps/api` | API Node.js + TypeScript + Fastify |
| `apps/windows-agent` | Gestão XML Agent (Windows) |
| `packages/shared` | Tipos, validações e utilitários comuns |
| `packages/database` | Migrations SQL, conexão, seed do Master |
| `packages/xml-parser` | Leitura tolerante de XML (eSocial, NF-e, genéricos) |
| `docs/` | Guias de instalação, agente, Cloudflare, banco e segurança |

---

## 1. Ambiente de desenvolvimento

### Pré-requisitos
- **Node.js 20 ou superior** (recomendado 22 LTS) — https://nodejs.org
- Git
- (Opcional) Docker, para usar PostgreSQL em container

### 1.1 Instalar dependências
```bash
git clone <url-do-repositorio> gestao-registros-xml
cd gestao-registros-xml
npm install
```

### 1.2 Configurar o `.env`
```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/windows-agent/.env.example apps/windows-agent/.env
```
No `.env` da raiz, troque pelo menos `JWT_ACCESS_SECRET` e `AGENT_API_TOKEN`
(gere valores aleatórios com o comando abaixo) e coloque o **mesmo**
`AGENT_API_TOKEN` no `apps/windows-agent/.env`.
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 1.3 Criar o banco
Duas opções:

- **Sem instalar nada (padrão):** `DATABASE_URL=pglite://./data/pglite` usa um
  PostgreSQL embutido gravado em `./data` (ignorado pelo Git).
- **PostgreSQL real:**
  ```bash
  docker compose up -d db
  ```
  e no `.env`: `DATABASE_URL=postgres://gestao:gestao_dev_somente_local@localhost:5432/gestao_xml`

### 1.4 Executar migrations e criar o Master
```bash
npm run db:migrate
npm run db:seed
```
O seed cria **somente** o usuário Master (`MASTER_NAME`, senha de
`MASTER_INITIAL_PASSWORD`, gravada apenas como hash Argon2id). Nenhuma empresa
fictícia é criada. A API também executa migrations e seed automaticamente ao
iniciar (`AUTO_MIGRATE=true`).

### 1.5 Iniciar o backend
```bash
npm run dev:api          # http://localhost:3333  (GET /health)
```

### 1.6 Iniciar o frontend
```bash
npm run dev:web          # http://localhost:5173
```
Login inicial: usuário **Departamento pessoal**, senha definida em
`MASTER_INITIAL_PASSWORD`. Troque a senha em *menu do usuário → Alterar senha*.

### 1.7 Iniciar o agente
Em desenvolvimento (Linux/macOS/Windows), aponte `ROOT_PATH` do
`apps/windows-agent/.env` para uma pasta de testes com subpastas de empresas:
```bash
npm run dev:agent
```
Em poucos segundos o topo do sistema mostra **Agente XML ● Online**.

### 1.8 Testes e verificação
```bash
npm test                 # parser, API, permissões, agente e fluxo completo
npm run typecheck
npm run build
```
Para rodar a suíte contra um PostgreSQL real:
`TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/postgres npm test`.

Testes obrigatórios cobertos (Seção 56): duplicidade (*1 importado / 1 ignorado*),
empresa inativa fora do lote automático, `403 Forbidden` para usuário comum em
endpoints administrativos, XML inválido sem interromper o lote, agente offline
com mensagem compreensível, login pendente e rejeitado bloqueados, relatório PDF
criado, registrado e salvo em `RELATORIOS ROBO`.

---

## 2. Produção

Resumo (detalhes em [docs/INSTALACAO.md](docs/INSTALACAO.md)):

1. **GitHub** — versione este repositório (o `.gitignore` já exclui `.env`,
   bancos locais, logs e builds). O workflow `.github/workflows/ci.yml` roda
   typecheck, testes e build a cada push.
2. **Banco PostgreSQL** — gerenciado (Neon, Supabase, RDS, Azure…), de
   preferência na região Brasil, com backup e criptografia em repouso.
   Ver [docs/BANCO-DE-DADOS.md](docs/BANCO-DE-DADOS.md).
3. **API** — container Docker (`apps/api/Dockerfile`) em VM/Render/Railway/Fly,
   ou no servidor interno exposto por **Cloudflare Tunnel**. HTTPS obrigatório.
4. **Cloudflare Pages** — publica `apps/web`. Ver [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).
5. **Windows Agent** — instalado no computador do DP com o Google Drive.
   Ver [docs/AGENTE-WINDOWS.md](docs/AGENTE-WINDOWS.md).
6. **Logo oficial** — copie o arquivo fornecido para
   `apps/web/public/assets/logo-gestao-contadores.png` (e aponte `LOGO_PATH`
   da API para ele, para os PDFs). Nenhuma logo foi criada ou redesenhada.

### Windows — instalador do agente
```bash
npm run installer -w @gestao/windows-agent   # requer NSIS (sudo apt-get install nsis)
```
Gera `apps/windows-agent/release/GestaoXmlAgent-Setup-1.0.0.exe`: um único
arquivo, com Node.js embutido e sem exigir administrador. Ele pede o endereço da
API, o token e a pasta, testa a conexão e deixa o agente iniciando sozinho a
cada logon. O GitHub Actions também gera esse arquivo (workflow *Instalador do agente*).
Instalação manual (Tarefa Agendada ou Windows Service): `npm run package -w @gestao/windows-agent`.
Detalhes em [docs/AGENTE-WINDOWS.md](docs/AGENTE-WINDOWS.md).

---

## 3. Configurações externas pendentes

| Item | Onde configurar |
|---|---|
| Logo oficial | `apps/web/public/assets/logo-gestao-contadores.png` |
| SMTP e destinatário das aprovações | `SMTP_*` e `DP_APPROVAL_EMAIL` no `.env` da API |
| Domínios (front e API) e CORS | `CORS_ORIGINS`, `APP_PUBLIC_URL`, `VITE_API_URL`, cookies (`COOKIE_*`) |
| Token do agente | `AGENT_API_TOKEN` (API e agente, mesmo valor) |
| Caminho da pasta | `ROOT_PATH` no `.env` do agente (o sistema web nunca define caminhos) |

## 4. Documentação
- [docs/ARQUITETURA.md](docs/ARQUITETURA.md) — arquitetura, fluxo, modelo, riscos
- [docs/INSTALACAO.md](docs/INSTALACAO.md) — instalação passo a passo
- [docs/AGENTE-WINDOWS.md](docs/AGENTE-WINDOWS.md) — agente, serviço, logs, cache
- [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) — publicação no Cloudflare
- [docs/BANCO-DE-DADOS.md](docs/BANCO-DE-DADOS.md) — tabelas, índices, backup
- [docs/SEGURANCA.md](docs/SEGURANCA.md) — segurança e LGPD
