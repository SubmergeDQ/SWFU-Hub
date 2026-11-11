import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchDailyUsage, fetchMeterStatus, fetchMonthlyUsage } from '../api/electricity';
import type { DailyUsage, MeterStatus, MonthUsage } from '../api/types';
import { toDateString } from '../lib/date';
import { findTodayTotal } from '../lib/estimate';
import { useAccount } from './AccountContext';

const CACHE_KEY = 'swfu.electricity.meter.v1';
// v2：基线从“当天首次读数”改为“今天零点的累计读数”，旧键不再读取
const BASELINE_KEY = 'swfu.electricity.today-zero.v2';

/** 今天零点时的累计读数（度） */
interface TodayZeroBaseline {
  meterId: string;
  date: string;
  zeroLeiji: number;
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

function readBaseline(meterId: string): TodayZeroBaseline | null {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TodayZeroBaseline>;
    if (parsed.meterId !== meterId || !parsed.date || !Number.isFinite(parsed.zeroLeiji)) {
      return null;
    }
    return parsed as TodayZeroBaseline;
  } catch {
    return null;
  }
}

function writeBaseline(entry: TodayZeroBaseline): void {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(entry));
  } catch {
    // 本地空间不足时静默跳过，下次刷新会重新建立基线
  }
}

/**
 * 取今天零点的累计读数。
 * 接口的今日日用量只更新到上一次结算时刻，用「当前累计 − 今日日用量」反推零点读数；
 * 当天已经存过基线就直接沿用，避免接口滞后把基线越算越大。
 */
function todayZeroLeijiOf(
  meterId: string,
  leiji: number,
  todayTotal: number | null,
): number | null {
  const todayKey = toDateString(new Date());
  const stored = readBaseline(meterId);
  if (stored && stored.date === todayKey) return stored.zeroLeiji;
  if (!Number.isFinite(leiji) || leiji <= 0) return null;

  const zeroLeiji = todayTotal != null && leiji > todayTotal ? leiji - todayTotal : leiji;
  writeBaseline({ meterId, date: todayKey, zeroLeiji });
  return zeroLeiji;
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
  const [todayZeroLeiji, setTodayZeroLeiji] = useState<number | null>(null);
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
      setTodayZeroLeiji(
        todayZeroLeijiOf(
          account.meterId,
          Number(nextStatus.leiji),
          findTodayTotal(nextDaily),
        ),
      );
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
      setTodayZeroLeiji(null);
      return;
    }
    const cached = readCache(account.meterId);
    // 切换户号时缓存可能不匹配，先清空，避免短暂显示上一间宿舍的数据
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
            account.meterId,
            Number(cached.status.leiji),
            findTodayTotal(cached.daily),
          )
        : null,
    );
  }, [account]);

  useEffect(() => {
    void reload();
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
