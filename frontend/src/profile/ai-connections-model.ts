import type { Session } from '../types';

export type AIConnection = { id: string; name: string; baseUrl: string; model: string; hasKey: true; createdAt: string };
export type AIConnectionInput = { name: string; baseUrl: string; model: string; apiKey: string };

export function aiConnectionOwnerKey(session: Session) {
  if (session.localPreview || session.user.role === 'guest') return undefined;
  return `${session.household.id}:${session.user.id}:${session.loggedInAt}`;
}

export type AIConnectionFieldErrors = Partial<Record<keyof AIConnectionInput, string>>;
export function validateAIConnectionInput(input: AIConnectionInput): AIConnectionFieldErrors {
  const errors: AIConnectionFieldErrors = {};
  if (!input.name.trim()) errors.name = '请填写服务名称';
  else if (input.name.trim().length > 80) errors.name = '服务名称最多 80 字';
  if (!input.baseUrl.trim()) errors.baseUrl = '请填写接口地址';
  else try {
    const url = new URL(input.baseUrl.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) errors.baseUrl = '接口地址须为 HTTPS，不能包含账号、密码或查询参数';
  } catch { errors.baseUrl = '请输入有效的 HTTPS 接口地址'; }
  if (!input.model.trim()) errors.model = '请填写模型名称';
  else if (input.model.trim().length > 160) errors.model = '模型名称最多 160 字';
  if (!input.apiKey.trim()) errors.apiKey = '请填写 API 密钥';
  else if (input.apiKey.trim().length > 8192 || !/^[\x21-\x7e]+$/.test(input.apiKey.trim())) errors.apiKey = '请输入有效的 API 密钥';
  return errors;
}
