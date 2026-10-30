import type {
  CompanyStatus,
  CompetenceSource,
  FolderStatus,
  JobType,
  NotificationType,
  Role,
  RunFileStatus,
  RunScope,
  RunStatus,
  UserStatus,
} from './enums';

// ---------------------------------------------------------------------------
// DTOs da API (consumidos pelo front-end)
// ---------------------------------------------------------------------------

export interface UserDTO {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
  department: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: number | null;
  approvedByName: string | null;
  lastLoginAt: string | null;
}

export interface SessionDTO {
  accessToken: string;
  expiresIn: number;
  user: UserDTO;
}

export interface CompanyDTO {
  id: number;
  corporateName: string;
  tradeName: string;
  cnpj: string;
  folderName: string;
  status: CompanyStatus;
  folderStatus: FolderStatus;
  folderCheckedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  totalFiles?: number;
  lastImportAt?: string | null;
}

export interface RunCountersDTO {
  totalCompanies: number;
  companiesProcessed: number;
  totalFiles: number;
  filesChecked: number;
  newFiles: number;
  duplicates: number;
  errors: number;
  progress: number;
}

export interface RunDTO extends RunCountersDTO {
  id: number;
  status: RunStatus;
  scope: RunScope;
  year: number | null;
  month: number | null;
  fullRescan: boolean;
  requestedBy: number | null;
  requestedByName: string | null;
  currentCompanyName: string | null;
  cancelRequested: boolean;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  companyNames?: string[];
}

export interface RunCompanyDTO {
  companyId: number;
  companyName: string;
  folderName: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FOLDER_NOT_FOUND' | 'ERROR' | 'CANCELLED';
  totalFiles: number;
  newFiles: number;
  duplicates: number;
  errors: number;
  message: string | null;
}

export interface RunFileDTO {
  id: number;
  runId: number;
  companyId: number | null;
  companyName: string | null;
  filename: string;
  relativePath: string;
  fileHash: string | null;
  fileSize: number | null;
  fileModifiedAt: string | null;
  status: RunFileStatus;
  errorMessage: string | null;
  importedFileId: number | null;
  year: number | null;
  month: number | null;
  createdAt: string;
  hasContent: boolean;
}

export interface RecordDTO {
  id: number;
  companyId: number;
  companyName: string;
  companyCnpj: string;
  filename: string;
  relativePath: string;
  folderName: string;
  fileHash: string;
  fileSize: number;
  fileModifiedAt: string | null;
  documentType: string | null;
  documentTypeLabel: string | null;
  eventCode: string | null;
  competence: string | null;
  month: number | null;
  year: number | null;
  competenceSource: CompetenceSource | null;
  workerName: string | null;
  workerCpf: string | null;
  employerCnpj: string | null;
  protocol: string | null;
  receipt: string | null;
  documentId: string | null;
  documentDate: string | null;
  importedAt: string;
  importRunId: number | null;
  importedBy: number | null;
  importedByName: string | null;
  status: string;
}

