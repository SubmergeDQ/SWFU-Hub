import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { fetchDailyUsage, fetchMeterStatus, fetchMonthlyUsage } from '../api/electricity';
import type { DailyUsage, MeterStatus, MonthUsage } from '../api/types';
import { useAccount } from './AccountContext';

const CACHE_KEY = 'swfu.electricity.meter.v1';

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
      return;
    }
    const cached = readCache(account.meterId);
    if (cached) {
      setStatus(cached.status);
      setDaily(cached.daily);
      setMonthly(Array.isArray(cached.monthly) ? cached.monthly : []);
      setUpdatedAt(new Date(cached.savedAt));
    }
  }, [account]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <MeterContext.Provider value={{ status, daily, monthly, loading, error, updatedAt, reload }}>
      {children}
    </MeterContext.Provider>
  );
}

export function useMeter(): MeterContextValue {
  const context = useContext(MeterContext);
  if (!context) throw new Error('MeterProvider 尚未挂载');
  return context;
}
