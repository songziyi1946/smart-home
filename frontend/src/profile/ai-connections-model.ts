import type { Session } from '../types';

export type AIConnection = { id: string; name: string; baseUrl: string; model: string; hasKey: true; createdAt: string };
export type AIConnectionInput = { name: string; baseUrl: string; model: string; apiKey: string };

export function aiConnectionOwnerKey(session: Session) {
  if (session.localPreview || session.user.role === 'guest') return undefined;
  return `${session.household.id}:${session.user.id}:${session.loggedInAt}`;
}

export function validateAIConnectionInput(input: AIConnectionInput) {
  if (!input.name.trim() || input.name.trim().length > 80) return '请输入服务名称（最多 80 字）';
  if (!input.model.trim() || input.model.trim().length > 160) return '请输入模型名称（最多 160 字）';
  if (!input.apiKey.trim() || input.apiKey.trim().length > 8192 || !/^[\x21-\x7e]+$/.test(input.apiKey.trim())) return '请输入有效的 API 密钥';
  try {
    const url = new URL(input.baseUrl.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '接口地址须为 HTTPS，不能包含账号、密码或查询参数';
  } catch { return '请输入有效的 HTTPS 接口地址'; }
  return undefined;
}
