import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';

// A separate SQLite exclusive transaction gives an OS-released lease, including after SIGKILL.
// It contains no household data and never depends on PID reuse or trusted proxy headers.
export function acquireDataLock(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const filename = join(directory, '.maintenance-lock.sqlite');
  closeSync(openSync(filename, 'a', 0o600));chmodSync(filename, 0o600);
  const db = new DatabaseSync(filename);
  try { db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;'); }
  catch { db.close(); throw Error('数据目录正在使用，请先停止应用'); }
  let closed = false;
  const release = () => { if (!closed) { closed = true; db.close(); } };
  process.once('exit', release);
  return () => { process.removeListener('exit', release); release(); };
}
