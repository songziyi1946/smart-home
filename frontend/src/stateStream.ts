import type { State } from './types';

export function subscribeState(onState: (state: State) => void, onExpired: () => void, onError: () => void) {
  const source = new EventSource('/api/events'); // Same-origin HttpOnly session cookie; no tokens in URL/storage.
  let closed = false;
  source.addEventListener('snapshot', event => {
    if (closed) return;
    try { onState(JSON.parse((event as MessageEvent<string>).data)); }
    catch { onError(); }
  });
  source.addEventListener('auth-expired', () => { if (!closed) { closed = true; source.close(); onExpired(); } });
  source.onerror = () => { if (!closed) onError(); }; // Native EventSource reconnect uses server retry/Last-Event-ID.
  return () => { closed = true; source.close(); };
}
