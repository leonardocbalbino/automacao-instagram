# Automação de Instagram

Agenda e publica posts e responde automaticamente quem comenta palavras-chave, enviando link ou material por DM. Usa só a API oficial da Meta (Instagram API com Instagram Login, host `graph.instagram.com`), sem login simulado nem raspagem.

## O que tem

- **Agendador:** imagem, carrossel, reel e story, com fila por horário, checagem de `content_publishing_limit`, publicação em duas etapas (container → publish) e até 3 retentativas.
- **Comentário → DM:** resposta pública opcional (com variações) e uma resposta privada por comentário. A trava é `comment_events.comment_id UNIQUE` com `ON CONFLICT DO NOTHING`.
- **Material após resposta:** se a pessoa responde a primeira DM (ou toca no botão), abre a janela de 24h e o sistema manda o material.
- **Siga para receber:** botão "Já sigo" que confere `is_user_follow_business` antes de mandar o link.
- **DM e story:** palavras-chave por DM e respostas ou reações a stories passam pelo mesmo motor de regras.
- **Painel:** contas, fila de posts, automações, histórico, links curtos com contagem de cliques e funil comentários → DMs → cliques.
- **Segurança:** validação de `X-Hub-Signature-256`, tokens cifrados com AES-256-GCM, renovação diária do token longo, rate limiter de 750/h por conta, jitter entre envios, callbacks de desautorização e exclusão de dados (LGPD), alertas de taxa de erro e de fila acima de 1.000 itens, Bull Board em `/admin/queues`.

## Arquitetura

```
Painel React ─► API Node (Express) ─► Postgres
                     │
Meta ─webhook─► /webhooks/instagram ─► Redis/BullMQ ─► workers ─► Graph API
                                                       ├─ webhooks  (motor de regras)
                                                       ├─ send-<conta> (envios, 750/h)
                                                       ├─ posts     (publicação agendada)
                                                       └─ maintenance (tokens, alertas)
```

O receptor de webhooks só valida e enfileira; todo envio à Meta sai dos workers.

## Rodar localmente

Requisitos: Node 20+, Postgres e Redis.

```bash
cd server && npm install
cp ../.env.example .env   # preencha DATABASE_URL, REDIS_URL, JWT_SECRET, TOKEN_ENCRYPTION_KEY
node --env-file=.env src/index.js          # API + migrações (porta 3000)
node --env-file=.env src/workers/index.js  # workers
npm test

cd ../web && npm install && npm run dev    # painel em http://localhost:5173
```

## Deploy na VPS

Com um domínio apontando (registro A) para a VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/leonardocbalbino/automacao-instagram/main/deploy/setup-vps.sh -o setup-vps.sh
sudo bash setup-vps.sh insta.seudominio.com.br
```

O script instala Docker, libera as portas 80 e 443, clona o repo em `/opt/automacao-instagram`, gera o `.env` com segredos aleatórios e sobe Postgres, Redis, API, worker e Caddy (o Caddy cuida do HTTPS automático). Depois disso:

1. Preencha `IG_APP_ID` e `IG_APP_SECRET` no `.env` e rode `docker compose up -d`.
2. Para atualizar a VPS depois: `bash deploy/deploy.sh`.

## Configuração no Meta for Developers

1. Crie um app do tipo Business e adicione o produto **Instagram → API setup with Instagram login**.
2. Em **Business login settings**, cadastre a URL de redirecionamento `https://SEU_DOMINIO/oauth/instagram/callback`.
3. Em **Webhooks**: callback `https://SEU_DOMINIO/webhooks/instagram`, verify token igual a `IG_WEBHOOK_VERIFY_TOKEN`. Assine `comments`, `live_comments`, `messages` e `messaging_postbacks`.
4. Desautorização: `https://SEU_DOMINIO/meta/deauthorize`. Exclusão de dados: `https://SEU_DOMINIO/meta/data-deletion`. Política de privacidade: `https://SEU_DOMINIO/privacidade`.
5. Adicione a conta `@icod_developers` como testadora (App roles → Roles → Instagram Testers) e aceite o convite no Instagram.
6. No painel, abra **Contas → Conectar conta**.

Para usar com contas que não são testadoras, o app precisa passar no App Review com as permissões `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments` e `instagram_business_manage_messages`.

## Regras da Meta que o sistema respeita

| Regra | Como o sistema trata |
|---|---|
| 100 publicações por 24h | Consulta `content_publishing_limit`; se estourou, adia 1h sem gastar retentativa |
| 1 resposta privada por comentário, até 7 dias | Trava por `comment_id`; acima de 7 dias o evento vira `expirado` |
| Janela de 24h para DM | `conversations.ultima_msg_usuario_em`; envios fora da janela são bloqueados e registrados |
| 750 respostas por hora (fonte não oficial) | Rate limiter na fila `send-<conta>` |
| Sem DM fria | Só responde quem comentou ou mandou mensagem |

## Variáveis no texto das DMs

- `{link}`: link curto com contagem de cliques (`/l/<slug>`).
- `{username}`: @ de quem comentou.
