# Segurança e LGPD

Os XMLs contêm dados pessoais de empregados (nome, CPF, remuneração). As
prioridades do sistema são **segurança**, **confiabilidade** e **facilidade**.

## Autenticação
- Senhas com **Argon2id** (parâmetros OWASP: 19 MiB, t=2, p=1). Nunca em texto puro.
- Senha inicial do Master apenas via `MASTER_INITIAL_PASSWORD` (variável de
  ambiente) — nunca no código, HTML ou JavaScript.
- **JWT de acesso** de 15 min, mantido só em memória no navegador.
- **Refresh token** opaco em cookie `httpOnly` + `Secure` + `SameSite`, com
  **rotação** a cada uso; reutilização de um token antigo revoga toda a sessão.
- O usuário é recarregado do banco a cada requisição: bloqueio tem efeito imediato.
- Usuários **pendentes, rejeitados ou bloqueados** não entram. A situação do
  cadastro só é informada a quem digitou a senha correta (evita enumeração).

## Força bruta e abuso
- Bloqueio temporário da conta após `LOGIN_MAX_ATTEMPTS` (5) senhas erradas por
  `LOGIN_LOCK_MINUTES` (15).
- Rate limiting por IP: global (300/min), login e solicitação de acesso
  (`LOGIN_RATE_LIMIT_PER_MINUTE`), relatórios e downloads em lote.
- Tempo de resposta constante para usuário inexistente.

## Autorização
- Perfis **MASTER** e **USUÁRIO** verificados **no backend** em todas as rotas
  (`requireRole`). Ocultar botões no front é apenas conveniência.
- Usuário comum recebe `403 Forbidden` em empresas (escrita), usuários,
  configurações, auditoria e cancelamento — coberto por testes automatizados.
- Sempre é mantido ao menos um Master ativo.

## Validação, sanitização e caminhos
- Toda entrada é validada com **zod** (tipos, tamanhos, CNPJ, datas).
- SQL sempre parametrizado.
- HTML gerado com escape de todo conteúdo do XML e CSP sem scripts.
- Parser XML recusa declarações `<!ENTITY>` (XXE / "billion laughs") e limita profundidade.
- **Path traversal:** a web nunca informa caminhos. A API trabalha com IDs; o
  nome da pasta da empresa é validado (sem `\ / : * ? " < > |`, sem `..`, sem
  nomes reservados do Windows) na API **e** no agente, que ainda confere se o
  caminho final está dentro de `ROOT_PATH`.
- Caminhos relativos enviados pelo agente também são validados pela API.

## Agente Windows
- Autenticação por `AGENT_API_TOKEN` (comparação em tempo constante).
- **Somente conexões de saída** para a API; HTTPS obrigatório fora de localhost.
- Nenhuma porta aberta, nenhum compartilhamento da unidade `G:`.
- A API recalcula o SHA-256 de todo conteúdo recebido e rejeita divergências.
- Pastas só são criadas com autorização explícita do Master (e apenas um nível
  dentro da raiz). Arquivos do Drive nunca são apagados ou alterados.

## Transporte e cabeçalhos
- HTTPS obrigatório em produção (Cloudflare / plataforma).
- **CORS restrito** a `CORS_ORIGINS`.
- `helmet` na API; `_headers` no Cloudflare Pages (X-Frame-Options, nosniff,
  Referrer-Policy, Permissions-Policy, CSP).
- Downloads com `Cache-Control: no-store`.

## Segredos
- Somente em variáveis de ambiente (`.env` ignorado pelo Git; `.env.example`
  sem valores reais). Inclui JWT, token do agente, SMTP e banco.
- Logs da API ocultam `authorization`, cookies, senhas e conteúdo de XML.
- Gere segredos com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
  e troque-os se houver suspeita de vazamento (trocar `AGENT_API_TOKEN` exige
  atualizar o `.env` do agente).

## LGPD
- Nenhum arquivo é acessível sem autenticação; não existem URLs públicas
  permanentes — downloads exigem token válido e são feitos pelo próprio app.
- Autorização verificada antes de cada download e **todo download é auditado**
  (usuário, data/hora, IP, arquivo, formato).
- O conteúdo dos XML **não é enviado a serviços externos** e **não é processado
  por APIs de IA**. HTML e PDF são gerados localmente pela API.
- Acesso restrito a usuários internos aprovados pelo Master; recomenda-se
  adicionalmente Cloudflare Access no domínio do front.
- Recomendado: banco com criptografia em repouso, na região Brasil, backups
  protegidos e política de retenção definida pelo DP/jurídico.

## Auditoria
Registrados em `audit_logs`: login, falha de login, logout, usuário cadastrado,
aprovado, rejeitado, bloqueado, reativado, editado, troca/redefinição de senha,
empresa cadastrada/editada/ativada/desativada/excluída, verificação e criação de
pastas, pesquisa iniciada/finalizada/cancelada, relatório gerado, download
realizado e alteração de configurações — com usuário, data, hora, IP e detalhes.
