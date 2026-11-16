import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchDailyUsage,
  fetchLinkedAccount,
  fetchMeterStatus,
  fetchMonthlyUsage,
} from '../api/electricity';
import type { DailyUsage, MeterStatus, MonthUsage } from '../api/types';
import { shiftDays, toDateString } from '../lib/date';
import { findTodayTotal } from '../lib/estimate';
import { sameMeters, type Account } from './account';
import { useAccount } from './AccountContext';

// v2：缓存按 meterId 分表，多个户号切换后不用重新等首屏
const CACHE_KEY = 'swfu.electricity.meter.v2';
// v4：零点基线按 meterId 分表存，并记录来源；接口结算值一到就能当天内升级
const BASELINE_KEY = 'swfu.electricity.today-zero.v4';
// 记录每块表每天最后一次读到的累计值，跨天后用它当作新一天零点
const LAST_READING_KEY = 'swfu.electricity.last-reading.v4';

/** api：由接口结算的当日用量反推；history：昨天的最后读数；first：当天首次读数 */
type BaselineSource = 'api' | 'history' | 'first';

/** 今天零点时的累计读数（度） */
interface TodayZeroBaseline {
  date: string;
  zeroLeiji: number;
  source: BaselineSource;
}

interface LastReading {
  date: string;
  leiji: number;
}

export interface CachedMeter {
  meterId: string;
  status: MeterStatus;
  daily: DailyUsage[];
  monthly?: MonthUsage[];
  savedAt: number;
}

interface MeterContextValue {
  status: MeterStatus | null;
  daily: DailyUsage[];
  monthly: MonthUsage[];
  /** 今天零点时的累计读数，没有则为 null */
  todayZeroLeiji: number | null;
  loading: boolean;
  error: string | null;
  updatedAt: Date | null;
  reload: () => Promise<boolean>;
}

const MeterContext = createContext<MeterContextValue | null>(null);

/** 按 meterId 分键存储，避免切换户号时互相覆盖 */
function readMapEntry<T>(key: string, meterId: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, T> | null;
    if (!map || typeof map !== 'object') return null;
    return map[meterId] ?? null;
  } catch {
    return null;
  }
}

function writeMapEntry<T>(key: string, meterId: string, value: T): void {
  try {
    const raw = localStorage.getItem(key);
    const map: Record<string, T> = raw ? (JSON.parse(raw) as Record<string, T>) : {};
    map[meterId] = value;
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // 本地空间不足或内容损坏时静默跳过，下一次刷新仍会尝试写入
  }
}

function readCache(meterId: string): CachedMeter | null {
  const entry = readMapEntry<CachedMeter>(CACHE_KEY, meterId);
  if (!entry || !entry.status || !Array.isArray(entry.daily)) return null;
  return entry;
}

function writeCache(entry: CachedMeter): void {
  writeMapEntry(CACHE_KEY, entry.meterId, entry);
}

function persistBaseline(
  meterId: string,
  date: string,
  zeroLeiji: number,
  source: BaselineSource,
): number {
  writeMapEntry<TodayZeroBaseline>(BASELINE_KEY, meterId, { date, zeroLeiji, source });
  return zeroLeiji;
}

/** 记下当天最后一次读数，跨天后作为新一天的零点 */
function recordLastReading(meterId: string, leiji: number, now = new Date()): void {
  if (!Number.isFinite(leiji) || leiji <= 0) return;
  writeMapEntry<LastReading>(LAST_READING_KEY, meterId, { date: toDateString(now), leiji });
}

/**
 * 取今天零点的累计读数，按可信度从高到低回退：
 * 1. 接口结算的当日用量反推（最接近真实零点）；
 * 2. 昨天最后一次读数（跨天时最接近 00:00）；
 * 3. 当天首次读数（前面都缺失时兜底，会少算打开 App 之前的部分）。
 * 当天基线只在出现更可信的来源时升级，避免接口还没结算时把零点锁死。
 */
