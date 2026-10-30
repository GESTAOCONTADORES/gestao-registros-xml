-- =====================================================================
-- Departamento Pessoal / REGISTROS XML-PDF — esquema inicial
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- Usuários
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name             text        NOT NULL,
  last_name              text        NOT NULL,
  username               text        NOT NULL,
  department             text        NOT NULL,
  password_hash          text        NOT NULL,
  role                   text        NOT NULL DEFAULT 'USER'    CHECK (role IN ('MASTER', 'USER')),
  status                 text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'BLOCKED')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  approved_at            timestamptz,
  approved_by            integer REFERENCES users(id) ON DELETE SET NULL,
  last_login_at          timestamptz,
  failed_login_attempts  integer     NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  password_changed_at    timestamptz
);
CREATE UNIQUE INDEX users_username_uq ON users (lower(username));
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE refresh_tokens (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   char(64)    NOT NULL UNIQUE,
  family_id    text        NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  replaced_by  integer REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  ip           text,
  user_agent   text
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ---------------------------------------------------------------------
-- Empresas
--   "Excluir" = exclusão lógica (deleted_at). Os registros importados e os
--   arquivos em G:\ nunca são apagados.
-- ---------------------------------------------------------------------
CREATE TABLE companies (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  corporate_name     text        NOT NULL,
  trade_name         text        NOT NULL DEFAULT '',
  cnpj               char(14)    NOT NULL,
  folder_name        text        NOT NULL,
  status             text        NOT NULL DEFAULT 'ACTIVE'  CHECK (status IN ('ACTIVE', 'INACTIVE')),
  folder_status      text        NOT NULL DEFAULT 'UNKNOWN' CHECK (folder_status IN ('UNKNOWN', 'FOUND', 'NOT_FOUND')),
  folder_checked_at  timestamptz,
  notes              text        NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deactivated_at     timestamptz,
  deleted_at         timestamptz,
  created_by         integer REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX companies_cnpj_uq ON companies (cnpj) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX companies_folder_uq ON companies (lower(folder_name)) WHERE deleted_at IS NULL;
CREATE INDEX companies_status_idx ON companies (status) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- Fila de trabalhos para o Agente Windows
-- ---------------------------------------------------------------------
CREATE TABLE agent_jobs (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type           text        NOT NULL CHECK (type IN ('SCAN', 'CHECK_FOLDERS', 'CREATE_FOLDER', 'SAVE_REPORT')),
  payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
  created_by     integer REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  result         jsonb,
  error_message  text
);
CREATE INDEX agent_jobs_pending_idx ON agent_jobs (status, created_at);

CREATE TABLE agent_status (
  agent_id         text PRIMARY KEY DEFAULT 'default',
  last_seen_at     timestamptz,
  version          text,
  hostname         text,
  root_path        text,
  reports_path     text,
  root_accessible  boolean,
  last_error       text,
  current_job_id   integer,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Execuções (lotes de pesquisa)
-- ---------------------------------------------------------------------
CREATE TABLE import_runs (
  id                     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requested_by           integer REFERENCES users(id) ON DELETE SET NULL,
  scope                  text        NOT NULL CHECK (scope IN ('ALL', 'ACTIVE', 'SELECTED', 'SINGLE')),
  filters                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  year                   smallint,
  month                  smallint CHECK (month BETWEEN 1 AND 12),
  full_rescan            boolean     NOT NULL DEFAULT false,
  status                 text        NOT NULL DEFAULT 'QUEUED'
                         CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELLED', 'FAILED')),
  total_companies        integer     NOT NULL DEFAULT 0,
  companies_processed    integer     NOT NULL DEFAULT 0,
  total_files            integer     NOT NULL DEFAULT 0,
  files_checked          integer     NOT NULL DEFAULT 0,
  new_files              integer     NOT NULL DEFAULT 0,
  duplicates             integer     NOT NULL DEFAULT 0,
  errors                 integer     NOT NULL DEFAULT 0,
  progress               double precision NOT NULL DEFAULT 0,
  current_company_id     integer REFERENCES companies(id) ON DELETE SET NULL,
  cancel_requested       boolean     NOT NULL DEFAULT false,
  cancel_requested_by    integer REFERENCES users(id) ON DELETE SET NULL,
  error_message          text,
  job_id                 integer REFERENCES agent_jobs(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  started_at             timestamptz,
  finished_at            timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  last_agent_update_at   timestamptz
);
CREATE INDEX import_runs_status_idx ON import_runs (status);
CREATE INDEX import_runs_created_idx ON import_runs (created_at DESC);
-- Apenas uma execução ativa por vez
CREATE UNIQUE INDEX import_runs_single_active_uq ON import_runs ((true)) WHERE status IN ('QUEUED', 'RUNNING');

CREATE TABLE import_run_companies (
  run_id       integer NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  company_id   integer NOT NULL REFERENCES companies(id),
  status       text    NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FOLDER_NOT_FOUND', 'ERROR', 'CANCELLED')),
  total_files  integer NOT NULL DEFAULT 0,
  new_files    integer NOT NULL DEFAULT 0,
  duplicates   integer NOT NULL DEFAULT 0,
  errors       integer NOT NULL DEFAULT 0,
  message      text,
  PRIMARY KEY (run_id, company_id)
);
CREATE INDEX import_run_companies_company_idx ON import_run_companies (company_id);

-- ---------------------------------------------------------------------
-- Registros importados
--   file_hash UNIQUE = principal proteção contra duplicidade.
-- ---------------------------------------------------------------------
CREATE TABLE imported_files (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id           integer     NOT NULL REFERENCES companies(id),
  filename             text        NOT NULL,
  relative_path        text        NOT NULL,
  file_hash            char(64)    NOT NULL,
  file_size            integer     NOT NULL,
  file_modified_at     timestamptz,
  competence           text,
  competence_source    text CHECK (competence_source IN ('XML_PERIOD', 'XML_DATE', 'FILE_DATE')),
  month                smallint CHECK (month BETWEEN 1 AND 12),
  year                 smallint,
  document_type        text,
  document_type_label  text,
  event_code           text,
  document_id          text,
  document_date        text,
  employer_cnpj        text,
  worker_cpf           text,
  worker_name          text,
  protocol             text,
  receipt              text,
  xml_metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  search_text          text        NOT NULL DEFAULT '',
  imported_at          timestamptz NOT NULL DEFAULT now(),
  import_run_id        integer REFERENCES import_runs(id) ON DELETE SET NULL,
  imported_by          integer REFERENCES users(id) ON DELETE SET NULL,
  status               text        NOT NULL DEFAULT 'IMPORTED',
  CONSTRAINT imported_files_file_hash_uq UNIQUE (file_hash)
);
CREATE INDEX imported_files_company_period_idx ON imported_files (company_id, year, month);
CREATE INDEX imported_files_period_idx ON imported_files (year, month);
CREATE INDEX imported_files_imported_at_idx ON imported_files (imported_at DESC);
CREATE INDEX imported_files_run_idx ON imported_files (import_run_id);
CREATE INDEX imported_files_worker_cpf_idx ON imported_files (worker_cpf);
CREATE INDEX imported_files_doc_type_idx ON imported_files (document_type);
CREATE INDEX imported_files_search_trgm_idx ON imported_files USING gin (search_text gin_trgm_ops);

-- Conteúdo original, byte a byte (nunca alterado)
CREATE TABLE imported_file_contents (
  imported_file_id  integer PRIMARY KEY REFERENCES imported_files(id) ON DELETE CASCADE,
  content           bytea NOT NULL
);

-- Histórico de importação: todo arquivo visto em cada execução
CREATE TABLE import_run_files (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id            integer     NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  company_id        integer REFERENCES companies(id),
  filename          text        NOT NULL,
  relative_path     text        NOT NULL,
  file_hash         char(64),
  file_size         integer,
  file_modified_at  timestamptz,
  status            text        NOT NULL CHECK (status IN ('IMPORTED', 'DUPLICATE', 'ERROR')),
  error_message     text,
  imported_file_id  integer REFERENCES imported_files(id) ON DELETE SET NULL,
  year              smallint,
  month             smallint,
  content           bytea,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_run_files_run_status_idx ON import_run_files (run_id, status);
CREATE INDEX import_run_files_company_period_idx ON import_run_files (company_id, year, month);
CREATE INDEX import_run_files_created_idx ON import_run_files (created_at);
CREATE INDEX import_run_files_hash_idx ON import_run_files (file_hash);

-- ---------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  message     text        NOT NULL,
  type        text        NOT NULL DEFAULT 'INFO',
  link        text,
  is_read     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC);

-- ---------------------------------------------------------------------
-- Relatórios
-- ---------------------------------------------------------------------
CREATE TABLE reports (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requested_by  integer REFERENCES users(id) ON DELETE SET NULL,
  filters       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  summary       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  filename      text        NOT NULL,
  drive_path    text,
  drive_status  text        NOT NULL DEFAULT 'PENDING' CHECK (drive_status IN ('PENDING', 'SAVED', 'FAILED')),
  drive_error   text,
  pdf           bytea       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  saved_at      timestamptz
);
CREATE INDEX reports_created_idx ON reports (created_at DESC);

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  entity      text,
  entity_id   text,
  details     jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id);
CREATE INDEX audit_logs_action_idx ON audit_logs (action);

-- ---------------------------------------------------------------------
-- Configurações
-- ---------------------------------------------------------------------
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  integer REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO settings (key, value) VALUES ('email_notifications_enabled', 'true'::jsonb);
