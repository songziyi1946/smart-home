import { isIP } from 'node:net';

function address(value) {
  if (typeof value !== 'string' || !isIP(value)) return;
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) return value.slice(7);
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}

export function clientAddressPolicy(env = process.env) {
  const configured = env.SMART_HOME_TRUSTED_PROXY_IP;
  const trusted = address(configured);
  if (configured && !trusted) throw Error('SMART_HOME_TRUSTED_PROXY_IP 必须是单一 IP 地址');
  return req => {
    const peer = address(req.socket.remoteAddress);
    if (trusted && peer === trusted) {
      const client = address(req.get('X-Smart-Home-Client-IP'));
      if (!client) throw Object.assign(Error('受信代理缺少有效客户端地址'), { status: 400 });
      return client;
    }
    return peer ?? 'unknown-peer';
  };
}