function todayZeroLeijiOf(
  meterId: string,
  leiji: number,
  todayTotal: number | null,
  now = new Date(),
): number | null {
  const todayKey = toDateString(now);
  const stored = readMapEntry<TodayZeroBaseline>(BASELINE_KEY, meterId);
  const saved = stored && stored.date === todayKey ? stored : null;

  const validLeiji = Number.isFinite(leiji) && leiji > 0;

  // total=0 多半是当天还没结算的占位行，拿它反推会把零点锁成当前读数
  if (validLeiji && todayTotal != null && todayTotal > 0 && leiji > todayTotal) {
    const apiZero = leiji - todayTotal;
    // 结算值会随当天累计增长，多次反推时取更小的基线，更接近真实零点
    if (saved && saved.source === 'api' && saved.zeroLeiji <= apiZero) return saved.zeroLeiji;
    return persistBaseline(meterId, todayKey, apiZero, 'api');
  }

  // 接口值一旦到手就是当天最可信的结果，不再被历史读数覆盖
  if (saved && saved.source === 'api') return saved.zeroLeiji;
  if (saved && saved.source === 'history') return saved.zeroLeiji;

  const yesterdayKey = toDateString(shiftDays(now, -1));
  const last = readMapEntry<LastReading>(LAST_READING_KEY, meterId);
  if (
    last &&
    last.date === yesterdayKey &&
    Number.isFinite(last.leiji) &&
    last.leiji > 0 &&
    (!validLeiji || last.leiji <= leiji)
  ) {
    return persistBaseline(meterId, todayKey, last.leiji, 'history');
  }

  // 之前记过的当天首次读数比现在更早，保留它
  if (saved) return saved.zeroLeiji;
  if (!validLeiji) return null;
  return persistBaseline(meterId, todayKey, leiji, 'first');
}

/**
 * 全局共享一份电表数据：
 * 先读本地缓存立刻出画面，再后台刷新；月度账单也一起取回，
 * 进入明细页时不会再因为补数据把下方内容顶动。
 * 账号同步与电表查询并行，实时电量先落地，历史数据后补。
 */
