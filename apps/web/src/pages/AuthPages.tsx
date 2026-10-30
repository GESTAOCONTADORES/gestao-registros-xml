import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, LockKeyhole, User } from 'lucide-react';
import { USER_STATUS_LABELS } from '@gestao/shared';
import { ApiError, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Logo';
import { errorMessage } from '../lib/format';

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full">
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-navy-900 p-10 text-white lg:flex">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-navy-800/60" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-orange-500/10" />
        <div className="relative">
          <p className="text-xs font-semibold tracking-[0.25em] text-orange-400 uppercase">Gestão Contadores</p>
        </div>
        <div className="relative">
          <h2 className="text-3xl leading-tight font-bold">
            Registros XML do
            <br />
            Departamento Pessoal,
            <br />
            <span className="text-orange-400">organizados e seguros.</span>
          </h2>
          <ul className="mt-6 space-y-2 text-sm text-navy-100">
            <li>• Pesquisa automática na pasta compartilhada</li>
            <li>• Nenhum XML importado duas vezes</li>
            <li>• XML, HTML e PDF a um clique</li>
          </ul>
        </div>
        <p className="relative text-xs text-navy-100">Uso interno · Acesso restrito a usuários aprovados</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="mb-8 text-center">
      <div className="mb-5 flex justify-center">
        <Logo className="h-14" />
      </div>
      <h1 className="text-2xl font-bold text-navy-900">Departamento Pessoal</h1>
      <p className="mt-1 text-sm font-bold tracking-[0.2em] text-orange-500">REGISTROS XML-PDF</p>
    </div>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<{ msg: string; tone: 'red' | 'orange' } | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={location.state?.from ?? '/'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      const pending = err instanceof ApiError && (err.code === 'USER_PENDING' || err.code === 'LOCKED');
      setError({ msg: errorMessage(err), tone: pending ? 'orange' : 'red' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell>
      <Brand />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="username">
            Usuário
          </label>
          <div className="relative">
            <User size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input id="username" className="input pl-9" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ex.: Bruno Sales ou bruno.sales" required />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="password">
            Senha
          </label>
          <div className="relative">
            <LockKeyhole size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input id="password" type={show ? 'text' : 'password'} className="input px-9" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-muted" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className={`rounded-lg px-3 py-2 text-sm ${error.tone === 'orange' ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-700'}`}>
            {error.msg}
          </p>
        )}
        <button className="btn-primary w-full py-2.5" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        <Link to="/solicitar-acesso" className="btn-outline w-full py-2.5">
          Solicitar acesso
        </Link>
      </form>
    </AuthShell>
  );
}

export function RequestAccessPage() {
  const [form, setForm] = useState({ firstName: '', lastName: '', department: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ username: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.firstName.trim()) errs.firstName = 'Informe o nome';
    if (!form.lastName.trim()) errs.lastName = 'Informe o sobrenome';
    if (!form.department.trim()) errs.department = 'Informe o setor';
    if (form.password.length < 6) errs.password = 'A senha deve ter no mínimo 6 caracteres';
    if (form.password !== form.confirmPassword) errs.confirmPassword = 'As senhas não conferem';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setGeneral(null);
    try {
      const res = await api<{ username: string }>('/auth/request-access', { method: 'POST', body: form, noRefresh: true });
      setDone(res);
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      setGeneral(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthShell>
        <Brand />
        <div className="card p-6 text-center">
          <CheckCircle2 className="mx-auto text-emerald-600" size={40} />
          <h2 className="mt-3 text-lg font-bold text-navy-900">Solicitação enviada</h2>
          <p className="mt-2 text-sm text-muted">Seu identificador de acesso é:</p>
          <p className="mt-1 rounded-lg bg-navy-50 py-2 font-mono text-lg font-bold text-navy-900">{done.username}</p>
          <p className="mt-4 text-sm">
            Status: <span className="font-bold text-orange-500">{USER_STATUS_LABELS.PENDING}</span>
          </p>
          <p className="mt-2 text-xs text-muted">Você poderá entrar assim que o Departamento Pessoal aprovar o seu cadastro.</p>
          <Link to="/login" className="btn-primary mt-5 w-full">
            Voltar ao login
          </Link>
        </div>
      </AuthShell>
    );
  }

  const field = (key: keyof typeof form, label: string, type = 'text', auto?: string) => (
    <div>
      <label className="label" htmlFor={`ra-${key}`}>
        {label}
      </label>
      <input id={`ra-${key}`} type={type} autoComplete={auto} className={`input ${errors[key] ? 'border-red-400' : ''}`} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} aria-invalid={!!errors[key]} />
      {errors[key] && <p className="mt-1 text-xs text-red-600">{errors[key]}</p>}
    </div>
  );
  return (
    <AuthShell>
      <Brand />
      <h2 className="mb-4 text-center text-sm font-bold tracking-wide text-navy-900 uppercase">Solicitar acesso</h2>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid grid-cols-2 gap-3">
          {field('firstName', 'Nome', 'text', 'given-name')}
          {field('lastName', 'Sobrenome', 'text', 'family-name')}
        </div>
        {field('department', 'Setor', 'text', 'organization-title')}
        {field('password', 'Senha (mínimo 6 caracteres)', 'password', 'new-password')}
        {field('confirmPassword', 'Confirmar senha', 'password', 'new-password')}
        {general && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{general}</p>}
        <button className="btn-primary w-full py-2.5" disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar solicitação'}
        </button>
        <Link to="/login" className="btn-ghost w-full">
          Já tenho acesso — voltar ao login
        </Link>
      </form>
    </AuthShell>
  );
}
