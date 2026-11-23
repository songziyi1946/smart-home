import { useEffect, useState } from 'react';

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export type Installation = {
  installed: boolean;
  available: boolean;
  secure: boolean;
  pending: boolean;
  error: string;
  install: () => Promise<void>;
};

export function useInstallation(): Installation {
  const [prompt, setPrompt] = useState<InstallPrompt>();
  const [installed, setInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches ||
    !!(navigator as Navigator & { standalone?: boolean }).standalone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const query = window.matchMedia('(display-mode: standalone)');
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => { setInstalled(true); setPrompt(undefined); };
    const onDisplayChange = () => setInstalled(query.matches ||
      !!(navigator as Navigator & { standalone?: boolean }).standalone);
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    query.addEventListener('change', onDisplayChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      query.removeEventListener('change', onDisplayChange);
    };
  }, []);
  async function install() {
    if (!prompt || pending) return;
    setPending(true); setError(''); setPrompt(undefined);
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { setError('暂时无法打开安装窗口，请使用浏览器菜单添加到桌面。'); }
    finally { setPending(false); }
  }
  return { installed, available: !!prompt, secure: window.isSecureContext, pending, error, install };
}

export async function registerPwa() {
  if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
    // Only the public offline page is cached; household data always comes from the server.
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  }
}