export interface RecordDetailDTO extends RecordDTO {
  metadata: Record<string, unknown>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationDTO {
  id: number;
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  createdAt: string;
  link: string | null;
}

export interface AgentStatusDTO {
  online: boolean;
  lastSeenAt: string | null;
  version: string | null;
  hostname: string | null;
  rootPath: string | null;
  reportsPath: string | null;
  rootAccessible: boolean | null;
  lastError: string | null;
}

export interface DashboardDTO {
  monitoredCompanies: number;
  filesFound: number;
  newFiles: number;
  duplicates: number;
  errors: number;
  lastRun: RunDTO | null;
  byCompany: { companyId: number; companyName: string; imported: number; duplicates: number; errors: number }[];
  byMonth: { month: number; imported: number; byCompany: Record<string, number> }[];
  years: number[];
}

export interface ReportDTO {
  id: number;
  requestedBy: number | null;
  requestedByName: string | null;
  filters: Record<string, unknown>;
  filename: string;
  drivePath: string | null;
  driveStatus: 'PENDING' | 'SAVED' | 'FAILED';
  driveError: string | null;
  createdAt: string;
  summary: ReportSummary;
}

export interface ReportSummary {
  companiesAnalyzed: number;
  filesFound: number;
  newFiles: number;
  duplicates: number;
  errors: number;
  periodLabel: string;
}

export interface AuditLogDTO {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface SettingsDTO {
  monitoredPath: string | null;
  reportsPath: string | null;
  emailNotificationsEnabled: boolean;
  smtpConfigured: boolean;
  approvalEmailConfigured: boolean;
  agent: AgentStatusDTO;
  lastSyncAt: string | null;
}

/** Evento enviado pelo SSE de progresso. */
export interface RunEventDTO {
  run: RunDTO;
  companies: RunCompanyDTO[];
}

// ---------------------------------------------------------------------------
// Contrato API ⇄ Agente Windows
// ---------------------------------------------------------------------------

export interface AgentHeartbeatInput {
  version: string;
  hostname: string;
  rootPath: string;
  reportsPath: string;
  rootAccessible: boolean;
  lastError?: string | null;
  currentJobId?: number | null;
}

export interface ScanJobCompany {
  companyId: number;
  folderName: string;
  companyName: string;
}

export interface ScanJobPayload {
  runId: number;
  year: number | null;
  month: number | null;
  fullRescan: boolean;
  companies: ScanJobCompany[];
}

export interface CheckFoldersJobPayload {
  companies: { companyId: number; folderName: string }[];
}

export interface CreateFolderJobPayload {
  companyId: number;
  folderName: string;
}

export interface SaveReportJobPayload {
  reportId: number;
  filename: string;
  year: number;
  month: number;
}

export type AgentJob =
  | { id: number; type: 'SCAN'; payload: ScanJobPayload }
  | { id: number; type: 'CHECK_FOLDERS'; payload: CheckFoldersJobPayload }
  | { id: number; type: 'CREATE_FOLDER'; payload: CreateFolderJobPayload }
  | { id: number; type: 'SAVE_REPORT'; payload: SaveReportJobPayload };

export type AgentJobType = JobType;

export interface AgentProgressInput {
  phase: 'ENUMERATING' | 'PROCESSING' | 'FINISHING';
  totalFiles?: number;
  filesChecked?: number;
  companiesProcessed?: number;
  currentCompanyId?: number | null;
  companyUpdates?: {
    companyId: number;
    status: RunCompanyDTO['status'];
    totalFiles?: number;
    message?: string | null;
  }[];
}

export interface AgentControlResponse {
  cancelRequested: boolean;
}

export interface AgentFileMetadata {
  documentType: string | null;
  documentTypeLabel: string | null;
  eventCode: string | null;
  documentId: string | null;
  employerCnpj: string | null;
  employerName: string | null;
  workerCpf: string | null;
  workerName: string | null;
  competence: string | null;
  competenceSource: CompetenceSource;
  year: number;
  month: number;
  documentDate: string | null;
  protocol: string | null;
  receipt: string | null;
  rootElement: string | null;
  extra: Record<string, unknown>;
}

export interface AgentUploadFile {
  companyId: number;
  filename: string;
  relativePath: string;
  fileHash: string;
  fileSize: number;
  fileModifiedAt: string;
  /** Conteúdo original em base64 (sem nenhuma alteração). */
  contentBase64: string;
  metadata: AgentFileMetadata;
}

export interface AgentDuplicateFile {
  companyId: number;
  filename: string;
  relativePath: string;
  fileHash: string;
  fileSize: number;
  fileModifiedAt: string;
  year: number | null;
  month: number | null;
}

export interface AgentErrorFile {
  companyId: number;
  filename: string;
  relativePath: string;
  fileHash: string | null;
  fileSize: number | null;
  fileModifiedAt: string | null;
  errorMessage: string;
  /** Competência considerada no filtro (data do arquivo quando o XML não pôde ser lido). */
  year?: number | null;
  month?: number | null;
  /** Conteúdo bruto (base64) quando foi possível ler, para consulta do arquivo com erro. */
  contentBase64?: string | null;
}

export interface AgentFilesBatchInput {
  imported: AgentUploadFile[];
  duplicates: AgentDuplicateFile[];
  errors: AgentErrorFile[];
}

export interface AgentFilesBatchResult extends AgentControlResponse {
  imported: number;
  duplicates: number;
  errors: number;
}

export interface AgentCompleteInput {
  status: 'DONE' | 'FAILED' | 'CANCELLED';
  message?: string | null;
  result?: Record<string, unknown>;
}
