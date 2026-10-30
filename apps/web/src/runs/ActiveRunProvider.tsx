import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RUN_STATUS_LABELS, describePeriod, type RunEventDTO } from '@gestao/shared';
import { get } from '../api/client';
import { subscribeRun } from '../api/sse';
import { useAuth } from '../auth/AuthContext';
import { showWindowsNotification } from '../lib/browserNotifications';

interface ActiveRunState {
  active: RunEventDTO | null;
  finished: RunEventDTO | null;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  /** Começa a acompanhar uma execução recém-criada. */
  track: (e: RunEventDTO) => void;
  dismissSummary: () => void;
}

const Ctx = createContext<ActiveRunState | null>(null);

/**
 * Acompanha a execução em andamento em qualquer página. O estado vem do banco
 * (GET /runs/active), então sobrevive a trocas de página e ao fechamento do navegador.
 */
export function ActiveRunProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [active, setActive] = useState<RunEventDTO | null>(null);
  const [finished, setFinished] = useState<RunEventDTO | null>(null);
  const [minimized, setMinimized] = useState(false);
  const subscribedId = useRef<number | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  const onDone = useCallback(
    (e: RunEventDTO) => {
      setActive(null);
      setFinished(e);
      subscribedId.current = null;
      unsubscribe.current?.();
      unsubscribe.current = null;
      const r = e.run;
      showWindowsNotification(
        `Pesquisa #${r.id} — ${RUN_STATUS_LABELS[r.status]}`,
        `${describePeriod(r.year, r.month)} · Novos: ${r.newFiles} · Já importados: ${r.duplicates} · Erros: ${r.errors}`,
      );
      void qc.invalidateQueries();
    },
    [qc],
  );

  const follow = useCallback(
    (e: RunEventDTO) => {
      setActive(e);
      if (subscribedId.current === e.run.id) return;
      unsubscribe.current?.();
      subscribedId.current = e.run.id;
      unsubscribe.current = subscribeRun(e.run.id, {
        onEvent: (ev, name) => {
          if (name === 'done') onDone(ev);
          else setActive(ev);
        },
      });
    },
    [onDone],
  );

  useEffect(() => {
    if (!user) {
      unsubscribe.current?.();
      unsubscribe.current = null;
      subscribedId.current = null;
      setActive(null);
      return;
    }
    let stop = false;
    const check = async () => {
      if (subscribedId.current) return;
      try {
        const e = await get<RunEventDTO | null>('/runs/active');
        if (!stop && e) follow(e);
      } catch {
        // tenta novamente no próximo ciclo
      }
    };
    void check();
    const t = setInterval(check, 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [user, follow]);

  useEffect(() => () => unsubscribe.current?.(), []);

  const track = useCallback(
    (e: RunEventDTO) => {
      setFinished(null);
      setMinimized(false);
      if (['QUEUED', 'RUNNING'].includes(e.run.status)) follow(e);
      else onDone(e);
    },
    [follow, onDone],
  );

  return (
    <Ctx.Provider value={{ active, finished, minimized, setMinimized, track, dismissSummary: () => setFinished(null) }}>{children}</Ctx.Provider>
  );
}

export function useActiveRun() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useActiveRun fora do ActiveRunProvider');
  return c;
}
