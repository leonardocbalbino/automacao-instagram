CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  papel         TEXT NOT NULL DEFAULT 'membro' CHECK (papel IN ('admin', 'membro')),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ig_accounts (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ig_user_id       TEXT NOT NULL UNIQUE,
  username         TEXT NOT NULL,
  access_token     TEXT NOT NULL,             -- cifrado com AES-256-GCM
  token_expira_em  TIMESTAMPTZ,
  token_renovado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'expirando', 'expirada', 'desconectada')),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id             BIGSERIAL PRIMARY KEY,
  account_id     BIGINT NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('imagem', 'carrossel', 'reel', 'story')),
  legenda        TEXT NOT NULL DEFAULT '',
  media_urls     JSONB NOT NULL DEFAULT '[]',  -- [{ "url": "...", "kind": "image"|"video" }]
  agendado_para  TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'agendado', 'publicando', 'publicado', 'falhou')),
  ig_media_id    TEXT,
  permalink      TEXT,
  erro           TEXT,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  publicado_em   TIMESTAMPTZ
);
CREATE INDEX posts_status_agendado_idx ON posts (status, agendado_para);

CREATE TABLE automations (
  id          BIGSERIAL PRIMARY KEY,
  account_id  BIGINT NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  gatilho     TEXT NOT NULL CHECK (gatilho IN ('comentario', 'dm', 'story')),
  escopo      TEXT NOT NULL DEFAULT 'todos' CHECK (escopo IN ('todos', 'lista')),
  media_ids   TEXT[] NOT NULL DEFAULT '{}',   -- usado quando escopo = 'lista'
  post_id     BIGINT REFERENCES posts(id) ON DELETE SET NULL, -- regra ativada quando o post agendado publicar
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX automations_account_idx ON automations (account_id, gatilho) WHERE ativo;

CREATE TABLE automation_keywords (
  id             BIGSERIAL PRIMARY KEY,
  automation_id  BIGINT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  palavra        TEXT NOT NULL,               -- normalizada: minúsculas, sem acento
  modo           TEXT NOT NULL DEFAULT 'contem' CHECK (modo IN ('exata', 'contem'))
);
CREATE INDEX automation_keywords_palavra_idx ON automation_keywords (palavra);

CREATE TABLE links (
  id             BIGSERIAL PRIMARY KEY,
  automation_id  BIGINT REFERENCES automations(id) ON DELETE CASCADE,
  url_destino    TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  cliques        INTEGER NOT NULL DEFAULT 0,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tipo: resposta_publica | dm | botao | exigir_seguir | material
CREATE TABLE automation_actions (
  id             BIGSERIAL PRIMARY KEY,
  automation_id  BIGINT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  ordem          INTEGER NOT NULL DEFAULT 0,
  tipo           TEXT NOT NULL CHECK (tipo IN ('resposta_publica', 'dm', 'botao', 'exigir_seguir', 'material')),
  conteudo       JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE comment_events (
  id              BIGSERIAL PRIMARY KEY,
  account_id      BIGINT NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  comment_id      TEXT NOT NULL UNIQUE,       -- trava de idempotência: uma DM por comentário
  origem          TEXT NOT NULL DEFAULT 'comentario' CHECK (origem IN ('comentario', 'live')),
  ig_media_id     TEXT,
  autor_igsid     TEXT,
  autor_username  TEXT,
  texto           TEXT,
  automation_id   BIGINT REFERENCES automations(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'recebido',
  -- recebido | ignorado | proprio | na_fila | aguardando_seguir | dm_enviada | material_enviado | expirado | falhou
  erro            TEXT,
  recebido_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  respondido_em   TIMESTAMPTZ
);
CREATE INDEX comment_events_account_recebido_idx ON comment_events (account_id, recebido_em DESC);
CREATE INDEX comment_events_autor_idx ON comment_events (account_id, autor_igsid, status);

CREATE TABLE conversations (
  id                     BIGSERIAL PRIMARY KEY,
  account_id             BIGINT NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  igsid                  TEXT NOT NULL,
  username               TEXT,
  ultima_msg_usuario_em  TIMESTAMPTZ,
  segue_conta            BOOLEAN,
  criado_em              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, igsid)
);

CREATE TABLE messages_log (
  id               BIGSERIAL PRIMARY KEY,
  account_id       BIGINT NOT NULL REFERENCES ig_accounts(id) ON DELETE CASCADE,
  conversation_id  BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
  comment_event_id BIGINT REFERENCES comment_events(id) ON DELETE SET NULL,
  direcao          TEXT NOT NULL CHECK (direcao IN ('entrada', 'saida')),
  tipo             TEXT NOT NULL,             -- texto | resposta_privada | resposta_publica | botao | postback | story_reply | story_reacao | material
  conteudo         JSONB NOT NULL DEFAULT '{}',
  ig_mid           TEXT UNIQUE,               -- dedup de webhooks de mensagem
  link_id          BIGINT REFERENCES links(id) ON DELETE SET NULL,
  enviado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  erro             TEXT
);
CREATE INDEX messages_log_account_idx ON messages_log (account_id, enviado_em DESC);

CREATE TABLE data_deletion_requests (
  id                 BIGSERIAL PRIMARY KEY,
  confirmation_code  TEXT NOT NULL UNIQUE,
  ig_user_id         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'concluido',
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
);
