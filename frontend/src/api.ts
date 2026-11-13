import type { State } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public setupRequired = false) {
    super(message);
  }
}

export async function request<T = State>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const unavailable = '无法连接 Smart Home 后端，请确认后端已启动，并且前后端使用相同的 API 端口。';
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(unavailable, 0);
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError(unavailable, response.status);
  }
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.message ?? '请求失败', response.status, data.setupRequired);
  return data;
}
