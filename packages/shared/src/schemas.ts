import { z } from 'zod';
import { RUN_SCOPES, USER_STATUSES, ROLES, RUN_FILE_STATUSES, RUN_STATUSES } from './enums';
import { isSafeFolderName, isValidCnpj, onlyDigits } from './utils';

const trimmed = (max: number) => z.string().trim().max(max);

export const loginSchema = z.object({
  username: trimmed(120).min(1, 'Informe o usuário'),
  password: z.string().min(1, 'Informe a senha').max(200),
});

export const passwordSchema = z.string().min(6, 'A senha deve ter no mínimo 6 caracteres').max(200);

export const accessRequestSchema = z
  .object({
    firstName: trimmed(80).min(1, 'Informe o nome'),
    lastName: trimmed(80).min(1, 'Informe o sobrenome'),
    department: trimmed(120).min(1, 'Informe o setor'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'As senhas não conferem',
    path: ['confirmPassword'],
  });

export const createUserSchema = z.object({
  firstName: trimmed(80).min(1),
  lastName: trimmed(80).min(1),
  department: trimmed(120).min(1),
  password: passwordSchema,
  role: z.enum(ROLES).default('USER'),
});

export const updateUserSchema = z.object({
  firstName: trimmed(80).min(1).optional(),
  lastName: trimmed(80).min(1).optional(),
  department: trimmed(120).min(1).optional(),
  role: z.enum(ROLES).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'As senhas não conferem',
    path: ['confirmPassword'],
  });

export const resetPasswordSchema = z.object({ newPassword: passwordSchema });

export const userListQuerySchema = z.object({
  status: z.enum(USER_STATUSES).optional(),
  search: trimmed(120).optional(),
});

export const companySchema = z.object({
  corporateName: trimmed(200).min(1, 'Informe a razão social'),
  tradeName: trimmed(200).optional().default(''),
  cnpj: z
    .string()
    .trim()
    .transform(onlyDigits)
    .refine(isValidCnpj, 'CNPJ inválido'),
  folderName: trimmed(200).refine(isSafeFolderName, 'Nome de pasta inválido (não use \\ / : * ? " < > | nem ..)'),
  notes: trimmed(2000).optional().default(''),
});

const idList = z.array(z.coerce.number().int().positive()).max(5000);

export const startRunSchema = z
  .object({
    scope: z.enum(RUN_SCOPES),
    companyIds: idList.optional().default([]),
    year: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
    month: z.coerce.number().int().min(1).max(12).nullable().optional(),
    fullRescan: z.boolean().optional().default(false),
  })
  .refine((d) => !(d.month && !d.year), { message: 'Selecione o ano', path: ['year'] })
  .refine((d) => (d.scope === 'SELECTED' ? d.companyIds.length > 0 : true), {
    message: 'Selecione ao menos uma empresa',
    path: ['companyIds'],
  })
  .refine((d) => (d.scope === 'SINGLE' ? d.companyIds.length === 1 : true), {
    message: 'Selecione exatamente uma empresa',
    path: ['companyIds'],
  });

/** Filtros comuns de consulta (dashboard, registros, relatórios). Aceita "1,2,3" na query string. */
const csvIds = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (!v) return [] as number[];
    const raw = Array.isArray(v) ? v.join(',') : v;
    return raw
      .split(',')
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0);
  });

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const periodFilterSchema = z.object({
  companyIds: csvIds,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  dateFrom: isoDate,
  dateTo: isoDate,
});

export const recordsQuerySchema = periodFilterSchema.extend({
  search: trimmed(200).optional(),
  documentType: trimmed(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(25),
});

export const runFilesQuerySchema = z.object({
  status: z.enum(RUN_FILE_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});

export const runsQuerySchema = z.object({
  status: z.enum(RUN_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export const bulkDownloadSchema = z.object({
  companyIds: idList.optional().default([]),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  format: z.enum(['xml', 'html', 'pdf']),
});

export const reportRequestSchema = z.object({
  companyIds: idList.optional().default([]),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  dateFrom: isoDate,
  dateTo: isoDate,
});

export const settingsUpdateSchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
});

export const auditQuerySchema = z.object({
  action: trimmed(60).optional(),
  userId: z.coerce.number().int().positive().optional(),
  dateFrom: isoDate,
  dateTo: isoDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;
export type CompanyInput = z.infer<typeof companySchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;
export type PeriodFilter = z.infer<typeof periodFilterSchema>;
export type RecordsQuery = z.infer<typeof recordsQuerySchema>;
export type ReportRequest = z.infer<typeof reportRequestSchema>;
export type BulkDownloadInput = z.infer<typeof bulkDownloadSchema>;
