import { useQuery } from '@tanstack/react-query';
import type {
  AgentStatusDTO,
  CompanyDTO,
  DashboardDTO,
  NotificationDTO,
  Paginated,
  RecordDTO,
} from '@gestao/shared';
import { availableYears } from '@gestao/shared';
import { get } from './client';

export interface PeriodFilters {
  companyIds: number[];
  year?: number;
  month?: number;
  dateFrom?: string;
  dateTo?: string;
}

export const qk = {
  agent: ['agent-status'] as const,
  companies: ['companies'] as const,
  years: ['years'] as const,
  dashboard: (f: PeriodFilters) => ['dashboard', f] as const,
  records: (q: object) => ['records', q] as const,
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
};

export function useAgentStatus() {
  return useQuery({
    queryKey: qk.agent,
    queryFn: () => get<AgentStatusDTO>('/agent-status'),
    refetchInterval: 20_000,
  });
}

export function useCompanies() {
  return useQuery({ queryKey: qk.companies, queryFn: () => get<CompanyDTO[]>('/companies'), staleTime: 30_000 });
}

export function useYears() {
  return useQuery({
    queryKey: qk.years,
    queryFn: () => get<number[]>('/years'),
    staleTime: 5 * 60_000,
    placeholderData: availableYears(),
  });
}

export function useDashboard(f: PeriodFilters) {
  return useQuery({
    queryKey: qk.dashboard(f),
    queryFn: () => get<DashboardDTO>('/dashboard', { ...f }),
    placeholderData: (prev) => prev,
  });
}

export interface RecordsQuery extends PeriodFilters {
  search?: string;
  documentType?: string;
  page: number;
  pageSize: number;
}

export function useRecords(q: RecordsQuery) {
  return useQuery({
    queryKey: qk.records(q),
    queryFn: () => get<Paginated<RecordDTO>>('/records', { ...q }),
    placeholderData: (prev) => prev,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => get<{ items: NotificationDTO[]; unread: number }>('/notifications', { limit: 100 }),
    enabled,
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: qk.unread,
    queryFn: () => get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  });
}
