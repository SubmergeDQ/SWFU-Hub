function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 2026-11-04 */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 2026-11 */
export function toMonthString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

export function shiftDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function parseDayString(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** 把接口日期统一成 2026-11-04，兼容 2026/11/4 与带时间的写法 */
export function normalizeDayString(value: string): string | null {
  const matched = value.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!matched) return null;
  return `${matched[1]}-${pad2(Number(matched[2]))}-${pad2(Number(matched[3]))}`;
}

/**
 * 每日用电记录实际统计的日期。
 * 接口用 endtime 标记区间结束，若结束在零点，这条记录统计的是前一天，
 * 不能因为日期是今天就当成今天的用量。
 */
export function usageDayOf(endtime: string): Date | null {
  const day = normalizeDayString(endtime);
  if (!day) return null;
  const time = endtime.match(/(\d{1,2}):(\d{1,2})/);
  const endsAtMidnight = time ? Number(time[1]) === 0 && Number(time[2]) === 0 : false;
  return endsAtMidnight ? shiftDays(parseDayString(day), -1) : parseDayString(day);
}

/** 11/04 */
export function shortDate(date: Date): string {
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

/** 12 月 12 日 */
export function chineseDate(date: Date): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/** 星期几 */
export function weekdayLabel(date: Date): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
}

/** 把两个日期折算成相差天数 */
export function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
