import { Capacitor, CapacitorHttp } from '@capacitor/core';

/** 校园服务器域名，也是直连 IPv4 时必须带的 Host 头（服务器按域名分虚拟主机） */
const NATIVE_HOST = 'sdcz.swfu.edu.cn';
const NATIVE_ORIGIN = `http://${NATIVE_HOST}`;
/**
 * 学校域名的 A 记录。它同时有 AAAA，而学校 IPv6 线路经常不通，
 * 安卓会优先连 IPv6 导致请求一直等到超时，所以原生端优先直连 IPv4。
 */
const NATIVE_IPV4_ORIGIN = 'http://202.203.134.216';

// 单个请求的最长等待时间：一个接口卡住时尽快放弃，别让整条刷新链一起等
const REQUEST_TIMEOUT = 8000;

// 记住最近一次可用的地址，后续请求不用再试探失败的线路
let preferredOrigin: string | null = null;

function timeoutError(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : '';
  return /timeout|timed out/i.test(message)
    ? new Error('校园服务器响应超时，请稍后重试')
    : cause instanceof Error
      ? cause
      : new Error('请求失败，请稍后重试');
}

/** 原生请求：优先 IPv4 直连，失败再退回域名，成功后记住可用的那条线路 */
async function postNative<T>(path: string, encoded: string): Promise<T> {
  const origins = preferredOrigin
    ? [
        preferredOrigin,
        preferredOrigin === NATIVE_IPV4_ORIGIN ? NATIVE_ORIGIN : NATIVE_IPV4_ORIGIN,
      ]
    : [NATIVE_IPV4_ORIGIN, NATIVE_ORIGIN];

  let lastError: unknown = null;
  for (const origin of origins) {
    try {
      const response = await CapacitorHttp.post({
        url: `${origin}${path}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // 直连 IP 时必须带域名 Host，否则服务器直接断开连接
          Host: NATIVE_HOST,
        },
        data: encoded,
        connectTimeout: REQUEST_TIMEOUT,
        readTimeout: REQUEST_TIMEOUT,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`校园服务器返回 ${response.status}`);
      }
      preferredOrigin = origin;
      return response.data as T;
    } catch (cause) {
      lastError = cause;
    }
  }
  throw timeoutError(lastError);
}

/**
 * 统一表单请求。
 * 浏览器里走 Vite / 自托管代理，绕开原系统的跨域限制；
 * 安卓壳里走原生 HTTP，绕开 WebView 的 CORS 与混合内容限制。
 */
export async function postForm<T>(path: string, body: Record<string, string | number>): Promise<T> {
  const payload = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    payload.append(key, String(value));
  }
  const encoded = payload.toString();

  if (Capacitor.isNativePlatform()) {
    return postNative<T>(path, encoded);
  }

  let response: Response;
  try {
    // 老 WebView 没有 AbortSignal.timeout，降级为不设超时
    const signal =
      typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(REQUEST_TIMEOUT)
        : undefined;
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encoded,
      signal,
    });
  } catch (cause) {
    throw timeoutError(cause);
  }
  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}
