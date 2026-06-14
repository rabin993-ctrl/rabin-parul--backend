import { Platform } from 'react-native';

const fallbackBaseUrl = Platform.OS === 'android'
  ? 'http://10.0.2.2:8080/v1'
  : 'http://localhost:8080/v1';

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL?.trim() || fallbackBaseUrl
).replace(/\/+$/, '');

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message || `Request failed with status ${status}.`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error?.code || 'REQUEST_FAILED';
    this.details = body.error?.details;
    this.requestId = body.error?.requestId;
  }
}

let accessToken: string | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;
let invalidSessionHandler: (() => void) | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setApiAccessToken(token: string | null): void {
  accessToken = token;
}

export function configureApiSession(options: {
  refresh: () => Promise<string | null>;
  onInvalidSession: () => void;
}): () => void {
  refreshHandler = options.refresh;
  invalidSessionHandler = options.onInvalidSession;
  return () => {
    refreshHandler = null;
    invalidSessionHandler = null;
  };
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return text || undefined;
}

async function execute<T>(
  path: string,
  init: RequestInit,
  authenticated: boolean,
  canRetry: boolean,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (authenticated && accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (response.status === 401 && authenticated && canRetry && refreshHandler) {
    refreshPromise ??= refreshHandler().finally(() => {
      refreshPromise = null;
    });
    const nextToken = await refreshPromise;
    if (nextToken) {
      setApiAccessToken(nextToken);
      return execute<T>(path, init, authenticated, false);
    }
    invalidSessionHandler?.();
  }

  const body = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, (body ?? {}) as ApiErrorBody);
  }
  return body as T;
}

export function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: HeadersInit;
    authenticated?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  return execute<T>(
    path,
    {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    },
    options.authenticated ?? true,
    true,
  );
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function clientIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