export function MeterProvider({ children }: { children: ReactNode }) {
  const { account, setAccount } = useAccount();
  const [status, setStatus] = useState<MeterStatus | null>(null);
  const [daily, setDaily] = useState<DailyUsage[]>([]);
  const [monthly, setMonthly] = useState<MonthUsage[]>([]);
  const [todayZeroLeiji, setTodayZeroLeiji] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // reload 稳定复用，避免同步账号信息时因为整个 account 对象变化而反复触发
  const accountRef = useRef(account);
  accountRef.current = account;
  const setAccountRef = useRef(setAccount);
  setAccountRef.current = setAccount;

  const openId = account?.openId;
  const wechatId = account?.wechatId;
  const activeMeterId = account?.meterId;

  const reload = useCallback(async (): Promise<boolean> => {
    const current = accountRef.current;
    if (!current) return false;
    setLoading(true);
    setError(null);

    try {
      // 账号同步只影响昵称头像和绑定列表，放到后台跑，不挡电表查询
      const syncTask = fetchLinkedAccount(current.openId).catch(() => null);

      let nextStatus: MeterStatus | null = null;
      let nextDaily: DailyUsage[] | null = null;
      let nextMonthly: MonthUsage[] | null = null;

      const applyBaseline = (meterStatus: MeterStatus, meterDaily: DailyUsage[] | null) => {
        setTodayZeroLeiji(
          todayZeroLeijiOf(
            current.meterId,
            Number(meterStatus.leiji),
            findTodayTotal(meterDaily ?? []),
          ),
        );
      };

      // 实时电量最先落地，首屏不用等 30 天和 6 个月的历史查询
      const statusTask = fetchMeterStatus(current).then((value) => {
        nextStatus = value;
        setStatus(value);
        // 先用昨天的最后读数建立零点，再记录今天的读数，否则跨天时会取不到昨天那条
        applyBaseline(value, nextDaily);
        recordLastReading(current.meterId, Number(value.leiji));
        return value;
      });

      const dailyTask = fetchDailyUsage(current.meterId, 30).then((value) => {
        nextDaily = value;
        setDaily(value);
        // 日记录可能带来接口结算的当天用量，让零点更准
        if (nextStatus) applyBaseline(nextStatus, value);
        return value;
      });

      const monthlyTask = fetchMonthlyUsage(current.meterId, 6).then((value) => {
        nextMonthly = value;
        setMonthly(value);
        return value;
      });

      const results = await Promise.allSettled([statusTask, dailyTask, monthlyTask]);
      const failure = results.find((item) => item.status === 'rejected');
      if (failure && failure.status === 'rejected') {
        const cause = failure.reason;
        setError(cause instanceof Error ? cause.message : '读取失败');
      }

      if (nextStatus) {
        const cached = readCache(current.meterId);
        const savedAt = Date.now();
        writeCache({
          meterId: current.meterId,
          status: nextStatus,
          daily: nextDaily ?? cached?.daily ?? [],
          monthly: nextMonthly ?? cached?.monthly ?? [],
          savedAt,
        });
        setUpdatedAt(new Date(savedAt));
      }

      // 同步公众号侧的最新绑定，新增/解绑的户号和昵称头像都会一起更新
      const linked = await syncTask;
      if (linked) {
        const active =
          linked.meters.find((meter) => meter.meterId === current.meterId) ?? linked.meters[0];
        const next: Account = {
          openId: current.openId,
          wechatId: linked.wechatId,
          nickname: linked.nickname,
          avatar: linked.avatar,
          ...active,
          meters: linked.meters,
        };
        const changed =
          next.meterId !== current.meterId ||
          next.wechatId !== current.wechatId ||
          next.nickname !== current.nickname ||
          next.avatar !== current.avatar ||
          !sameMeters(current.meters, linked.meters);

        if (changed) setAccountRef.current(next);
      }

      return results[0].status === 'fulfilled';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取失败');
      return false;
    } finally {
      setLoading(false);
    }
  }, [openId, wechatId, activeMeterId]);

  // 只跟随户号切换；昵称、头像或绑定列表更新时不清空当前电表数据
  useEffect(() => {
    if (!activeMeterId) {
      setStatus(null);
      setDaily([]);
      setMonthly([]);
      setTodayZeroLeiji(null);
      return;
    }
    const cached = readCache(activeMeterId);
    // 切换户号时读该表自己的缓存，没有缓存才回落到骨架屏
    setStatus(cached?.status ?? null);
    setDaily(cached?.daily ?? []);
    setMonthly(Array.isArray(cached?.monthly) ? cached.monthly : []);
    setUpdatedAt(cached ? new Date(cached.savedAt) : null);
    // 只有今天抓到的缓存才能反推今天的零点读数，避免把旧数据算进今日
    const savedToday = cached
      ? toDateString(new Date(cached.savedAt)) === toDateString(new Date())
      : false;
    setTodayZeroLeiji(
      savedToday && cached
        ? todayZeroLeijiOf(
            activeMeterId,
            Number(cached.status.leiji),
            findTodayTotal(cached.daily),
          )
        : null,
    );
  }, [activeMeterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // App 常驻或后台过夜时，跨天自动重算今天零点并刷新数据
  useEffect(() => {
    let lastDay = toDateString(new Date());
    const checkDay = () => {
      const day = toDateString(new Date());
      if (day === lastDay) return;
      lastDay = day;
      void reload();
    };
    const timer = window.setInterval(checkDay, 60_000);
    document.addEventListener('visibilitychange', checkDay);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkDay);
    };
  }, [reload]);

  return (
    <MeterContext.Provider value={{ status, daily, monthly, todayZeroLeiji, loading, error, updatedAt, reload }}>
      {children}
    </MeterContext.Provider>
  );
}

export function useMeter(): MeterContextValue {
  const context = useContext(MeterContext);
  if (!context) throw new Error('MeterProvider 尚未挂载');
  return context;
}
