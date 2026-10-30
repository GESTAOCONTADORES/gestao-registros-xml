import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Search, X } from 'lucide-react';
import { COMPANY_STATUS_LABELS, formatCnpj, stripAccents } from '@gestao/shared';
import { useCompanies } from '../api/hooks';
import { StatusBadge } from './StatusBadge';

interface CompanySelectorProps {
  /** IDs selecionados. Vazio = todas (no modo múltiplo). */
  value: number[];
  onChange: (ids: number[]) => void;
  mode?: 'single' | 'multi';
  /** Mostra a opção "Todas as empresas" (modo múltiplo). */
  allowAll?: boolean;
  onlyActive?: boolean;
  label?: string;
}

const norm = (s: string) => stripAccents(s).toLowerCase();

/** Botão "Selecionar empresa": uma, várias ou todas. */
export function CompanySelector({ value, onChange, mode = 'multi', allowAll = true, onlyActive = false, label = 'Selecionar empresa' }: CompanySelectorProps) {
  const { data: companies = [], isLoading } = useCompanies();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const list = useMemo(() => {
    const t = norm(term);
    const digits = term.replace(/\D/g, '');
    return companies
      .filter((c) => (onlyActive ? c.status === 'ACTIVE' : true))
      .filter((c) => !t || norm(`${c.corporateName} ${c.tradeName} ${c.folderName}`).includes(t) || (digits.length > 2 && c.cnpj.includes(digits)));
  }, [companies, term, onlyActive]);

  const selected = companies.filter((c) => value.includes(c.id));
  const summary =
    value.length === 0
      ? mode === 'single'
        ? label
        : 'Todas as empresas'
      : value.length === 1
        ? selected[0]?.corporateName ?? '1 empresa'
        : `${value.length} empresas selecionadas`;

  const toggle = (id: number) => {
    if (mode === 'single') {
      onChange([id]);
      setOpen(false);
      return;
    }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="input flex items-center gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Building2 size={16} className="shrink-0 text-navy-800" />
        <span className={`flex-1 truncate ${value.length ? 'font-medium text-navy-900' : 'text-muted'}`}>{summary}</span>
        {value.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpar seleção"
            className="rounded p-0.5 text-muted hover:bg-navy-50"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown size={16} className="text-muted" />
      </button>
      {open && (
        <div className="card absolute z-40 mt-1 w-full min-w-[320px] overflow-hidden shadow-xl">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search size={15} className="text-muted" />
            <input autoFocus className="w-full text-sm outline-none" placeholder="Buscar por nome, CNPJ ou pasta" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox" aria-multiselectable={mode === 'multi'}>
            {mode === 'multi' && allowAll && (
              <li>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-navy-900 hover:bg-navy-50" onClick={() => onChange([])}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${value.length === 0 ? 'border-orange-500 bg-orange-500 text-white' : 'border-line'}`}>
                    {value.length === 0 && <Check size={12} />}
                  </span>
                  Todas as empresas
                </button>
              </li>
            )}
            {isLoading && <li className="px-3 py-2 text-sm text-muted">Carregando…</li>}
            {!isLoading && list.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhuma empresa encontrada.</li>}
            {list.map((c) => {
              const active = value.includes(c.id);
              return (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={active} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-navy-50" onClick={() => toggle(c.id)}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${mode === 'single' ? 'rounded-full' : ''} ${active ? 'border-orange-500 bg-orange-500 text-white' : 'border-line'}`}>
                      {active && <Check size={12} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{c.corporateName}</span>
                      <span className="block truncate text-xs text-muted">{formatCnpj(c.cnpj)}</span>
                    </span>
                    <StatusBadge tone={c.status === 'ACTIVE' ? 'green' : 'gray'}>{COMPANY_STATUS_LABELS[c.status]}</StatusBadge>
                  </button>
                </li>
              );
            })}
          </ul>
          {mode === 'multi' && (
            <div className="flex justify-between border-t border-line bg-navy-50/60 px-3 py-2">
              <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(list.map((c) => c.id))}>
                Selecionar listadas
              </button>
              <button type="button" className="btn-navy btn-sm" onClick={() => setOpen(false)}>
                Concluir
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
