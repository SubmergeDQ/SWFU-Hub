const STORAGE_KEY = 'swfu.electricity.account.v1';

export interface Account {
  openId: string;
  wechatId: string;
  meterId: string;
  userCode: string;
  meterNo: string;
  address: string;
  typeRemark: string;
  nickname: string;
  avatar: string;
}

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Account>;
    if (!parsed.openId || !parsed.wechatId || !parsed.meterId) return null;
    return parsed as Account;
  } catch {
    return null;
  }
}

export function saveAccount(account: Account): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
}

export function clearAccount(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 从公众号链接或用户粘贴的文本里取出 openId。
 * 支持整段 URL、带 openId 参数的片段，以及直接粘贴的裸 openId。
 */
export function parseOpenId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  const matched = text.match(/openId=([^&#\s]+)/i);
  if (matched) {
    const value = decodeURIComponent(matched[1]);
    return value.length >= 16 ? value : null;
  }

  return /^[A-Za-z0-9_-]{16,64}$/.test(text) ? text : null;
}
