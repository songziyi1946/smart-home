import type { State } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public setupRequired = false) {
    super(message);
  }
}

export async function request<T = State>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.message ?? '请求失败', response.status, data.setupRequired);
  return data;
}
