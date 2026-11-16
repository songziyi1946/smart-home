import { randomUUID } from 'node:crypto';
import { filterHouseholdState } from '../auth.mjs';

/** Current-state stream, not an event-history API: every reconnect gets a full snapshot. */
export function createStateStream({ snapshot, sessionFor, subscribeAuth = () => () => {}, heartbeatMs = 15000 }) {
  const epoch = randomUUID();
  let revision = 0, pending;
  const clients = new Set();
  function publish() {
    revision++;
    // Coalesce bursts from HA discovery while retaining the newest authoritative state.
    pending ??= setTimeout(() => { pending = undefined; for (const client of clients) client.send(); }, 25);
  }
  function route(req, res) {
    const session = sessionFor(req);
    if (!session) return res.status(401).json({ message: '登录已失效' });
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 1500\n\n');
    let closed = false, heartbeat, expiry, unsubscribe = () => {};
    const close = () => {
      if (closed) return;
      closed = true; clearInterval(heartbeat); clearTimeout(expiry); unsubscribe(); clients.delete(client); res.end();
    };
    function current() {
      if (closed) return;
      const current = sessionFor(req);
      if (!current) { res.write('event: auth-expired\ndata: {}\n\n'); close(); return; }
      return current;
    }
    const client = { send() {
      const currentSession = current(); if (!currentSession) return;
      const state = filterHouseholdState(snapshot(), currentSession.user);
      const frame = `id: ${epoch}:${revision}\nevent: snapshot\ndata: ${JSON.stringify(state)}\n\n`;
      // A slow client reconnects/resyncs rather than accumulating unbounded old snapshots.
      if (!res.write(frame)) close();
    }, close };
    clients.add(client);
    req.on('close', close);
    unsubscribe = subscribeAuth(() => { current(); });
    if (Number.isFinite(session.expiresAt)) expiry = setTimeout(() => { current(); }, Math.max(0, session.expiresAt - Date.now()));
    heartbeat = setInterval(() => { if (current() && !res.write(': heartbeat\n\n')) close(); }, heartbeatMs);
    client.send();
  }
  return { publish, route, close() { clearTimeout(pending); for (const client of clients) client.close(); } };
}
