import type { DailyUsage } from '../api/types';
import { parseDayString, shiftDays, toDateString } from './date';

export interface CurvePoint {
  date: Date;
  value: number;
  usage?: number;
  kind: 'history' | 'forecast';
}

export interface Estimate {
  balance: number;
  price: number;
  balanceValue: number;
  usedTotal: number;
  /** 选定的推算天数 */
  averageWindow: number;
  /** 窗口内日均，用来推算还能用几天 */
  dailyRecent: number;
  /** 近 30 天日均，用来做长期对照 */
  daily30: number;
  daysLeft: number;
  endDate: Date;
  history: CurvePoint[];
  forecast: CurvePoint[];
  hasEnoughHistory: boolean;
}

interface CompleteDay {
  startDate: Date;
  endDate: Date;
  total: number;
}

/**
 * 把电表读数和每日用电量折成一条余额曲线：
 * 历史段用真实消耗向前反推，预测段按选定窗口的日均线性下降。
 */
export function estimateUsage(
  status: { shengyu: string; leiji: string; price: string },
  rawDaily: DailyUsage[],
  averageWindow = 7,
  now = new Date(),
): Estimate {
  const balance = Number(status.shengyu) || 0;
  const price = Number(status.price) || 0;
  const usedTotal = Number(status.leiji) || 0;
  const todayKey = toDateString(now);
  const windowDays = Math.min(Math.max(Math.round(averageWindow) || 7, 1), 30);

  // 今天的数据未走完，会把均值拉低，因此只取今天之前的完整日
  const complete: CompleteDay[] = rawDaily
    .filter((item) => item.endtime && item.endtime < todayKey)
    .map((item) => ({
      startDate: parseDayString(item.starttime || item.endtime),
      endDate: parseDayString(item.endtime),
      total: Number(item.total) || 0,
    }))
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime());

  const average = (list: CompleteDay[]): number => {
    if (!list.length) return 0;
    return list.reduce((sum, item) => sum + item.total, 0) / list.length;
  };

  const dailyRecent = average(complete.slice(-windowDays));
  const daily30 = average(complete);
  const daily = dailyRecent > 0 ? dailyRecent : daily30;
  const daysLeft = daily > 0 ? balance / daily : Number.POSITIVE_INFINITY;
  const endDate = shiftDays(now, Math.round(daysLeft));

  // 从今天的余额出发，往前逐日加回消耗，得到历史余额
  const history: CurvePoint[] = [{ date: now, value: balance, kind: 'history' }];
  let rolling = balance;
  for (let i = complete.length - 1; i >= 0; i--) {
    rolling += complete[i].total;
    history.unshift({
      date: complete[i].startDate,
      value: rolling,
      usage: complete[i].total,
      kind: 'history',
    });
  }

  // 预测段：按选定窗口的日均线性递减到 0
  const forecast: CurvePoint[] = [{ date: now, value: balance, kind: 'forecast' }];
  if (daily > 0) {
    const steps = Math.min(Math.ceil(daysLeft), 120);
    for (let i = 1; i <= steps; i++) {
      forecast.push({
        date: shiftDays(now, i),
        value: Math.max(balance - daily * i, 0),
        kind: 'forecast',
      });
    }
  }

  return {
    balance,
    price,
    balanceValue: balance * price,
    usedTotal,
    averageWindow: windowDays,
    dailyRecent,
    daily30,
    daysLeft,
    endDate,
    history,
    forecast,
    hasEnoughHistory: complete.length >= 3,
  };
}
