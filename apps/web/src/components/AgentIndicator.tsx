import { AlertTriangle } from 'lucide-react';
import { useAgentStatus } from '../api/hooks';
import { fmtDateTime } from '../lib/format';

/** "Agente XML ● Online/Offline" + última comunicação. */
export function AgentIndicator({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useAgentStatus();
  const online = !!data?.online;
  const noAccess = online && data?.rootAccessible === false;
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5"
      title={noAccess ? 'O agente está online, mas não consegue acessar a pasta compartilhada.' : data?.hostname ? `Servidor: ${data.hostname}` : undefined}
    >
      <span className="relative flex h-2.5 w-2.5">
        {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${isLoading ? 'bg-slate-300' : online ? (noAccess ? 'bg-orange-500' : 'bg-emerald-500') : 'bg-red-500'}`} />
      </span>
      <div className="leading-tight">
        <p className="text-xs font-semibold text-navy-900">
          Agente XML <span className={online ? 'text-emerald-700' : 'text-red-600'}>● {isLoading ? '…' : online ? 'Online' : 'Offline'}</span>
        </p>
        {!compact && <p className="text-[11px] text-muted">Última comunicação: {fmtDateTime(data?.lastSeenAt)}</p>}
      </div>
      {noAccess && <AlertTriangle size={15} className="text-orange-500" aria-label="Pasta inacessível" />}
    </div>
  );
}
