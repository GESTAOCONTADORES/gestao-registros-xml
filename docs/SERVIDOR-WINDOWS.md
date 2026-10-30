# Opção B — Servidor no escritório + Cloudflare Tunnel (passo a passo)

Nesta opção a API e o banco de dados ficam **num computador do escritório**,
o site fica no **Cloudflare Pages** e a ligação entre os dois é feita pelo
**Cloudflare Tunnel**, que é seguro e **não abre portas no roteador**. Os dados
dos empregados não saem da empresa.

```text
Navegador ──https──▶ Cloudflare Pages (site)
     │
     └──https──▶ Cloudflare ══ túnel ══▶ computador do escritório
                                          ├─ API + banco (serviço GestaoXmlApi)
                                          └─ Gestão XML Agent ──▶ G:\ (Google Drive)
```

## Antes da Cloudflare: testar no seu computador (sem conta e sem domínio)
O instalador do servidor também entrega o **site completo** em `http://localhost:3333`.
Dá para testar tudo com os XML reais antes de configurar a Cloudflare:

1. Execute `GestaoXmlServidor-Setup-1.0.0.exe` no computador que tem o Google Drive.
   Deixe o **token do Cloudflare Tunnel em branco** e mantenha marcado
   *Instalar também o Gestão XML Agent*.
2. No instalador do agente (abre sozinho), clique em **Próximo › Instalar**.
3. Abra *Menu Iniciar › Gestão XML Servidor › Abrir o sistema (neste computador)*
   e entre com **Departamento pessoal** e a senha escolhida.
4. Para colegas testarem de outros computadores, use *Criar link de teste
   temporário*. Ele gera um endereço `https://….trycloudflare.com`, que vale enquanto
   a janela estiver aberta e muda a cada vez. Envie só para quem vai testar e
   feche a janela ao terminar.

Quando os testes terminarem, siga os passos abaixo. **Não é preciso reinstalar
nada do zero:** execute o mesmo instalador de novo, informe o endereço do site e
o token do túnel, e os dados dos testes são mantidos. Se quiser começar com a base
limpa, desinstale escolhendo apagar os dados e instale de novo.

## O que você vai precisar
| Item | Observação |
|---|---|
| Computador Windows 10/11 **64 bits** | Fica ligado no expediente. O ideal é ser **o mesmo computador do DP que tem o Google Drive**, porque assim o agente fica junto. |
| Conta gratuita na **Cloudflare** | https://dash.cloudflare.com/sign-up |
| Domínio na Cloudflare | Ex.: `gestaocontadores.com.br` adicionado à conta (*Add a domain*). Se o DNS do domínio estiver em outro provedor, a Cloudflare indica os *nameservers* a trocar. Fale com quem administra o domínio. |
| Repositório no GitHub | `GESTAOCONTADORES/gestao-registros-xml` |
| Os dois instaladores | `GestaoXmlServidor-Setup-1.0.0.exe`, que já inclui o do agente. Gerados pelo GitHub Actions (aba *Actions › Instaladores › Artifacts*) ou com `npm run installer -w @gestao/api`. |

Nos exemplos abaixo usamos:
- API: `https://api-registros.gestaocontadores.com.br`
- Site: `https://gestao-registros-xml.pages.dev`, com domínio próprio opcional (`https://registros.gestaocontadores.com.br`)

---

## Passo 1 — Criar o túnel na Cloudflare (5 min)
1. Painel da Cloudflare › **Zero Trust** › **Networks** › **Tunnels** › **Create a tunnel**.
2. Tipo **Cloudflared** › nome `gestao-xml` › **Save tunnel**.
3. Em *Install and run a connector*, escolha **Windows** e **copie o comando**
   exibido (`cloudflared.exe service install eyJ...`). **Não execute.** O
   instalador do servidor faz isso. Clique em **Next**.
4. Em **Public hostnames**:
   - *Subdomain*: `api-registros` · *Domain*: `gestaocontadores.com.br`
   - *Service*: **Type** `HTTP` · **URL** `127.0.0.1:3333`
     > Use `127.0.0.1`, e não `localhost`: a API escuta apenas no endereço IPv4 local.
5. **Save hostname**.

## Passo 2 — Publicar o site no Cloudflare Pages (5 min)
1. **Workers & Pages** › **Create** › **Pages** › **Connect to Git** › escolha o
   repositório `gestao-registros-xml`.
2. Nome do projeto: `gestao-registros-xml`. O site fica em `https://gestao-registros-xml.pages.dev`.
3. Configuração de build:

   | Campo | Valor |
   |---|---|
   | Framework preset | None |
   | Build command | `npm ci && npm run build:web` |
   | Build output directory | `apps/web/dist` |
   | Variáveis | `NODE_VERSION` = `22` · `VITE_API_URL` = `https://api-registros.gestaocontadores.com.br` |

