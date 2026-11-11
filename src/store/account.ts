const STORAGE_KEY = 'swfu.electricity.account.v1';

/** 一个微信号下的单个户号（电表） */
export interface MeterBinding {
  meterId: string;
  userCode: string;
  meterNo: string;
  address: string;
  typeRemark: string;
}

export interface Account extends MeterBinding {
  openId: string;
  wechatId: string;
  nickname: string;
  avatar: string;
  /** 该微信号绑定的全部户号，至少一项 */
  meters: MeterBinding[];
}

/** 连接公众号后、选宿舍前的账号信息 */
export interface LinkedAccount {
  openId: string;
  wechatId: string;
  nickname: string;
  avatar: string;
  meters: MeterBinding[];
}

/** 兼容旧版单户号结构：没有 meters 时用当前扁平字段补齐 */
function normalizeAccount(parsed: Partial<Account>): Account | null {
  if (!parsed.openId || !parsed.wechatId || !parsed.meterId) return null;

  const current: MeterBinding = {
    meterId: parsed.meterId,
    userCode: parsed.userCode || '',
    meterNo: parsed.meterNo || '',
    address: parsed.address || '',
    typeRemark: parsed.typeRemark || '',
  };
  const meters = Array.isArray(parsed.meters)
    ? parsed.meters.filter((item) => item && typeof item.meterId === 'string' && item.meterId)
    : [];
  if (!meters.length) meters.push(current);

  return {
    openId: parsed.openId,
    wechatId: parsed.wechatId,
    nickname: parsed.nickname || '',
    avatar: parsed.avatar || '',
    ...current,
    meters,
  };
}

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeAccount(JSON.parse(raw) as Partial<Account>);
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

/** 用绑定列表和选中的户号生成可持久化账号，未指定时默认第一间 */
export function buildAccount(linked: LinkedAccount, meterId?: string): Account {
  const active = linked.meters.find((meter) => meter.meterId === meterId) ?? linked.meters[0];
  return {
    openId: linked.openId,
    wechatId: linked.wechatId,
    nickname: linked.nickname,
    avatar: linked.avatar,
    ...active,
    meters: linked.meters,
  };
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
