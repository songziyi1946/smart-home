import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';

export const aiError = (status, message) => Object.assign(Error(message), { status, safeAiError: true });
const addressHost = host => host.startsWith('[') ? host.slice(1, -1) : host;
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113) || address === '168.63.129.16');
  }
  if (isIP(address) === 6) {
    const normalized = new URL(`https://[${address}]/`).hostname.slice(1,-1);
    const [first,second='0'] = normalized.split(':').map(value => value || '0');
    const a = parseInt(first,16), b = parseInt(second,16);
    // Only public global unicast; exclude transition/documentation/special-use prefixes.
    return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && a !== 0x3ffe && a !== 0x3fff && !(a === 0x2001 && (b < 0x200 || b === 0xdb8));
  }
  return false;
}
export function normalizeAiBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw aiError(400, '请输入有效的 HTTPS 服务地址'); }
  const host = addressHost(url.hostname).toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.includes('%') || (isIP(host) && !publicAddress(host))) throw aiError(400, 'AI 服务地址必须为不含凭据或查询参数的公网 HTTPS 地址');
  // Avoid path re-interpretation by proxies and append endpoints to a stable API prefix.
  if (/%2f|%5c|%2e|%00/i.test(url.pathname)) throw aiError(400, 'AI 服务地址路径无效');
  return url.href.replace(/\/+$/, '');
}
export async function resolvePublic(url, { resolve = lookup, signal } = {}) {
  const host = addressHost(url.hostname);
  const records = isIP(host) ? [{address:host,family:isIP(host)}] : await abortable(resolve(host, {all:true,verbatim:true}), signal);
  if (!Array.isArray(records) || !records.length || records.length > 64 || records.some(value => !publicAddress(value.address) || isIP(value.address) !== value.family)) throw aiError(400, 'AI 服务地址解析到了不允许访问的网络');
  return records;
}
export function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) { Promise.resolve(promise).catch(()=>{}); return Promise.reject(aiError(499, 'AI 请求已取消')); }
  return new Promise((resolve,reject) => {
    const abort = () => reject(aiError(499, 'AI 请求已取消'));
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
/** Pin each request's already-checked DNS answers; never use redirects or a proxy environment. */
export function pinnedHttpsRequest({ url, addresses, method, headers, body, signal, maxBytes = 4 * 1024 * 1024 }) {
  return new Promise((resolve,reject) => {
    const req = request(url, {
      method, headers, signal, agent:false,
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, addresses);
        else callback(null,addresses[0].address,addresses[0].family);
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); reject(aiError(502, 'AI 服务不允许重定向，请检查接口地址')); return; }
      const chunks=[]; let size=0;
      res.on('data', chunk => { size+=chunk.length; if (size>maxBytes) {res.destroy();reject(aiError(502, 'AI 服务响应过大'));} else chunks.push(chunk); });
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
      res.on('error',()=>reject(aiError(502, 'AI 服务连接中断')));
      res.on('aborted',()=>reject(aiError(502, 'AI 服务连接中断')));
    });
    req.on('error',()=>reject(aiError(signal?.aborted?499:502,signal?.aborted?'AI 请求已取消':'无法连接 AI 服务，请检查地址和网络')));
    if (body) req.write(body);
    req.end();
  });
}
