# Instalação em produção

Ordem recomendada: **banco → API → front-end → agente**. Cada etapa tem uma
verificação simples antes de seguir.

## 1. Banco de dados (PostgreSQL 14+)

1. Crie um banco `gestao_xml` e um usuário próprio (não use o superusuário):
   ```sql
   CREATE USER gestao WITH PASSWORD 'senha-forte';
   CREATE DATABASE gestao_xml OWNER gestao;
   ```
2. A extensão `pg_trgm` é usada para a busca rápida. Em bancos gerenciados ela
   já vem disponível; se o usuário da aplicação não puder criá-la, rode uma vez
   como administrador: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
3. Anote a URL: `postgres://gestao:senha@host:5432/gestao_xml`. Se o provedor
   exigir SSL, use `DATABASE_SSL=true`.

✔ Verificação: `psql "<url>" -c "select 1"`.

## 2. API

### 2.1 Variáveis de ambiente (produção)

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | URL do passo 1 |
| `JWT_ACCESS_SECRET` | 48+ caracteres aleatórios |
| `AGENT_API_TOKEN` | 48+ caracteres aleatórios (o mesmo vai no agente) |
| `MASTER_NAME` / `MASTER_INITIAL_PASSWORD` | `"Departamento pessoal"` / senha inicial |
| `CORS_ORIGINS` | `https://registros.seudominio.com.br` (endereço do front) |
| `APP_PUBLIC_URL` | o mesmo endereço do front (links nos e-mails) |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAMESITE` | `lax` se front e API forem subdomínios do mesmo domínio; `none` caso contrário |
| `TRUST_PROXY` | `true` atrás de Cloudflare/proxy |
| `SMTP_*`, `DP_APPROVAL_EMAIL` | servidor de e-mail e destinatário das solicitações |
| `LOGO_PATH` | caminho do arquivo oficial da logo (PDFs) |

### 2.2 Opção A — Docker (VM, Render, Railway, Fly, Azure…)
```bash
docker build -f apps/api/Dockerfile -t gestao-xml-api .
docker run -d --name gestao-xml-api --env-file .env -p 3333:3333 \
  -v /caminho/da/logo:/app/assets:ro -e LOGO_PATH=/app/assets/logo-gestao-contadores.png \
  gestao-xml-api
```
Coloque um proxy HTTPS na frente (Cloudflare, Caddy, Nginx) ou use o HTTPS da
própria plataforma.

### 2.3 Opção B — servidor interno + Cloudflare Tunnel
Útil para manter API e banco dentro da rede da empresa (LGPD), sem abrir portas:
```bash
npm ci && npm run build -w @gestao/api
cd apps/api && node --env-file=../../.env dist/index.js
cloudflared tunnel --url http://localhost:3333   # ou túnel nomeado: api.seudominio.com.br
```
Para manter a API rodando no Windows Server, use NSSM ou o mesmo padrão de
serviço do agente; no Linux, um serviço `systemd`.

Na inicialização a API aplica as migrations e cria o Master (se ainda não existir).

✔ Verificação: `https://api.seudominio.com.br/health` responde `{"ok":true}`.

## 3. Front-end (Cloudflare Pages)
Siga [CLOUDFLARE.md](CLOUDFLARE.md). Variável obrigatória: `VITE_API_URL`.

✔ Verificação: abrir o endereço, entrar com **Departamento pessoal** e a senha
inicial; trocar a senha em *Alterar senha*.

## 4. Agente Windows
Siga [AGENTE-WINDOWS.md](AGENTE-WINDOWS.md).

✔ Verificação: o topo do sistema mostra **Agente XML ● Online** e, em
*Configurações*, o caminho monitorado aparece com a pasta acessível.

## 5. Primeiros passos no sistema
1. *Empresas → + Nova Empresa* para cada cliente, com o **nome exato da pasta**.
   O agente verifica e mostra *Pasta encontrada* / *Pasta não encontrada*.
   Use *Verificar pastas* para listar pastas que existem no Drive mas ainda
   não estão cadastradas.
2. *Pesquisar arquivos → INICIAR PESQUISA* com o mês/ano desejado.
3. Acompanhe a barra de progresso; ao final, consulte *Registros* e gere o
   relatório em *Relatórios* (salvo automaticamente em `RELATORIOS ROBO`).
4. Aprove os colegas em *Usuários* conforme as solicitações chegarem.

## 6. Atualizações
```bash
git pull && npm ci && npm test && npm run build
```
Republique a API (as migrations novas são aplicadas sozinhas), o front
(Cloudflare faz isso a cada push) e, se o agente mudou, gere o pacote novo
(`npm run package -w @gestao/windows-agent`) e substitua `dist\agent.cjs` no
computador do DP, reiniciando a tarefa/serviço.
