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
import { findDayTotal, findTodayTotal } from '../lib/estimate';
import { sameMeters, type Account } from './account';
import { useAccount } from './AccountContext';

// v2：缓存按 meterId 分表，多个户号切换后不用重新等首屏
const CACHE_KEY = 'swfu.electricity.meter.v2';
// v5：零点基线按 meterId 分表存，记录来源与建立时刻；接口结算值一到就能当天内升级
const BASELINE_KEY = 'swfu.electricity.today-zero.v5';
// 记录每块表每天最后一次读到的累计值和时间，跨天后用它估算新一天零点
const LAST_READING_KEY = 'swfu.electricity.last-reading.v5';

/** api：由接口结算的当日用量反推；history：昨天的最后读数；first：当天首次读数 */
type BaselineSource = 'api' | 'history' | 'first';

/** 今天零点时的累计读数（度） */
interface TodayZeroBaseline {
  date: string;
  zeroLeiji: number;
  source: BaselineSource;
  /** 基线建立时刻，用来判断是否紧贴 0 点 */
  at: number;
  /** 零点是否为估算值 */
  approximate: boolean;
}

interface LastReading {
  date: string;
  leiji: number;
  at: number;
}

/** 零点读数及其可信程度 */
interface TodayZeroResult {
  zeroLeiji: number;
  /** 能不能用来推算当日用量；false 时界面显示「—」 */
  usable: boolean;
  /** 是否为估算值 */
  approximate: boolean;
}

// 当天首次读数落在 0 点后这 15 分钟内，漏算的部分可以忽略
const MIDNIGHT_WINDOW_MS = 15 * 60 * 1000;
// 昨天最后读数离 0 点超过半小时，就要按时间比例补一段估算
const HISTORY_APPROXIMATE_HOURS = 0.5;

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
  /** 零点读数是否为估算值 */
  todayZeroApproximate: boolean;
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
  at: Date,
  approximate: boolean,
): number {
  writeMapEntry<TodayZeroBaseline>(BASELINE_KEY, meterId, {
    date,
    zeroLeiji,
    source,
    at: at.getTime(),
    approximate,
  });
  return zeroLeiji;
}

/** 记下当天最后一次读数，跨天后用它估算新一天的零点 */
function recordLastReading(meterId: string, leiji: number, now = new Date()): void {
  if (!Number.isFinite(leiji) || leiji <= 0) return;
  writeMapEntry<LastReading>(LAST_READING_KEY, meterId, {
    date: toDateString(now),
    leiji,
    at: now.getTime(),
  });
}

/** 当天首次读数是否紧贴 0 点，紧贴时漏算的部分可以忽略 */
function withinMidnightWindow(at: number): boolean {
  const date = new Date(at);
  return date.getHours() === 0 && date.getMinutes() < MIDNIGHT_WINDOW_MS / 60000;
}

/**
 * 取今天零点的累计读数，按可信度从高到低回退：
 * 1. 接口结算的当日用量反推（最准确）；
 * 2. 昨天最后一次读数，按离 0 点的时间比例补上估算的夜间消耗；
 * 3. 当天首次读数，只有紧贴 0 点时才可信，否则宁可显示「—」。
 * 当天基线只在出现更可信的来源时升级，避免接口还没结算时把零点锁死。
 */
