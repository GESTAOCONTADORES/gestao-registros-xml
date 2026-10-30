import { useEffect, useState } from 'react';

const KEY = 'dp.windowsNotifications';
const EVENT = 'dp:windows-notifications';

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export function isWindowsNotificationsEnabled(): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function store(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // armazenamento indisponível: preferência vale só para esta sessão
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Ativa/desativa as notificações do Windows (Web Notifications API). */
export async function setWindowsNotifications(on: boolean): Promise<{ ok: boolean; message?: string }> {
  if (!notificationsSupported()) return { ok: false, message: 'Este navegador não suporta notificações.' };
  if (!on) {
    store(false);
    return { ok: true };
  }
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    store(false);
    return { ok: false, message: 'Permissão negada. Libere as notificações nas configurações do navegador.' };
  }
  store(true);
  return { ok: true };
}

export function showWindowsNotification(title: string, body: string) {
  if (!isWindowsNotificationsEnabled()) return;
  try {
    new Notification(title, { body, tag: 'dp-registros-xml' });
  } catch {
    // alguns navegadores exigem service worker; ignora
  }
}

export function useWindowsNotifications() {
  const [enabled, setEnabled] = useState(isWindowsNotificationsEnabled);
  useEffect(() => {
    const update = () => setEnabled(isWindowsNotificationsEnabled());
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return {
    enabled,
    supported: notificationsSupported(),
    permission: notificationsSupported() ? Notification.permission : 'denied',
    toggle: (on: boolean) => setWindowsNotifications(on),
  };
}
