import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchDailyUsage, fetchMeterStatus, fetchMonthlyUsage } from '../api/electricity';
import type { DailyUsage, MeterStatus, MonthUsage } from '../api/types';
import { toDateString } from '../lib/date';
import { useAccount } from './AccountContext';

const CACHE_KEY = 'swfu.electricity.meter.v1';
const BASELINE_KEY = 'swfu.electricity.today-baseline.v1';

/** 当天首次观测到的本期累计电量，用来补出接口还没结算的今日用量 */
interface TodayBaseline {
  meterId: string;
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
  /** 今天首次观测到的本期累计电量，没有则为 null */
  todayBaseline: number | null;
  loading: boolean;
  error: string | null;
  updatedAt: Date | null;
  reload: () => Promise<boolean>;
}

const MeterContext = createContext<MeterContextValue | null>(null);

function readCache(meterId: string): CachedMeter | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMeter;
    if (parsed.meterId !== meterId || !parsed.status || !Array.isArray(parsed.daily)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry: CachedMeter): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // 本地空间不足时静默跳过，下一次刷新仍会尝试写入
  }
}

function readBaseline(meterId: string): TodayBaseline | null {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TodayBaseline>;
    if (parsed.meterId !== meterId || !parsed.date || !Number.isFinite(parsed.leiji)) return null;
    return parsed as TodayBaseline;
  } catch {
    return null;
  }
}

function writeBaseline(entry: TodayBaseline): void {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(entry));
  } catch {
    // 本地空间不足时静默跳过，下次刷新会重新建立基线
  }
}

/** 取出当天的累计电量基线；跨天或换表后旧基线立即失效 */
function todayBaselineOf(meterId: string, leiji: number): number | null {
  const todayKey = toDateString(new Date());
  const stored = readBaseline(meterId);
  if (stored && stored.date === todayKey && leiji >= stored.leiji) return stored.leiji;
  if (!Number.isFinite(leiji)) return null;
  // 首次观测或累计值被清零（如月初重算）时，把当前读数当作今天的起点
  writeBaseline({ meterId, date: todayKey, leiji });
  return leiji;
}

/**
 * 全局共享一份电表数据：
 * 先读本地缓存立刻出画面，再后台刷新；月度账单也一起取回，
 * 进入明细页时不会再因为补数据把下方内容顶动。
 */
export function MeterProvider({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const [status, setStatus] = useState<MeterStatus | null>(null);
  const [daily, setDaily] = useState<DailyUsage[]>([]);
  const [monthly, setMonthly] = useState<MonthUsage[]>([]);
  const [todayBaseline, setTodayBaseline] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const reload = useCallback(async (): Promise<boolean> => {
    if (!account) return false;
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextDaily, nextMonthly] = await Promise.all([
        fetchMeterStatus(account),
        fetchDailyUsage(account.meterId, 30),
        fetchMonthlyUsage(account.meterId, 6),
      ]);
      setStatus(nextStatus);
      setDaily(nextDaily);
      setMonthly(nextMonthly);
      setTodayBaseline(todayBaselineOf(account.meterId, Number(nextStatus.leiji)));
      const savedAt = Date.now();
      setUpdatedAt(new Date(savedAt));
      writeCache({
        meterId: account.meterId,
        status: nextStatus,
        daily: nextDaily,
        monthly: nextMonthly,
        savedAt,
      });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取失败');
      return false;
    } finally {
      setLoading(false);
    }
  }, [account]);

  // 换账号时先用该电表的缓存顶上，避免白屏
  useEffect(() => {
    if (!account) {
      setStatus(null);
      setDaily([]);
      setMonthly([]);
      setTodayBaseline(null);
      return;
    }
    const cached = readCache(account.meterId);
    if (cached) {
      setStatus(cached.status);
      setDaily(cached.daily);
      setMonthly(Array.isArray(cached.monthly) ? cached.monthly : []);
      setUpdatedAt(new Date(cached.savedAt));
      // 只有今天抓到的缓存才能当作今天的累计基线，避免把旧读数算进今日
      const savedToday = toDateString(new Date(cached.savedAt)) === toDateString(new Date());
      setTodayBaseline(savedToday ? todayBaselineOf(account.meterId, Number(cached.status.leiji)) : null);
    }
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <MeterContext.Provider value={{ status, daily, monthly, todayBaseline, loading, error, updatedAt, reload }}>
      {children}
    </MeterContext.Provider>
  );
}

export function useMeter(): MeterContextValue {
  const context = useContext(MeterContext);
  if (!context) throw new Error('MeterProvider 尚未挂载');
  return context;
}
