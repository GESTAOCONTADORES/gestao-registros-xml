import { useEffect, useState } from 'react';
import { FolderCheck, FolderX, FolderSearch } from 'lucide-react';
import { FOLDER_STATUS_LABELS, isSafeFolderName, isValidCnpj, onlyDigits, type CompanyDTO } from '@gestao/shared';
import { ApiError, patch, post } from '../api/client';
import { errorMessage, fmtDate, maskCnpj } from '../lib/format';
import { Modal } from './Modal';
import { FOLDER_STATUS_TONE, StatusBadge } from './StatusBadge';

interface CompanyModalProps {
  open: boolean;
  company: CompanyDTO | null;
  /** Pré-preenchimento (ex.: a partir de uma pasta ainda sem cadastro). */
  initialFolderName?: string;
  onClose: () => void;
  onSaved: (c: CompanyDTO) => void;
}

const empty = { corporateName: '', tradeName: '', cnpj: '', folderName: '', notes: '' };

export function FolderStatusBadge({ status }: { status: CompanyDTO['folderStatus'] }) {
  const Icon = status === 'FOUND' ? FolderCheck : status === 'NOT_FOUND' ? FolderX : FolderSearch;
  return (
    <StatusBadge tone={FOLDER_STATUS_TONE[status]}>
      <Icon size={12} /> {FOLDER_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

export function CompanyModal({ open, company, initialFolderName, onClose, onSaved }: CompanyModalProps) {
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setGeneral(null);
    setForm(
      company
        ? { corporateName: company.corporateName, tradeName: company.tradeName, cnpj: maskCnpj(company.cnpj), folderName: company.folderName, notes: company.notes }
        : { ...empty, folderName: initialFolderName ?? '', corporateName: initialFolderName ?? '' },
    );
  }, [open, company, initialFolderName]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.corporateName.trim()) e.corporateName = 'Informe a razão social';
    if (!isValidCnpj(form.cnpj)) e.cnpj = 'CNPJ inválido';
    if (!isSafeFolderName(form.folderName)) e.folderName = 'Nome de pasta inválido (não use \\ / : * ? " < > | nem ..)';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setGeneral(null);
    try {
      const body = { ...form, cnpj: onlyDigits(form.cnpj), folderName: form.folderName.trim() };
      const saved = company ? await patch<CompanyDTO>(`/companies/${company.id}`, body) : await post<CompanyDTO>('/companies', body);
      onSaved(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.details);
      setGeneral(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof typeof form, label: string, opts: { required?: boolean; placeholder?: string; mono?: boolean } = {}) => (
    <div>
      <label className="label" htmlFor={`co-${key}`}>
        {label}
        {opts.required && <span className="text-orange-500"> *</span>}
      </label>
      <input
        id={`co-${key}`}
        className={`input ${opts.mono ? 'font-mono' : ''} ${errors[key] ? 'border-red-400' : ''}`}
        value={form[key]}
        placeholder={opts.placeholder}
        onChange={(e) => setForm({ ...form, [key]: key === 'cnpj' ? maskCnpj(e.target.value) : e.target.value })}
        aria-invalid={!!errors[key]}
      />
      {errors[key] && <p className="mt-1 text-xs text-red-600">{errors[key]}</p>}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      persistent={busy}
      size="lg"
      title={company ? 'Editar empresa' : 'Nova empresa'}
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn-primary" form="company-form" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="company-form" onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">{field('corporateName', 'Razão social', { required: true })}</div>
        {field('tradeName', 'Nome fantasia')}
        {field('cnpj', 'CNPJ', { required: true, placeholder: '00.000.000/0000-00', mono: true })}
        <div className="md:col-span-2">
          {field('folderName', 'Nome da pasta no Drive', { required: true, placeholder: 'Ex.: EMPRESA A' })}
          <p className="mt-1 text-xs text-muted">
            Nome exato da pasta dentro de <span className="font-mono">REGISTROS ROBO XML - PDF</span>. O sistema verifica se ela existe e nunca cria pastas sem autorização.
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="co-notes">
            Observações
          </label>
          <textarea id="co-notes" className="input min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        {company && (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-navy-50 p-3 text-sm md:col-span-2 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted">Status</p>
              <p className="font-semibold">{company.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Data de inclusão</p>
              <p className="font-semibold">{fmtDate(company.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Data de desativação</p>
              <p className="font-semibold">{fmtDate(company.deactivatedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Pasta</p>
              <FolderStatusBadge status={company.folderStatus} />
            </div>
          </div>
        )}
        {general && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 md:col-span-2">{general}</p>}
      </form>
    </Modal>
  );
}
