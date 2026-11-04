import { Capacitor, CapacitorHttp } from '@capacitor/core';

/** 校园服务器地址，仅原生环境使用；浏览器端走同源代理 */
const NATIVE_ORIGIN = 'http://sdcz.swfu.edu.cn';

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
    const response = await CapacitorHttp.post({
      url: `${NATIVE_ORIGIN}${path}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: encoded,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`校园服务器返回 ${response.status}`);
    }
    return response.data as T;
  }

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encoded,
  });
  if (!response.ok) {
    throw new Error(`请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
}