4. **Save and Deploy**. Opcional: em *Custom domains*, adicione
   `registros.gestaocontadores.com.br`.

## Passo 3 — Instalar o servidor (5 min)
No computador do escritório, com um usuário **administrador**:
1. Execute `GestaoXmlServidor-Setup-1.0.0.exe`. Se aparecer *"O Windows
   protegeu o computador"*, clique em *Mais informações › Executar assim mesmo*.
2. Na tela **Configuração do servidor**:
   - **Senha inicial do Master**: vem `DP102030`; troque se quiser.
   - **Endereço do site**: `https://gestao-registros-xml.pages.dev`. Se usar
     domínio próprio, informe os dois separados por vírgula.
   - **Token do Cloudflare Tunnel**: cole o comando copiado no Passo 1.
   - Deixe marcado **Instalar também o Gestão XML Agent neste computador**, se
     for o computador com o Google Drive.
3. **Instalar**. Ao final aparecem:
   - "OK: API em funcionamento" e "OK: Cloudflare Tunnel instalado";
   - o **TOKEN DO AGENTE**. Ele também fica salvo em *Menu Iniciar › Gestão XML
     Servidor › Dados de acesso*.

O que foi instalado:
- serviço do Windows **GestaoXmlApi**, que inicia com o Windows e reinicia sozinho;
- serviço **Cloudflared**, que mantém o túnel;
- dados, configuração, logs e **backups diários (30 dias)** em
  `C:\ProgramData\GestaoXmlServidor`, acessíveis só por administradores.

## Passo 4 — Instalar o agente
- **No mesmo computador:** o instalador do agente abre sozinho, já preenchido
  com `http://localhost:3333` e o token. Basta clicar em **Próximo › Instalar**,
  com o Google Drive aberto.
- **Em outro computador** (o que tem o Google Drive): execute
  *Menu Iniciar › Gestão XML Servidor › Instalador do Agente* (copie o arquivo)
  e informe:
  - Endereço da API: `https://api-registros.gestaocontadores.com.br`
  - Token: o do Passo 3

## Passo 5 — Primeiro acesso
1. Abra `https://gestao-registros-xml.pages.dev`.
2. Entre com **Departamento pessoal** e a senha do Passo 3. Troque a senha em
   *menu do usuário › Alterar senha*.
3. Confira no topo: **Agente XML ● Online**.
4. *Empresas › + Nova Empresa*: cadastre os clientes com o nome exato da pasta.
5. *Pesquisar arquivos › INICIAR PESQUISA*.

---

## Dia a dia (Menu Iniciar › Gestão XML Servidor)
| Atalho | Para quê |
|---|---|
| Status do servidor | Mostra se a API e o túnel estão rodando |
| Reiniciar servidor | Depois de editar a configuração |
| Fazer backup agora | Backup extra, por exemplo antes de uma atualização |
| Restaurar backup | Volta o banco para um backup. O banco atual é guardado e nada é trocado se o arquivo for inválido. |
| Editar configuração | E-mail (SMTP), endereços do site etc. |
| Dados de acesso | Token do agente e endereços |
| Abrir o sistema (neste computador) | Site em `http://localhost:3333` |
| Criar link de teste temporário | Endereço público temporário para testes (fechar a janela encerra) |
| Abrir logs | Registros técnicos da API |

**E-mail das solicitações de acesso:** em *Editar configuração*, preencha
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` e
`DP_APPROVAL_EMAIL`, depois *Reiniciar servidor*.

**Atualizar o sistema:** execute o novo `GestaoXmlServidor-Setup.exe`. Dados,
senha e token são mantidos. O site atualiza sozinho a cada envio ao GitHub.

**Backups fora do computador (recomendado):** copie periodicamente a pasta
`C:\ProgramData\GestaoXmlServidor\backups` para um disco externo ou um local
seguro. Os backups contêm dados pessoais (LGPD): guarde com acesso restrito.

## Problemas comuns
| Sintoma | Solução |
|---|---|
| Site mostra erro ao entrar / "Origem não autorizada" | O endereço do site não está em `CORS_ORIGINS`. Ajuste em *Editar configuração* (separe por vírgula) e reinicie. |
| Erro 502/1033 ao acessar a API | Túnel parado ou endereço errado no painel: confira *Status do servidor* e se o Service está `HTTP 127.0.0.1:3333`. |
| Agente Offline | No computador do agente: *Menu Iniciar › Gestão XML Agent › Testar conexão*. |
| Precisa trocar o token do agente | Edite `AGENT_API_TOKEN` em *Editar configuração*, reinicie e reinstale o agente com o novo token. |
| Computador será trocado | Instale o servidor no novo computador, copie um backup para `C:\ProgramData\GestaoXmlServidor\backups`, use *Restaurar backup* e, no painel da Cloudflare, gere o comando do túnel para o novo computador. |
