import { randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { createEncryption, syncDirectory, writeProtected } from './encryption.mjs';

const text = z.string().min(1).max(160);
const connection = z.object({
  id: z.string().uuid(), ownerId: text, name: z.string().min(1).max(80),
  protocol: z.literal('openai-responses'), baseUrl: z.string().max(2048), model: z.string().min(1).max(160),
  apiKey: z.string().min(1).max(8192), createdAt: z.string().datetime(),
}).strict();
const schema = z.object({ version: z.literal(1), connections: z.array(connection).max(1000) }).strict();
const context = 'provider:personal-ai:v1';

export class PersonalAiVault {
  constructor(directory, encryptionKey, file, env = process.env) {
    this.path = resolve(file || env.SMART_HOME_AI_VAULT_FILE || (env.SMART_HOME_MIJIA_VAULT_FILE ? resolve(dirname(env.SMART_HOME_MIJIA_VAULT_FILE), 'personal-ai.enc') : resolve(directory) + '.ai.enc'));
    this.parent = realpathSync(dirname(this.path));
    const data = existsSync(directory) ? realpathSync(directory) : resolve(realpathSync(dirname(resolve(directory))), basename(directory));
    const child = relative(data, resolve(this.parent, basename(this.path)));
    if (!child || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep))) throw Error('个人 AI 凭据必须保存在业务数据目录之外');
    this.encryption = createEncryption(encryptionKey);
  }
  checkParent() { if (realpathSync(dirname(this.path)) !== this.parent) throw Error('个人 AI 凭据目录已变化'); }
  load() {
    let fd;
    try {
      this.checkParent();
      fd = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || (process.platform !== 'win32' && stat.mode & 0o077)) throw Error();
      return schema.parse(JSON.parse(this.encryption.open(readFileSync(fd, 'utf8'), context)));
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, connections: [] };
      throw Error('个人 AI 凭据无法读取，请检查数据密钥和私有文件权限');
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  save(input) {
    const value = schema.parse(input);
    // Refuse unsafe existing files or wrong keys rather than replacing them.
    this.load(); this.checkParent();
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {
      writeProtected(temporary, this.encryption.seal(Buffer.from(JSON.stringify(value)), context));
      renameSync(temporary, this.path); syncDirectory(dirname(this.path));
    } finally { rmSync(temporary, { force: true }); }
  }
}
