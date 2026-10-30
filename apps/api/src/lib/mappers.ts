import type {
  AuditLogDTO,
  CompanyDTO,
  NotificationDTO,
  RecordDTO,
  ReportDTO,
  RunCompanyDTO,
  RunDTO,
  RunFileDTO,
  UserDTO,
} from '@gestao/shared';
import { iso } from './http';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export const USER_COLUMNS = `u.id, u.first_name, u.last_name, u.username, u.department, u.role, u.status,
  u.created_at, u.approved_at, u.approved_by, u.last_login_at,
  (SELECT a.first_name || ' ' || a.last_name FROM users a WHERE a.id = u.approved_by) AS approved_by_name`;

export function toUser(r: Row): UserDTO {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    username: r.username,
    department: r.department,
    role: r.role,
    status: r.status,
    createdAt: iso(r.created_at)!,
    approvedAt: iso(r.approved_at),
    approvedBy: r.approved_by ?? null,
    approvedByName: r.approved_by_name ?? null,
    lastLoginAt: iso(r.last_login_at),
  };
}

export function toCompany(r: Row): CompanyDTO {
  return {
    id: r.id,
    corporateName: r.corporate_name,
    tradeName: r.trade_name ?? '',
    cnpj: r.cnpj,
    folderName: r.folder_name,
    status: r.status,
    folderStatus: r.folder_status,
    folderCheckedAt: iso(r.folder_checked_at),
    notes: r.notes ?? '',
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    deactivatedAt: iso(r.deactivated_at),
    totalFiles: r.total_files !== undefined ? Number(r.total_files) : undefined,
    lastImportAt: r.last_import_at !== undefined ? iso(r.last_import_at) : undefined,
  };
}

export const RUN_COLUMNS = `r.*,
  (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.id = r.requested_by) AS requested_by_name,
  (SELECT c.corporate_name FROM companies c WHERE c.id = r.current_company_id) AS current_company_name`;

export function toRun(r: Row): RunDTO {
  return {
    id: r.id,
    status: r.status,
    scope: r.scope,
    year: r.year ?? null,
    month: r.month ?? null,
    fullRescan: !!r.full_rescan,
    requestedBy: r.requested_by ?? null,
    requestedByName: r.requested_by_name ?? null,
    currentCompanyName: r.current_company_name ?? null,
    cancelRequested: !!r.cancel_requested,
    errorMessage: r.error_message ?? null,
    totalCompanies: r.total_companies,
    companiesProcessed: r.companies_processed,
    totalFiles: r.total_files,
    filesChecked: r.files_checked,
    newFiles: r.new_files,
    duplicates: r.duplicates,
    errors: r.errors,
    progress: Math.round(Number(r.progress) * 10) / 10,
    createdAt: iso(r.created_at)!,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    updatedAt: iso(r.updated_at)!,
    companyNames: r.company_names ?? undefined,
  };
}

export function toRunCompany(r: Row): RunCompanyDTO {
  return {
    companyId: r.company_id,
    companyName: r.company_name,
    folderName: r.folder_name,
    status: r.status,
    totalFiles: r.total_files,
    newFiles: r.new_files,
    duplicates: r.duplicates,
    errors: r.errors,
    message: r.message ?? null,
  };
}

export function toRunFile(r: Row): RunFileDTO {
  return {
    id: r.id,
    runId: r.run_id,
    companyId: r.company_id ?? null,
    companyName: r.company_name ?? null,
    filename: r.filename,
    relativePath: r.relative_path,
    fileHash: r.file_hash ? String(r.file_hash).trim() : null,
    fileSize: r.file_size ?? null,
    fileModifiedAt: iso(r.file_modified_at),
    status: r.status,
    errorMessage: r.error_message ?? null,
    importedFileId: r.imported_file_id ?? null,
    year: r.year ?? null,
    month: r.month ?? null,
    createdAt: iso(r.created_at)!,
    hasContent: !!r.has_content,
  };
}

export const RECORD_COLUMNS = `f.id, f.company_id, f.filename, f.relative_path, f.file_hash, f.file_size, f.file_modified_at,
  f.competence, f.competence_source, f.month, f.year, f.document_type, f.document_type_label, f.event_code,
  f.document_id, f.document_date, f.employer_cnpj, f.worker_cpf, f.worker_name, f.protocol, f.receipt,
  f.imported_at, f.import_run_id, f.imported_by, f.status,
  c.corporate_name AS company_name, c.cnpj AS company_cnpj, c.folder_name,
  (SELECT u.first_name || ' ' || u.last_name FROM users u WHERE u.id = f.imported_by) AS imported_by_name`;

export function toRecord(r: Row): RecordDTO {
  return {
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_name,
    companyCnpj: r.company_cnpj,
    filename: r.filename,
    relativePath: r.relative_path,
    folderName: r.folder_name,
    fileHash: String(r.file_hash).trim(),
    fileSize: r.file_size,
    fileModifiedAt: iso(r.file_modified_at),
    documentType: r.document_type ?? null,
    documentTypeLabel: r.document_type_label ?? null,
    eventCode: r.event_code ?? null,
    competence: r.competence ?? null,
    month: r.month ?? null,
    year: r.year ?? null,
    competenceSource: r.competence_source ?? null,
    workerName: r.worker_name ?? null,
    workerCpf: r.worker_cpf ?? null,
    employerCnpj: r.employer_cnpj ?? null,
    protocol: r.protocol ?? null,
    receipt: r.receipt ?? null,
    documentId: r.document_id ?? null,
    documentDate: r.document_date ?? null,
    importedAt: iso(r.imported_at)!,
    importRunId: r.import_run_id ?? null,
    importedBy: r.imported_by ?? null,
    importedByName: r.imported_by_name ?? null,
    status: r.status,
  };
}

export function toNotification(r: Row): NotificationDTO {
  return {
    id: r.id,
    title: r.title,
    message: r.message,
    type: r.type,
    isRead: !!r.is_read,
    createdAt: iso(r.created_at)!,
    link: r.link ?? null,
  };
}

export function toReport(r: Row): ReportDTO {
  return {
    id: r.id,
    requestedBy: r.requested_by ?? null,
    requestedByName: r.requested_by_name ?? null,
    filters: r.filters ?? {},
    filename: r.filename,
    drivePath: r.drive_path ?? null,
    driveStatus: r.drive_status,
    driveError: r.drive_error ?? null,
    createdAt: iso(r.created_at)!,
    summary: r.summary ?? {},
  };
}

export function toAudit(r: Row): AuditLogDTO {
  return {
    id: r.id,
    userId: r.user_id ?? null,
    userName: r.user_name ?? null,
    action: r.action,
    entity: r.entity ?? null,
    entityId: r.entity_id ?? null,
    details: r.details ?? null,
    ip: r.ip ?? null,
    createdAt: iso(r.created_at)!,
  };
}
