import { randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { createEncryption, syncDirectory, writeProtected } from './encryption.mjs';

export const MijiaRegion = z.enum(['cn', 'de', 'us', 'ru', 'sg', 'tw', 'i2']);
const secret = z.string().min(1).max(8192);
const credentials = z.object({
  region: MijiaRegion,
  sid: z.literal('xiaomiio').optional(),
  userId: secret, serviceToken: secret, ssecurity: secret, deviceId: secret,
  passToken: secret.optional(), cUserId: secret.optional(), agentId: secret.optional(), clientId: secret.optional(),
}).strict();
const room = z.object({ id: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(40) }).strict();
export const MijiaConnection = z.object({
  credentials,
  homeId: z.string().min(1).max(128),
  roomBindings: z.record(z.string().min(1).max(128), room).default({}),
}).strict();

/** Credentials are separate from business SQLite/snapshots and encrypted with the household key. */
export class ProviderVault {
  constructor(directory, encryptionKey, file) {
    this.path = file ? resolve(file) : resolve(directory) + '.mijia.enc';
    const data = existsSync(directory) ? realpathSync(directory) : resolve(realpathSync(dirname(resolve(directory))), basename(directory));
    const target = resolve(realpathSync(dirname(this.path)), basename(this.path));
    const child = relative(data, target);
    if (!child || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep))) throw Error('米家凭据必须保存在业务数据目录之外');
    this.encryption = createEncryption(encryptionKey);
  }
  load() {
    let descriptor;
    try {
      descriptor = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 131072 || (process.platform !== 'win32' && stat.mode & 0o077)) throw Error();
      const value = JSON.parse(this.encryption.open(readFileSync(descriptor, 'utf8'), 'provider:mijia:v1'));
      return value === null ? null : MijiaConnection.parse(value);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw Error('米家连接凭据无法读取，请检查密钥和私有文件权限');
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
  }
  save(input) {
    const value = input === null ? null : MijiaConnection.parse(input);
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {
      writeProtected(temporary, this.encryption.seal(Buffer.from(JSON.stringify(value)), 'provider:mijia:v1'));
      renameSync(temporary, this.path);
      syncDirectory(dirname(this.path));
    } finally { rmSync(temporary, { force: true }); }
  }
}
