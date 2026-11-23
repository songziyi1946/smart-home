import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { writeProtected } from '../backend/infrastructure/encryption.mjs';

function integer(value, min, max, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < min || Number(value) > max) throw Error(`${name}超出范围`);
  return Number(value);
}

export function createHousehold({ directory, id, port = 3101, slot = 47 }) {
  if (process.getuid?.() === 0 || process.getgid?.() === 0) throw Error('请使用运行家庭服务的非 root 用户初始化目录');
  if (!directory || !isAbsolute(directory) || /['"\r\n\0]/.test(directory)) throw Error('请使用不含引号或换行的绝对目录');
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id ?? '')) throw Error('实例标识需为小写字母开头的 1–40 位字母、数字或连字符');
  port = integer(port, 1024, 65535, '本机端口');
  slot = integer(slot, 0, 255, '网络编号');
  const root = resolve(directory), data = join(root, 'data'), secrets = join(root, 'secrets'), key = join(secrets, 'data.key');
  // Exclusive creation prevents touching an existing household or an existing symlink.
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(data, { mode: 0o700 });
  mkdirSync(secrets, { mode: 0o700 });
  writeProtected(key, randomBytes(32).toString('hex') + '\n');
  const local = {
    SMART_HOME_DATA_DIR: data, SMART_HOME_DATA_KEY_FILE: key,
    SMART_HOME_DEPLOYMENT_MODE: 'local', SMART_HOME_API_HOST: '127.0.0.1', SMART_HOME_API_PORT: String(port),
    SMART_HOME_BOOTSTRAP_TOKEN: '', SMART_HOME_TRUSTED_PROXY_IP: '',
    HA_URL: '', HA_TOKEN: '', HA_ENTITY_PREFIX: '', HA_ROOMS_FILE: '',
  };
  const compose = {
    SMART_HOME_INSTANCE_NAME: id, SMART_HOME_DOMAIN: `${id}.example.com`,
    SMART_HOME_HOST_DATA_DIR: data, SMART_HOME_DATA_KEY_HOST_FILE: key,
    SMART_HOME_UID: String(process.getuid?.() ?? 1000), SMART_HOME_GID: String(process.getgid?.() ?? 1000),
    SMART_HOME_LOCAL_PORT: String(port), SMART_HOME_HTTP_PORT: '80', SMART_HOME_HTTPS_PORT: '443',
    SMART_HOME_DOCKER_SUBNET: `172.30.${slot}.0/24`, SMART_HOME_APP_IP: `172.30.${slot}.2`, SMART_HOME_CADDY_IP: `172.30.${slot}.3`,
    SMART_HOME_BOOTSTRAP_TOKEN: '', HA_URL: '', HA_TOKEN: '', HA_ENTITY_PREFIX: '',
  };
  const serialize = env => Object.entries(env).map(([name, value]) => `${name}='${value}'`).join('\n') + '\n';
  writeProtected(join(root, '.env.local'), serialize(local));
  writeProtected(join(root, '.env.compose'), '# Set your public hostname before deployment. Initialize locally first.\n' + serialize(compose));
  return root;
}

function run(command, args, env) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env }, stdio: 'inherit',
  });
  const stop = () => child.kill('SIGTERM');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  child.once('error', () => { console.error('家庭服务启动失败，请检查配置和 Node.js 版本'); process.exitCode = 1; });
  child.once('exit', code => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop);
    process.exitCode = code ?? 1;
  });
  return child;
}

function config(directory, filename) {
  if (!directory || !isAbsolute(directory)) throw Error('请指定家庭的绝对目录');
  return parseEnv(readFileSync(join(directory, filename), 'utf8'));
}

export function startHousehold(directory) {
  return run(process.execPath, [fileURLToPath(new URL('../backend/server.mjs', import.meta.url))], config(directory, '.env.local'));
}

export function main(args = process.argv.slice(2)) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    directory: { type: 'string' }, id: { type: 'string' }, port: { type: 'string' }, slot: { type: 'string' },
  } });
  const [command, ...composeArgs] = positionals;
  if (command === 'compose' && composeArgs.length) {
    const env = config(values.directory, '.env.compose');
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(env.SMART_HOME_INSTANCE_NAME ?? '')) throw Error('家庭配置中的实例标识无效');
    integer(env.SMART_HOME_UID, 1, 4294967294, '非 root 用户 ID');
    integer(env.SMART_HOME_GID, 1, 4294967294, '非 root 用户组 ID');
    if (composeArgs.some(value => /^-(?:p|f)|^--(?:project-name|file|env-file|project-directory)(?:=|$)/.test(value))) throw Error('家庭入口不接受覆盖项目、文件或环境配置的参数');
    return run('docker', ['compose', '--project-name', env.SMART_HOME_INSTANCE_NAME, '-f', fileURLToPath(new URL('../compose.yaml', import.meta.url)), '--env-file', join(values.directory, '.env.compose'), ...composeArgs], env);
  }
  if (positionals.length !== 1 || !['init', 'start'].includes(command)) throw Error('用法: create-household.mjs init --directory ABSOLUTE_PATH --id NAME [--port 3101 --slot 47]，或 start --directory ABSOLUTE_PATH，或 compose --directory ABSOLUTE_PATH -- DOCKER_COMPOSE_ARGS');
  if (command === 'start') return startHousehold(values.directory);
  const root = createHousehold(values);
  console.log(`独立家庭目录已创建：${root}。通过 start 子命令在本机初始化家庭。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error(error.code === 'EEXIST' ? '目录已存在，未覆盖任何文件；请使用新的家庭目录。' : error.message); process.exitCode = 1; }
}
