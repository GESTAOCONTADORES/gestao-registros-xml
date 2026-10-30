# Banco de dados

- **Produção:** PostgreSQL 14+ (`DATABASE_URL=postgres://...`).
- **Desenvolvimento/testes:** PGlite — PostgreSQL real compilado em WebAssembly
  (`DATABASE_URL=pglite://./data/pglite` ou `pglite://memory`). Mesmo SQL de
  produção, nada para instalar. (Foi usado no lugar do SQLite opcional para
  evitar diferenças de dialeto.)
- Migrations versionadas em `packages/database/migrations/*.sql`, controladas
  pela tabela `schema_migrations`. Aplicadas com `npm run db:migrate` ou
  automaticamente quando a API inicia.

## Tabelas

### `users`
`id, first_name, last_name, username (único, sem diferenciar maiúsculas), department,
password_hash (Argon2id), role (MASTER|USER), status (PENDING|ACTIVE|REJECTED|BLOCKED),
created_at, updated_at, approved_at, approved_by, last_login_at,
failed_login_attempts, locked_until, password_changed_at`

### `refresh_tokens`
Somente o **hash** SHA-256 do token. `family_id` permite revogar toda a cadeia
quando um token antigo é reutilizado.

### `companies`
`id, corporate_name, trade_name, cnpj, folder_name, status (ACTIVE|INACTIVE),
folder_status (UNKNOWN|FOUND|NOT_FOUND), folder_checked_at, notes, created_at,
updated_at, deactivated_at, deleted_at, created_by`
- CNPJ e nome de pasta únicos entre empresas não excluídas.
- **Excluir** = exclusão lógica (`deleted_at`): registros importados permanecem
  e nenhum arquivo do Drive é tocado.

### `import_runs` (execuções / lotes)
`id, requested_by, scope (ALL|ACTIVE|SELECTED|SINGLE), filters, year, month,
full_rescan, status (QUEUED|RUNNING|COMPLETED|COMPLETED_WITH_ERRORS|CANCELLED|FAILED),
total_companies, companies_processed, total_files, files_checked, new_files,
duplicates, errors, progress, current_company_id, cancel_requested,
cancel_requested_by, error_message, job_id, created_at, started_at, finished_at,
updated_at, last_agent_update_at`
- Índice único parcial garante **uma execução ativa por vez**.

### `import_run_companies`
Progresso e totais de cada empresa dentro da execução.

### `import_run_files` (histórico por arquivo)
Cada arquivo visto em cada execução: `run_id, company_id, filename, relative_path,
file_hash, file_size, file_modified_at, status (IMPORTED|DUPLICATE|ERROR),
error_message, imported_file_id, year, month, content (somente para erros), created_at`.

### `imported_files` (registros)
`id, company_id, filename, relative_path, file_hash, file_size, file_modified_at,
competence, competence_source, month, year, document_type, document_type_label,
event_code, document_id, document_date, employer_cnpj, worker_cpf, worker_name,
protocol, receipt, xml_metadata (JSONB), search_text, imported_at, import_run_id,
imported_by, status`
- **`CONSTRAINT imported_files_file_hash_uq UNIQUE (file_hash)`** — a principal
  proteção contra duplicidade. A inserção usa `ON CONFLICT (file_hash) DO NOTHING`:
  um registro existente **nunca** é substituído.

### `imported_file_contents`
`imported_file_id, content (BYTEA)` — o XML original byte a byte.

### `agent_jobs`, `agent_status`
Fila de trabalhos API → agente (`SCAN`, `CHECK_FOLDERS`, `CREATE_FOLDER`,
`SAVE_REPORT`) e último heartbeat do agente.

### `notifications`, `reports`, `audit_logs`, `settings`
Central de notificações por usuário; relatórios (filtros, resumo, PDF, caminho no
Drive e situação da gravação); auditoria (usuário, ação, entidade, IP,
user-agent, detalhes, data/hora); configurações.

## Índices principais
| Índice | Uso |
|---|---|
| `imported_files (file_hash)` UNIQUE | deduplicação |
| `imported_files (company_id, year, month)` | filtros por empresa e competência |
| `imported_files USING gin (search_text gin_trgm_ops)` | campo "Pesquisar" |
| `imported_files (worker_cpf)`, `(document_type)`, `(imported_at)` | consultas |
| `import_run_files (run_id, status)`, `(company_id, year, month)`, `(file_hash)` | histórico, dashboard, relatórios |
| `notifications (user_id, is_read, created_at)` | sino de notificações |
| `audit_logs (created_at)`, `(user_id)`, `(action)` | auditoria |
| `import_runs` único parcial `WHERE status IN ('QUEUED','RUNNING')` | execução única |

## Backup e retenção
- Ative backups automáticos diários do provedor (PITR quando disponível).
- Backup manual: `pg_dump -Fc "$DATABASE_URL" > gestao_xml_$(date +%F).dump`
- Restauração: `pg_restore -d "$DATABASE_URL" --clean gestao_xml_AAAA-MM-DD.dump`
- O volume cresce principalmente com `imported_file_contents` (XMLs, poucos KB
  cada) e com as linhas `DUPLICATE` de `import_run_files` (uma por arquivo
  já existente a cada pesquisa, sem conteúdo). Se necessário, linhas
  `DUPLICATE` antigas podem ser removidas sem perda de registros:
  ```sql
  DELETE FROM import_run_files WHERE status = 'DUPLICATE' AND created_at < now() - interval '24 months';
  ```
