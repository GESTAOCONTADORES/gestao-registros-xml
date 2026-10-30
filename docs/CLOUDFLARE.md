# Publicação no Cloudflare

## Visão geral
| Parte | Onde roda |
|---|---|
| Front-end (`apps/web`) | **Cloudflare Pages** |
| API (`apps/api`) | Container Node.js (VM, Render, Railway, Fly…) **ou** servidor interno exposto por **Cloudflare Tunnel** |
| Banco | PostgreSQL gerenciado ou interno |
| Agente | Computador Windows do DP (conexão de saída para a API) |

O Cloudflare **nunca** acessa `G:\`. A API também não: quem lê a pasta é o agente.

A API não roda dentro do Cloudflare Workers porque usa recursos de Node.js
(Argon2id nativo, geração de PDF, ZIP em streaming, conexões PostgreSQL
persistentes). Se no futuro desejar Workers, a API precisaria ser adaptada
(Hono + Hyperdrive + R2); a comunicação com o agente continuaria idêntica.

## 1. Domínios recomendados
Use subdomínios do **mesmo domínio**, por exemplo:
- `registros.gestaocontadores.com.br` → Cloudflare Pages (front)
- `api-registros.gestaocontadores.com.br` → API

Assim o cookie do refresh token funciona com `COOKIE_SAMESITE=lax` (mais seguro).
Com domínios diferentes (ex.: `*.pages.dev`), use `COOKIE_SAMESITE=none` e
`COOKIE_SECURE=true`.

## 2. Cloudflare Pages (front-end)
1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**
   e selecione o repositório no GitHub.
2. Configuração de build:

   | Campo | Valor |
   |---|---|
   | Framework preset | None |
   | Build command | `npm ci && npm run build:web` |
   | Build output directory | `apps/web/dist` |
   | Root directory | *(vazio — raiz do repositório)* |
   | Variável `NODE_VERSION` | `22` |
   | Variável `VITE_API_URL` | `https://api-registros.gestaocontadores.com.br` |

3. **Custom domains** → adicione `registros.gestaocontadores.com.br`.
4. Os arquivos `apps/web/public/_redirects` (rotas do SPA) e
   `apps/web/public/_headers` (cabeçalhos de segurança) são publicados
   automaticamente. Ajuste o `connect-src` do `_headers` para o domínio real da API.
5. Restrinja o acesso ao uso interno (recomendado): **Zero Trust → Access →
   Applications** → proteja o domínio do front exigindo e-mail
   `@gestaocontadores.com.br` (ou a rede do escritório). Isso soma uma camada ao
   login do próprio sistema.

## 3. API via Cloudflare Tunnel (servidor interno)
```bash
cloudflared tunnel login
cloudflared tunnel create gestao-xml-api
cloudflared tunnel route dns gestao-xml-api api-registros.gestaocontadores.com.br
```
`~/.cloudflared/config.yml`:
```yaml
tunnel: gestao-xml-api
credentials-file: /caminho/<id>.json
ingress:
  - hostname: api-registros.gestaocontadores.com.br
    service: http://localhost:3333
  - service: http_status:404
```
```bash
cloudflared service install
```
Na API: `TRUST_PROXY=true`, `CORS_ORIGINS=https://registros.gestaocontadores.com.br`.

> Atenção a regras de cache: a API envia `Cache-Control: no-store`. Não crie
> regras de cache para o domínio da API. O progresso usa Server-Sent Events,
> que funcionam pelo Tunnel/proxy do Cloudflare.

## 4. API em plataforma de containers
Use `apps/api/Dockerfile` (contexto = raiz do repositório), porta `3333`,
health check `GET /health` e as variáveis de [INSTALACAO.md](INSTALACAO.md).
Aponte o DNS da API (proxy laranja do Cloudflare ligado) para a plataforma.

## 5. Checklist final
- [ ] `https://<api>/health` responde `{"ok":true}`
- [ ] Front abre e o login funciona (sem erro de CORS no console)
- [ ] Atualizar a página mantém a sessão (cookie de refresh OK)
- [ ] Agente aparece **Online**
- [ ] Pesquisa mostra progresso em tempo real
