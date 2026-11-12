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

const CACHE_KEY = 'swfu.electricity.meter.v1';
// v3：日记录改按 starttime 归日，基线算法升级，旧键不再读取
const BASELINE_KEY = 'swfu.electricity.today-zero.v3';
// 记录每天最后一次读到的累计值，跨天后用它当作新一天零点
const LAST_READING_KEY = 'swfu.electricity.last-reading.v1';

/** 今天零点时的累计读数（度） */
interface TodayZeroBaseline {
  meterId: string;
  date: string;
  zeroLeiji: number;
}

interface LastReading {
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

function readLastReading(meterId: string): LastReading | null {
  try {
    const raw = localStorage.getItem(LAST_READING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastReading>;
    if (parsed.meterId !== meterId || !parsed.date || !Number.isFinite(parsed.leiji)) {
      return null;
    }
    return parsed as LastReading;
  } catch {
    return null;
  }
}

function writeLastReading(entry: LastReading): void {
  try {
    localStorage.setItem(LAST_READING_KEY, JSON.stringify(entry));
  } catch {
    // 本地空间不足时静默跳过，不影响读数
  }
}

/**
 * 取今天零点的累计读数。
 * 日记录按 starttime 归日，当天的记录要到次日凌晨才结算，
 * 所以优先用「当前累计 − 今日日用量」反推；跨天时退回到昨天最后一次读数。
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

  let zeroLeiji = leiji;
  if (todayTotal != null && leiji > todayTotal) {
    zeroLeiji = leiji - todayTotal;
  } else {
    // 接口今天还没有记录，用昨天最后一次读数近似今天零点
    const yesterdayKey = toDateString(shiftDays(new Date(), -1));
    const last = readLastReading(meterId);
    if (last && last.date === yesterdayKey && last.leiji > 0 && last.leiji <= leiji) {
      zeroLeiji = last.leiji;
    } else {
      // 升级当天没有历史读数时，退回今天早些时候缓存的值，尽量少漏算
      const cached = readCache(meterId);
      const cachedLeiji = cached ? Number(cached.status.leiji) : NaN;
      if (
        cached &&
        toDateString(new Date(cached.savedAt)) === todayKey &&
        Number.isFinite(cachedLeiji) &&
        cachedLeiji > 0 &&
        cachedLeiji <= leiji
      ) {
        zeroLeiji = cachedLeiji;
      }
    }
  }

  writeBaseline({ meterId, date: todayKey, zeroLeiji });
  return zeroLeiji;
}

/**
 * 全局共享一份电表数据：
 * 先读本地缓存立刻出画面，再后台刷新；月度账单也一起取回，
 * 进入明细页时不会再因为补数据把下方内容顶动。
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
      // 先同步公众号侧的最新绑定，新增/解绑的户号和昵称头像都会一起更新
      let effective = current;
      try {
        const linked = await fetchLinkedAccount(current.openId);
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

        if (changed) {
          setAccountRef.current(next);
          effective = next;
        }
      } catch {
        // 绑定接口偶发失败时保留本地绑定，电表数据继续刷新
      }

      const [nextStatus, nextDaily, nextMonthly] = await Promise.all([
        fetchMeterStatus(effective),
        fetchDailyUsage(effective.meterId, 30),
        fetchMonthlyUsage(effective.meterId, 6),
      ]);
      setStatus(nextStatus);
      setDaily(nextDaily);
      setMonthly(nextMonthly);
      setTodayZeroLeiji(
        todayZeroLeijiOf(
          effective.meterId,
          Number(nextStatus.leiji),
          findTodayTotal(nextDaily),
        ),
      );
      // 记下当天最后一次读数，跨天后作为新一天的零点
      const leiji = Number(nextStatus.leiji);
      if (Number.isFinite(leiji) && leiji > 0) {
        writeLastReading({
          meterId: effective.meterId,
          date: toDateString(new Date()),
          leiji,
        });
      }
      const savedAt = Date.now();
      setUpdatedAt(new Date(savedAt));
      writeCache({
        meterId: effective.meterId,
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
