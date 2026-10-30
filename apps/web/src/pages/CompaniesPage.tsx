import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, FolderSearch, Pencil, Plus, Power, PowerOff, Search, Trash2 } from 'lucide-react';
import { COMPANY_STATUS_LABELS, formatCnpj, stripAccents, type CompanyDTO } from '@gestao/shared';
import { del, get, post } from '../api/client';
import { qk, useAgentStatus, useCompanies } from '../api/hooks';
import { CompanyModal, FolderStatusBadge } from '../components/CompanyModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/Layout';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toasts';
import { errorMessage, fmtDate, fmtDateTime, fmtNumber } from '../lib/format';

type Confirm = { kind: 'activate' | 'deactivate' | 'delete' | 'create-folder'; company: CompanyDTO } | null;

export function CompaniesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useCompanies();
  const agent = useAgentStatus();
  const unlinked = useQuery({ queryKey: ['unlinked-folders'], queryFn: () => get<{ folders: string[]; checkedAt: string | null }>('/companies/folders/unlinked') });
  const [modal, setModal] = useState<{ open: boolean; company: CompanyDTO | null; folder?: string }>({ open: false, company: null });
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.companies });
    void qc.invalidateQueries({ queryKey: ['unlinked-folders'] });
  };
  const list = useMemo(() => {
    const t = stripAccents(term).toLowerCase();
    return (q.data ?? [])
      .filter((c) => status === 'ALL' || c.status === status)
      .filter((c) => !t || stripAccents(`${c.corporateName} ${c.tradeName} ${c.folderName} ${c.cnpj}`).toLowerCase().includes(t));
  }, [q.data, term, status]);

  const checkFolders = async () => {
    try {
      await post('/companies/check-folders');
      toast('Verificação solicitada ao agente. O resultado aparece em instantes.', 'info');
      setTimeout(refresh, 4000);
      setTimeout(refresh, 10000);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    const { kind, company } = confirm;
    if (kind === 'delete') await del(`/companies/${company.id}`);
    else if (kind === 'create-folder') await post(`/companies/${company.id}/create-folder`, { confirm: true });
    else await post(`/companies/${company.id}/${kind}`);
    toast(
      kind === 'delete'
        ? 'Empresa excluída da base do robô.'
        : kind === 'create-folder'
          ? 'Criação da pasta solicitada ao agente.'
          : kind === 'activate'
            ? 'Empresa ativada.'
            : 'Empresa desativada.',
    );
    refresh();
    if (kind === 'create-folder') setTimeout(refresh, 5000);
  };

  const confirmText: Record<NonNullable<Confirm>['kind'], { title: string; label: string; danger?: boolean; msg: (c: CompanyDTO) => React.ReactNode }> = {
    activate: { title: 'Ativar empresa', label: 'Ativar', msg: (c) => <>A empresa <b>{c.corporateName}</b> voltará a entrar nos lotes automáticos.</> },
    deactivate: {
      title: 'Desativar empresa',
      label: 'Desativar',
      msg: (c) => (
        <>
          A empresa <b>{c.corporateName}</b> deixará de entrar nos lotes automáticos. Os registros já importados e os arquivos em G:\ são mantidos.
        </>
      ),
    },
    delete: {
      title: 'Excluir empresa',
      label: 'Excluir da base do robô',
      danger: true,
      msg: (c) => (
        <>
          <p>
            A empresa <b>{c.corporateName}</b> será excluída da base do robô.
          </p>
          <p className="mt-2 rounded-md bg-navy-50 p-2 text-xs">
            Os arquivos da pasta <span className="font-mono">{c.folderName}</span> em G:\ <b>nunca são apagados</b>, e os registros já importados permanecem disponíveis para consulta.
          </p>
        </>
      ),
    },
    'create-folder': {
      title: 'Criar pasta no Drive',
      label: 'Autorizar criação',
      msg: (c) => (
        <>
          Autoriza o agente a criar a pasta <span className="font-mono font-semibold">{c.folderName}</span> dentro de <span className="font-mono">REGISTROS ROBO XML - PDF</span>?
        </>
      ),
    },
  };

  return (
    <>
      <PageHeader
        title="Empresas"
        subtitle="Empresas monitoradas pelo robô e suas pastas na unidade compartilhada."
        actions={
          <>
            <button className="btn-outline" onClick={checkFolders} disabled={!agent.data?.online} title={agent.data?.online ? undefined : 'Agente offline'}>
              <FolderSearch size={16} /> Verificar pastas
            </button>
            <button className="btn-primary" onClick={() => setModal({ open: true, company: null })}>
              <Plus size={16} /> Nova Empresa
            </button>
          </>
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="relative min-w-[240px] flex-1">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar por razão social, CNPJ ou pasta" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar empresa" />
          </div>
          <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((s) => (
              <button key={s} className={`rounded-md px-3 py-1.5 ${status === s ? 'bg-navy-900 text-white' : 'text-navy-800'}`} onClick={() => setStatus(s)}>
                {s === 'ALL' ? 'Todas' : s === 'ACTIVE' ? 'Ativas' : 'Inativas'}
              </button>
            ))}
          </div>
        </div>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !list.length ? (
          <EmptyState
            title="Nenhuma empresa cadastrada"
            message="Cadastre as empresas cujas pastas estão em REGISTROS ROBO XML - PDF."
            action={
              <button className="btn-primary mt-2" onClick={() => setModal({ open: true, company: null })}>
                <Plus size={16} /> Nova Empresa
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Razão social</th>
                  <th>CNPJ</th>
                  <th>Pasta no Drive</th>
                  <th>Status</th>
                  <th className="text-right">Registros</th>
                  <th>Inclusão / Desativação</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="max-w-[240px]">
                      <span className="block truncate font-semibold text-navy-900" title={c.corporateName}>{c.corporateName}</span>
                      {c.tradeName && <span className="block truncate text-xs text-muted">{c.tradeName}</span>}
                    </td>
                    <td className="font-mono text-xs whitespace-nowrap">{formatCnpj(c.cnpj)}</td>
                    <td>
                      <span className="block font-mono text-xs">{c.folderName}</span>
                      <span title={c.folderCheckedAt ? `Verificada em ${fmtDateTime(c.folderCheckedAt)}` : undefined}>
                        <FolderStatusBadge status={c.folderStatus} />
                      </span>
                    </td>
                    <td>
                      <StatusBadge tone={c.status === 'ACTIVE' ? 'green' : 'gray'} dot>
                        {COMPANY_STATUS_LABELS[c.status]}
                      </StatusBadge>
                    </td>
                    <td className="text-right">{fmtNumber(c.totalFiles)}</td>
                    <td className="text-xs whitespace-nowrap">
                      <span className="block">{fmtDate(c.createdAt)}</span>
                      {c.deactivatedAt && <span className="block text-muted">desativada {fmtDate(c.deactivatedAt)}</span>}
                    </td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1">
                        {c.folderStatus === 'NOT_FOUND' && (
                          <button className="btn-outline btn-sm" onClick={() => setConfirm({ kind: 'create-folder', company: c })} title="Criar pasta (requer autorização)">
                            <FolderPlus size={14} /> Criar pasta
                          </button>
                        )}
                        <button className="btn-outline btn-sm" onClick={() => setModal({ open: true, company: c })}>
                          <Pencil size={14} /> Editar
                        </button>
                        {c.status === 'ACTIVE' ? (
                          <button className="btn-outline btn-sm" onClick={() => setConfirm({ kind: 'deactivate', company: c })}>
                            <PowerOff size={14} /> Desativar
                          </button>
                        ) : (
                          <button className="btn-outline btn-sm" onClick={() => setConfirm({ kind: 'activate', company: c })}>
                            <Power size={14} /> Ativar
                          </button>
                        )}
                        <button className="btn-outline btn-sm text-red-700" onClick={() => setConfirm({ kind: 'delete', company: c })}>
                          <Trash2 size={14} /> Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {unlinked.data && unlinked.data.folders.length > 0 && (
        <div className="card mt-5 p-4">
          <h3 className="card-title">Pastas sem empresa cadastrada</h3>
          <p className="mb-3 text-xs text-muted">Encontradas na unidade compartilhada na última verificação ({fmtDateTime(unlinked.data.checkedAt)}).</p>
          <div className="flex flex-wrap gap-2">
            {unlinked.data.folders.map((f) => (
              <button key={f} className="btn-outline btn-sm" onClick={() => setModal({ open: true, company: null, folder: f })} title="Cadastrar empresa para esta pasta">
                <Plus size={13} /> <span className="font-mono">{f}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <CompanyModal
        open={modal.open}
        company={modal.company}
        initialFolderName={modal.folder}
        onClose={() => setModal({ open: false, company: null })}
        onSaved={(c) => {
          toast(modal.company ? 'Empresa atualizada.' : `Empresa cadastrada. Verificando a pasta "${c.folderName}"…`);
          refresh();
          setTimeout(refresh, 4000);
        }}
      />
      {confirm && (
        <ConfirmDialog
          open
          title={confirmText[confirm.kind].title}
          message={confirmText[confirm.kind].msg(confirm.company)}
          confirmLabel={confirmText[confirm.kind].label}
          danger={confirmText[confirm.kind].danger}
          onClose={() => setConfirm(null)}
          onConfirm={doConfirm}
        />
      )}
    </>
  );
}