function todayZeroLeijiOf(
  meterId: string,
  leiji: number,
  todayTotal: number | null,
  yesterdayTotal: number | null,
  now = new Date(),
): TodayZeroResult | null {
  const todayKey = toDateString(now);
  const stored = readMapEntry<TodayZeroBaseline>(BASELINE_KEY, meterId);
  const saved = stored && stored.date === todayKey ? stored : null;
  const validLeiji = Number.isFinite(leiji) && leiji > 0;

  // total=0 多半是当天还没结算的占位行，拿它反推会把零点锁成当前读数
  if (validLeiji && todayTotal != null && todayTotal > 0 && leiji > todayTotal) {
    const apiZero = leiji - todayTotal;
    // 结算值会随当天累计增长，多次反推时取更小的基线，更接近真实零点
    if (saved && saved.source === 'api' && saved.zeroLeiji <= apiZero) {
      return { zeroLeiji: saved.zeroLeiji, usable: true, approximate: false };
    }
    const zeroLeiji = persistBaseline(meterId, todayKey, apiZero, 'api', now, false);
    return { zeroLeiji, usable: true, approximate: false };
  }

  // 接口值一旦到手就是当天最可信的结果，不再被历史读数覆盖
  if (saved && saved.source === 'api') {
    return { zeroLeiji: saved.zeroLeiji, usable: true, approximate: false };
  }
  // 0 点刚过就抓到读数时，它比用昨天的读数外推更准
  if (saved && saved.source === 'first' && withinMidnightWindow(saved.at)) {
    return { zeroLeiji: saved.zeroLeiji, usable: true, approximate: false };
  }
  const yesterdayKey = toDateString(shiftDays(now, -1));
  const last = readMapEntry<LastReading>(LAST_READING_KEY, meterId);
  const lastUsable = Boolean(
    last &&
      last.date === yesterdayKey &&
      Number.isFinite(last.leiji) &&
      last.leiji > 0 &&
      Number.isFinite(last.at) &&
      (!validLeiji || last.leiji <= leiji),
  );

  // 昨天的读数已经被今天的记录覆盖时，直接沿用当天已经建好的基线
  if (saved && saved.source === 'history' && !lastUsable) {
    return { zeroLeiji: saved.zeroLeiji, usable: true, approximate: saved.approximate };
  }

  if (last && lastUsable) {
    // 昨天最后读数不一定贴着 0 点，用它当天零点会多算那段夜间用电，
    // 按昨天全天总量和时间比例补一段，减少跨天误差
    const lastAt = new Date(last.at);
    const hour = lastAt.getHours() + lastAt.getMinutes() / 60 + lastAt.getSeconds() / 3600;
    const gapHours = Math.max(0, 24 - hour);
    const gapEstimate =
      yesterdayTotal != null && yesterdayTotal > 0
        ? (yesterdayTotal * gapHours) / 24
        : 0;
    const zeroLeiji = last.leiji + gapEstimate;
    // 估出来的零点不应该超过当前读数，超过了说明数据不可信
    if (validLeiji && zeroLeiji > leiji) return null;

    const approximate = gapHours > HISTORY_APPROXIMATE_HOURS;
    persistBaseline(meterId, todayKey, zeroLeiji, 'history', now, approximate);
    return { zeroLeiji, usable: true, approximate };
  }

  // 之前记过的当天首次读数比现在更早，保留它；但只有紧贴 0 点才能用来算当日用量
  if (saved) {
    return {
      zeroLeiji: saved.zeroLeiji,
      usable: withinMidnightWindow(saved.at),
      approximate: saved.approximate,
    };
  }
  if (!validLeiji) return null;
  persistBaseline(meterId, todayKey, leiji, 'first', now, false);
  return { zeroLeiji: leiji, usable: withinMidnightWindow(now.getTime()), approximate: false };
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
  const [todayZeroApproximate, setTodayZeroApproximate] = useState(false);
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

      const applyBaseline = (meterStatus: MeterStatus, meterDaily: DailyUsage[] | null) => {
        const now = new Date();
        const yesterdayKey = toDateString(shiftDays(now, -1));
        const baseline = todayZeroLeijiOf(
          current.meterId,
          Number(meterStatus.leiji),
          findTodayTotal(meterDaily ?? [], now),
          findDayTotal(meterDaily ?? [], yesterdayKey),
          now,
        );
        // 没有可信零点时传 null，界面显示「—」，不要用 0 误导
        setTodayZeroLeiji(baseline && baseline.usable ? baseline.zeroLeiji : null);
        setTodayZeroApproximate(baseline && baseline.usable ? baseline.approximate : false);
      };

      // 实时电量最先落地，首屏不用等 30 天和 6 个月的历史查询
      const statusTask = fetchMeterStatus(current).then((value) => {
        nextStatus = value;
        setStatus(value);
        applyBaseline(value, nextDaily);
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
        setMonthly(value);
        return value;
      });

      const [statusResult, dailyResult, monthlyResult] = await Promise.allSettled([
        statusTask,
        dailyTask,
        monthlyTask,
      ]);
      const failed = [statusResult, dailyResult, monthlyResult].find(
        (item) => item.status === 'rejected',
      );
      if (failed && failed.status === 'rejected') {
        const cause = failed.reason;
        setError(cause instanceof Error ? cause.message : '读取失败');
      }

      if (statusResult.status === 'fulfilled') {
        const finalStatus = statusResult.value;
        // 所有数据都取完再记今天的读数，避免覆盖掉建立零点要用的昨天那条
        recordLastReading(current.meterId, Number(finalStatus.leiji));
        const cached = readCache(current.meterId);
        const savedAt = Date.now();
        writeCache({
          meterId: current.meterId,
          status: finalStatus,
          daily: dailyResult.status === 'fulfilled' ? dailyResult.value : cached?.daily ?? [],
          monthly:
            monthlyResult.status === 'fulfilled' ? monthlyResult.value : cached?.monthly ?? [],
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

      return statusResult.status === 'fulfilled';
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
      setTodayZeroApproximate(false);
      return;
    }
    const cached = readCache(activeMeterId);
    // 切换户号时读该表自己的缓存，没有缓存才回落到骨架屏
    setStatus(cached?.status ?? null);
    setDaily(cached?.daily ?? []);
    setMonthly(Array.isArray(cached?.monthly) ? cached.monthly : []);
    setUpdatedAt(cached ? new Date(cached.savedAt) : null);
    // 只有今天抓到的缓存才能反推今天的零点读数，避免把旧数据算进今日
    const now = new Date();
    const savedToday = cached
      ? toDateString(new Date(cached.savedAt)) === toDateString(now)
      : false;
    if (savedToday && cached) {
      const baseline = todayZeroLeijiOf(
        activeMeterId,
        Number(cached.status.leiji),
        findTodayTotal(cached.daily, now),
        findDayTotal(cached.daily, toDateString(shiftDays(now, -1))),
        now,
      );
      setTodayZeroLeiji(baseline && baseline.usable ? baseline.zeroLeiji : null);
      setTodayZeroApproximate(baseline && baseline.usable ? baseline.approximate : false);
    } else {
      setTodayZeroLeiji(null);
      setTodayZeroApproximate(false);
    }
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
    <MeterContext.Provider
      value={{
        status,
        daily,
        monthly,
        todayZeroLeiji,
        todayZeroApproximate,
        loading,
        error,
        updatedAt,
        reload,
      }}
    >
      {children}
    </MeterContext.Provider>
  );
}

export function useMeter(): MeterContextValue {
  const context = useContext(MeterContext);
  if (!context) throw new Error('MeterProvider 尚未挂载');
  return context;
}
