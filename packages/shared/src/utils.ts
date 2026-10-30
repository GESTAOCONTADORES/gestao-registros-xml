export const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

export const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;

/** Primeiro ano exibido no seletor. Anos posteriores são acrescentados automaticamente. */
export const FIRST_YEAR = 2024;

/** Lista de anos de FIRST_YEAR até (ano atual + 1), acrescentando novos anos automaticamente. */
export function availableYears(now = new Date(), extra: number[] = []): number[] {
  const last = now.getFullYear() + 1;
  const set = new Set<number>(extra.filter((y) => Number.isInteger(y) && y > 1900 && y < 3000));
  for (let y = FIRST_YEAR; y <= last; y++) set.add(y);
  return [...set].sort((a, b) => a - b);
}

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? '';
}

/** "10 - OUTUBRO" — nome da subpasta de relatórios. */
export function monthFolderName(month: number): string {
  return `${String(month).padStart(2, '0')} - ${stripAccents(monthName(month)).toUpperCase()}`;
}

/** "2026-10" */
export function competenceKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** "10/2026" */
export function formatCompetence(year?: number | null, month?: number | null): string {
  if (!year || !month) return '—';
  return `${String(month).padStart(2, '0')}/${year}`;
}

export function describePeriod(year?: number | null, month?: number | null): string {
  if (!year) return 'Todo o período';
  if (!month) return `Todos os meses / ${year}`;
  return `${monthName(month)} / ${year}`;
}

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Normaliza o texto digitado no campo "Usuário" e gera identificadores de acesso.
 * "Bruno Sales" → "bruno.sales" ; "Departamento pessoal" → "departamento.pessoal".
 */
export function normalizeUsername(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9.\s_-]/g, '')
    .replace(/[\s_-]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
}

export function buildUsername(firstName: string, lastName: string): string {
  const first = normalizeUsername(firstName).split('.')[0] ?? '';
  const lastParts = normalizeUsername(lastName).split('.').filter(Boolean);
  const last = lastParts[lastParts.length - 1] ?? '';
  return [first, last].filter(Boolean).join('.') || 'usuario';
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(cnpj.slice(0, 12), w1);
  const d2 = calc(cnpj.slice(0, 12) + d1, w2);
  return cnpj.endsWith(`${d1}${d2}`);
}

export function formatCnpj(value?: string | null): string {
  const d = onlyDigits(value ?? '');
  if (d.length !== 14) return value ?? '';
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function formatCpf(value?: string | null): string {
  const d = onlyDigits(value ?? '');
  if (d.length !== 11) return value ?? '';
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

/**
 * Nome de pasta aceito para uma empresa: um único nível, sem separadores,
 * sem "..", sem letra de unidade e sem caracteres proibidos no Windows.
 */
export function isSafeFolderName(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 200) return false;
  if (v === '.' || v === '..') return false;
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(v)) return false;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(v)) return false;
  if (/[. ]$/.test(v)) return false;
  return true;
}

/** Nome de arquivo seguro para downloads (ASCII). */
export function safeFileName(value: string): string {
  return stripAccents(value)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 150) || 'arquivo';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}min ${s}s`;
  if (m) return `${m}min ${s}s`;
  return `${s}s`;
}
