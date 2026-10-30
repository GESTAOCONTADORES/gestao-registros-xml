import { useState } from 'react';
import { AlertTriangle, Building, Building2, FolderSearch, Layers, PlayCircle, ServerOff } from 'lucide-react';
import { describePeriod, RUN_SCOPE_LABELS, type RunEventDTO, type RunScope } from '@gestao/shared';
import { post } from '../api/client';
import { useAgentStatus } from '../api/hooks';
import { CompanySelector } from '../components/CompanySelector';
import { PageHeader } from '../components/Layout';
import { Modal } from '../components/Modal';
import { MonthSelector } from '../components/MonthSelector';
import { useToast } from '../components/Toasts';
import { YearSelector } from '../components/YearSelector';
import { ProgressBar } from '../components/ImportProgress';
import { errorMessage, fmtDateTime, fmtNumber } from '../lib/format';
import { useActiveRun } from '../runs/ActiveRunProvider';

export const AGENT_OFFLINE_MESSAGE = 'O servidor responsável pelo acesso à pasta compartilhada está offline.';

interface Preview {
  companies: { id: number; name: string; folderName: string }[];
  ignoredInactive: number;
}

export function SearchPage() {
  const now = new Date();
  const agent = useAgentStatus();
  const { active, track, setMinimized } = useActiveRun();
  const toast = useToast();
  const [mode, setMode] = useState<'batch' | 'single'>('batch');
  const [scope, setScope] = useState<RunScope>('ACTIVE');
  const [companyIds, setCompanyIds] = useState<number[]>([]);
  const [year, setYear] = useState<number | undefined>(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);
  const [fullRescan, setFullRescan] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offline = agent.data ? !agent.data.online : false;
  const effectiveScope: RunScope = mode === 'single' ? 'SINGLE' : scope;
  const body = { scope: effectiveScope, companyIds: effectiveScope === 'SELECTED' || effectiveScope === 'SINGLE' ? companyIds : [], year: year ?? null, month: year ? month ?? null : null, fullRescan };
  const needsCompanies = effectiveScope === 'SELECTED' || effectiveScope === 'SINGLE';
  const canStart = !offline && !active && (!needsCompanies || companyIds.length > 0);

  const openPreview = async () => {
    setError(null);
    if (offline) return setError(AGENT_OFFLINE_MESSAGE);
    setBusy(true);
    try {
      setPreview(await post<Preview>('/runs/preview', body));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const ev = await post<RunEventDTO>('/runs', body);
      setPreview(null);
      track(ev);
      setMinimized(false);
      toast('Pesquisa iniciada. Acompanhe o progresso no painel.');
    } catch (e) {
      setError(errorMessage(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const scopeCard = (s: RunScope, icon: React.ReactNode, desc: string) => (
    <button
      type="button"
      onClick={() => {
        setScope(s);
        if (s !== 'SELECTED') setCompanyIds([]);
      }}
      aria-pressed={scope === s}
      className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors ${scope === s ? 'border-orange-500 bg-orange-50' : 'border-line bg-white hover:border-navy-800'}`}
    >
      <span className={`rounded-lg p-2 ${scope === s ? 'bg-orange-500 text-white' : 'bg-navy-50 text-navy-800'}`}>{icon}</span>
      <span>
        <span className="block font-semibold text-navy-900">{RUN_SCOPE_LABELS[s]}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
    </button>
  );

  return (
    <>
      <PageHeader title="Pesquisar arquivos" subtitle="O robô procura os XML na pasta compartilhada, importa somente os novos e ignora os já registrados." />
      {offline && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
          <ServerOff className="shrink-0" size={22} />
          <div>
            <p className="font-semibold">{AGENT_OFFLINE_MESSAGE}</p>
            <p className="text-sm">Última comunicação: {fmtDateTime(agent.data?.lastSeenAt)}. Verifique se o computador com o Gestão XML Agent está ligado.</p>
          </div>
        </div>
      )}
      {agent.data?.online && agent.data.rootAccessible === false && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-orange-700" role="alert">
          <AlertTriangle className="shrink-0" size={22} />
          <p className="text-sm">O agente está online, mas não consegue acessar a pasta compartilhada {agent.data.rootPath ? <span className="font-mono">{agent.data.rootPath}</span> : ''}. Verifique o Google Drive no servidor.</p>
        </div>
      )}
      {active && (
        <div className="card mb-5 border-orange-200 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold text-navy-900">Pesquisa #{active.run.id} em andamento</p>
            <button className="btn-outline btn-sm" onClick={() => setMinimized(false)}>
              Ver detalhes
            </button>
          </div>
          <ProgressBar value={active.run.progress} />
          <p className="mt-2 text-xs text-muted">Aguarde a conclusão para iniciar uma nova pesquisa.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="card space-y-5 p-5">
          <div>
            <span className="label">Tipo de pesquisa</span>
            <div className="flex rounded-lg border border-line p-1 text-sm font-semibold">
              <button className={`flex-1 rounded-md px-3 py-2 ${mode === 'batch' ? 'bg-navy-900 text-white' : 'text-navy-800'}`} onClick={() => setMode('batch')}>
                <Layers size={15} className="mr-1 inline" /> Pesquisa por lote
              </button>
              <button
                className={`flex-1 rounded-md px-3 py-2 ${mode === 'single' ? 'bg-navy-900 text-white' : 'text-navy-800'}`}
                onClick={() => {
                  setMode('single');
                  setCompanyIds(companyIds.slice(0, 1));
                }}
              >
                <Building size={15} className="mr-1 inline" /> Pesquisa individual
              </button>
            </div>
          </div>

          {mode === 'batch' ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {scopeCard('ALL', <Building2 size={18} />, 'Todas as empresas cadastradas e ativas')}
              {scopeCard('SELECTED', <Layers size={18} />, 'Escolha quais empresas pesquisar')}
              {scopeCard('ACTIVE', <FolderSearch size={18} />, 'Apenas empresas com status Ativa')}
            </div>
          ) : null}

          {needsCompanies && (
            <div>
              <span className="label">{mode === 'single' ? 'Empresa' : 'Empresas selecionadas'}</span>
              <CompanySelector mode={mode === 'single' ? 'single' : 'multi'} allowAll={false} value={companyIds} onChange={setCompanyIds} label="Selecionar empresa" />
            </div>
          )}
          <p className="text-xs text-muted">Empresas inativas nunca entram em lotes automáticos ("Todas as empresas" e "Somente empresas ativas").</p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr]">
            <div>
              <label className="label" htmlFor="s-year">
                Ano
              </label>
              <YearSelector id="s-year" allowAll value={year} onChange={setYear} />
            </div>
            <div>
              <span className="label">Mês (competência)</span>
              <div className={year ? '' : 'pointer-events-none opacity-50'}>
                <MonthSelector value={month} onChange={setMonth} />
              </div>
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-orange-500" checked={fullRescan} onChange={(e) => setFullRescan(e.target.checked)} />
            <span>
              <span className="font-medium text-ink">Verificação completa (ignorar cache)</span>
              <span className="block text-xs text-muted">Relê e recalcula o SHA-256 de todos os arquivos. Mais lento; use se suspeitar de alterações.</span>
            </span>
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button className="btn-primary w-full py-4 text-base tracking-wide" disabled={!canStart || busy} onClick={openPreview} title={offline ? AGENT_OFFLINE_MESSAGE : undefined}>
            <PlayCircle size={22} /> INICIAR PESQUISA
          </button>
        </div>

        <div className="card h-fit p-5">
          <h3 className="card-title mb-3">Como funciona</h3>
          <ol className="space-y-3 text-sm text-ink">
            {[
              'O Gestão XML Agent acessa a pasta compartilhada do Departamento Pessoal.',
              'Cada XML recebe uma impressão digital (SHA-256). Arquivos já registrados são ignorados.',
              'Somente os novos são importados; erros são registrados sem interromper o lote.',
              'Você acompanha de 0 a 100% e pode continuar trabalhando — inclusive fechar o navegador.',
              'Ao terminar, você recebe uma notificação com o resumo.',
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Modal
        open={!!preview}
        onClose={() => !busy && setPreview(null)}
        title="Confirmar pesquisa"
        persistent={busy}
        footer={
          <>
            <button className="btn-outline" onClick={() => setPreview(null)} disabled={busy}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={start} disabled={busy || !preview?.companies.length}>
              <PlayCircle size={16} /> {busy ? 'Iniciando…' : 'Iniciar pesquisa'}
            </button>
          </>
        }
      >
        {preview && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold tracking-widest text-muted">EMPRESAS</p>
              <p className="text-base font-semibold text-navy-900">
                {effectiveScope === 'SINGLE' ? preview.companies[0]?.name : effectiveScope === 'SELECTED' ? 'Empresas selecionadas' : 'Todas as empresas ativas'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold tracking-widest text-muted">PERÍODO</p>
              <p className="text-base font-semibold text-navy-900">{describePeriod(year, month)}</p>
            </div>
            <div>
              <p className="text-xs font-bold tracking-widest text-muted">EMPRESAS SELECIONADAS</p>
              <p className="text-3xl font-bold text-orange-500">{fmtNumber(preview.companies.length)}</p>
              {preview.ignoredInactive > 0 && <p className="text-xs text-muted">{preview.ignoredInactive} empresa(s) inativa(s) não entram neste lote.</p>}
            </div>
            {preview.companies.length > 0 && preview.companies.length <= 12 && (
              <ul className="max-h-40 overflow-y-auto rounded-lg bg-navy-50 p-3 text-sm">
                {preview.companies.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2 py-0.5">
                    <span className="truncate">{c.name}</span>
                    <span className="truncate font-mono text-xs text-muted">{c.folderName}</span>
                  </li>
                ))}
              </ul>
            )}
            {fullRescan && <p className="text-xs text-orange-600">Verificação completa ativada (o cache será ignorado).</p>}
            <p className="text-lg font-bold text-navy-900">{preview.companies.length ? 'Iniciar pesquisa?' : 'Nenhuma empresa ativa para pesquisar.'}</p>
          </div>
        )}
      </Modal>
    </>
  );
}
