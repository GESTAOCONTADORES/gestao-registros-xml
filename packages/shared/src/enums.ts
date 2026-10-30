export const ROLES = ['MASTER', 'USER'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['PENDING', 'ACTIVE', 'REJECTED', 'BLOCKED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  PENDING: 'Aguardando aprovação',
  ACTIVE: 'Ativo',
  REJECTED: 'Rejeitado',
  BLOCKED: 'Bloqueado',
};

export const ROLE_LABELS: Record<Role, string> = {
  MASTER: 'Master',
  USER: 'Usuário',
};

export const COMPANY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  ACTIVE: 'Ativa',
  INACTIVE: 'Inativa',
};

export const FOLDER_STATUSES = ['UNKNOWN', 'FOUND', 'NOT_FOUND'] as const;
export type FolderStatus = (typeof FOLDER_STATUSES)[number];

export const FOLDER_STATUS_LABELS: Record<FolderStatus, string> = {
  UNKNOWN: 'Não verificada',
  FOUND: 'Pasta encontrada',
  NOT_FOUND: 'Pasta não encontrada',
};

export const RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'CANCELLED',
  'FAILED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['QUEUED', 'RUNNING'];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  QUEUED: 'Aguardando agente',
  RUNNING: 'Em andamento',
  COMPLETED: 'Finalizado',
  COMPLETED_WITH_ERRORS: 'Finalizado com erros',
  CANCELLED: 'Cancelado',
  FAILED: 'Falha',
};

export const RUN_FILE_STATUSES = ['IMPORTED', 'DUPLICATE', 'ERROR'] as const;
export type RunFileStatus = (typeof RUN_FILE_STATUSES)[number];

export const RUN_FILE_STATUS_LABELS: Record<RunFileStatus, string> = {
  IMPORTED: 'Importado',
  DUPLICATE: 'Já importado',
  ERROR: 'Erro',
};

export const RUN_SCOPES = ['ALL', 'ACTIVE', 'SELECTED', 'SINGLE'] as const;
export type RunScope = (typeof RUN_SCOPES)[number];

export const RUN_SCOPE_LABELS: Record<RunScope, string> = {
  ALL: 'Todas as empresas',
  ACTIVE: 'Somente empresas ativas',
  SELECTED: 'Empresas selecionadas',
  SINGLE: 'Pesquisa individual',
};

export const JOB_TYPES = ['SCAN', 'CHECK_FOLDERS', 'CREATE_FOLDER', 'SAVE_REPORT'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const NOTIFICATION_TYPES = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'ACCESS_REQUEST', 'RUN', 'REPORT'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Origem da competência identificada para um arquivo. */
export const COMPETENCE_SOURCES = ['XML_PERIOD', 'XML_DATE', 'FILE_DATE'] as const;
export type CompetenceSource = (typeof COMPETENCE_SOURCES)[number];

export const COMPETENCE_SOURCE_LABELS: Record<CompetenceSource, string> = {
  XML_PERIOD: 'Período de apuração do XML',
  XML_DATE: 'Data contida no XML',
  FILE_DATE: 'Data de modificação do arquivo',
};

export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'USER_REQUESTED',
  'USER_CREATED',
  'USER_APPROVED',
  'USER_REJECTED',
  'USER_BLOCKED',
  'USER_REACTIVATED',
  'USER_UPDATED',
  'USER_PASSWORD_CHANGED',
  'USER_PASSWORD_RESET',
  'COMPANY_CREATED',
  'COMPANY_UPDATED',
  'COMPANY_ACTIVATED',
  'COMPANY_DEACTIVATED',
  'COMPANY_DELETED',
  'COMPANY_FOLDER_CREATE_REQUESTED',
  'FOLDERS_CHECK_REQUESTED',
  'RUN_STARTED',
  'RUN_FINISHED',
  'RUN_CANCEL_REQUESTED',
  'REPORT_GENERATED',
  'DOWNLOAD',
  'SETTINGS_UPDATED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN: 'Login realizado',
  LOGIN_FAILED: 'Tentativa de login recusada',
  LOGOUT: 'Logout',
  USER_REQUESTED: 'Usuário cadastrado (solicitação de acesso)',
  USER_CREATED: 'Usuário cadastrado pelo Master',
  USER_APPROVED: 'Usuário aprovado',
  USER_REJECTED: 'Usuário rejeitado',
  USER_BLOCKED: 'Usuário bloqueado',
  USER_REACTIVATED: 'Usuário reativado',
  USER_UPDATED: 'Usuário editado',
  USER_PASSWORD_CHANGED: 'Senha alterada',
  USER_PASSWORD_RESET: 'Senha redefinida pelo Master',
  COMPANY_CREATED: 'Empresa cadastrada',
  COMPANY_UPDATED: 'Empresa editada',
  COMPANY_ACTIVATED: 'Empresa ativada',
  COMPANY_DEACTIVATED: 'Empresa desativada',
  COMPANY_DELETED: 'Empresa excluída da base do robô',
  COMPANY_FOLDER_CREATE_REQUESTED: 'Criação de pasta autorizada',
  FOLDERS_CHECK_REQUESTED: 'Verificação de pastas solicitada',
  RUN_STARTED: 'Pesquisa iniciada',
  RUN_FINISHED: 'Pesquisa finalizada',
  RUN_CANCEL_REQUESTED: 'Cancelamento de pesquisa solicitado',
  REPORT_GENERATED: 'Relatório gerado',
  DOWNLOAD: 'Download realizado',
  SETTINGS_UPDATED: 'Configurações alteradas',
};
