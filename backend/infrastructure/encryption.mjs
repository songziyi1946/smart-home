import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';

export function createEncryption(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('数据密钥必须为 32 字节');
  const secret = Buffer.from(key);
  return {
    seal(bytes, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', secret, iv, { authTagLength: 16 });
      cipher.setAAD(Buffer.from(context));
      const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
    },
    open(envelope, context) {
      try {
        const value = JSON.parse(envelope);
        if (value.v !== 1 || typeof value.data !== 'string') throw Error();
        const iv = Buffer.from(value.iv, 'base64'), tag = Buffer.from(value.tag, 'base64');
        if (iv.length !== 12 || tag.length !== 16) throw Error();
        const decipher = createDecipheriv('aes-256-gcm', secret, iv, { authTagLength: 16 });
        decipher.setAAD(Buffer.from(context));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]);
      } catch { throw Error('数据解密失败：密钥不匹配或数据已损坏'); }
    },
  };
}

export function writeProtected(path, bytes) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(resolve(path, '..'));
}

export function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function readKeyFile(path, dataDirectory) {
  const keyPath = resolve(path), directory = resolve(dataDirectory);
  if (keyPath === directory || keyPath.startsWith(directory + sep)) throw Error('密钥必须保存在家庭数据目录之外');
  let fd;
  try {
    const physicalDirectory = existsSync(directory) ? realpathSync(directory) : resolve(realpathSync(dirname(directory)),basename(directory));
    const physicalKey = realpathSync(keyPath);
    if (physicalKey === physicalDirectory || physicalKey.startsWith(physicalDirectory + sep)) throw Error();
    fd = openSync(keyPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw Error();
    const text = readFileSync(fd, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/i.test(text)) throw Error();
    return Buffer.from(text, 'hex');
  } catch { throw Error('无法读取数据密钥：需独立的 600 权限文件，内容为 64 位十六进制密钥'); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function loadStorageKey(directory, env = process.env) {
  const configured = env.SMART_HOME_DATA_KEY_FILE;
  if (!configured && (env.NODE_ENV === 'production' || env.SMART_HOME_DEPLOYMENT_MODE === 'https')) throw Error('生产部署必须配置 SMART_HOME_DATA_KEY_FILE');
  const path = configured || resolve(directory) + '.key';
  if (!configured) {
    // Never replace a missing key for an existing database.
    try { return readKeyFile(path, directory); } catch (error) {
      let database;
      try { database = openSync(resolve(directory, 'home.sqlite'), 'r'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (database !== undefined) { closeSync(database); throw error; }
      try { writeProtected(path, randomBytes(32).toString('hex') + '\n'); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
  return readKeyFile(path, directory);
}
