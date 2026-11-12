import { useMemo, useState } from 'react';
import { useMeter } from '../store/MeterContext';
import { shortDate, toDateString, usageDayOf, weekdayLabel } from '../lib/date';
import { useAccount } from '../store/AccountContext';

type Period = 7 | 30;

/** 按当日用量占峰值的比例取色，用量越大越深，避免深浅看起来随机 */
function barTone(ratio: number): string {
  const t = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  // 用主题变量混合，深浅色模式下都能保持正确的明暗层次
  return `color-mix(in srgb, var(--green) ${t}%, var(--bar-idle))`;
}

export function Usage() {
  const { account } = useAccount();
  const { daily, monthly, loading, error, reload } = useMeter();
  const [period, setPeriod] = useState<Period>(30);

  // 今天的数据还没走完，各类统计都排除掉
  const complete = useMemo(() => {
    const today = toDateString(new Date());
    const items: { date: Date; total: number }[] = [];
    for (const item of daily) {
      const day = item.endtime ? usageDayOf(item.starttime, item.endtime) : null;
      if (!day || toDateString(day) >= today) continue;
      items.push({ date: day, total: Number(item.total) || 0 });
    }
    return items;
  }, [daily]);

  const visible = useMemo(
    () => (period === 7 ? complete.slice(-7) : complete),
    [complete, period],
  );

  const summary = useMemo(() => {
    if (!visible.length) return { total: 0, average: 0, peak: 0 };
    const total = visible.reduce((sum, item) => sum + item.total, 0);
    const peak = Math.max(...visible.map((item) => item.total));
    return { total, average: total / visible.length, peak };
  }, [visible]);

  const maxMonthly = useMemo(
    () => Math.max(...monthly.map((item) => Number(item.total) || 0), 1),
    [monthly],
  );

  if (!account) return null;

  if (loading && !complete.length) {
    return (
      <div className="page">
        <div className="skeleton skeleton-head" />
        <div className="skeleton skeleton-chart" />
        <div className="skeleton skeleton-stats" />
      </div>
    );
  }

  if (error && !complete.length) {
    return (
      <div className="page page-centered">
        <p className="error-title">没能读到用电记录</p>
        <p className="error-message">{error}</p>
        <button className="ghost-btn" onClick={() => void reload()}>重试</button>
      </div>
    );
  }

  const peakValue = Math.max(summary.peak, 1);

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="page-title">用电明细</div>
          <div className="topbar-sub">
            共 {summary.total.toFixed(1)} 度 · 日均 {summary.average.toFixed(2)} 度
          </div>
        </div>
        <div className="segment">
          <button
            className={period === 7 ? 'is-on' : ''}
            onClick={() => setPeriod(7)}
          >
            7 天
          </button>
          <button
            className={period === 30 ? 'is-on' : ''}
            onClick={() => setPeriod(30)}
          >
            30 天
          </button>
        </div>
      </header>

      <section className="bars">
        {visible.map((item) => {
          const ratio = item.total / peakValue;
          return (
            <div className="bar-slot" key={item.date.toISOString()}>
              <div
                className="bar"
                style={{ height: `${Math.max(ratio * 100, 2)}%`, background: barTone(ratio) }}
                title={`${shortDate(item.date)} · ${item.total.toFixed(2)} 度`}
              />
            </div>
          );
        })}
      </section>
      <div className="bars-axis">
        <span>{visible.length ? shortDate(visible[0].date) : ''}</span>
        <span>{visible.length ? shortDate(visible[visible.length - 1].date) : ''}</span>
      </div>

      <section className="panel">
        <div className="panel-title">月度账单</div>
        {monthly.length === 0 ? (
          <div className="month-placeholder">
            {[0, 1, 2, 3].map((key) => (
              <span key={key} />
            ))}
          </div>
        ) : (
          monthly
            .slice()
            .reverse()
            .map((item) => {
              const total = Number(item.total) || 0;
              return (
                <div className="month-row" key={item.month}>
                  <span className="month-name">{item.month.slice(5)} 月</span>
                  <div className="month-bar">
                    <div
                      className="month-bar-fill"
                      style={{ width: `${(total / maxMonthly) * 100}%` }}
                    />
                  </div>
                  <span className="month-value">{total.toFixed(1)} 度</span>
                  <span className="month-money">¥{Number(item.money || 0).toFixed(2)}</span>
                </div>
              );
            })
        )}
      </section>

      <section className="panel">
        <div className="panel-title">每日记录</div>
        {visible
          .slice()
          .reverse()
          .map((item) => (
            <div className="day-row" key={item.date.toISOString()}>
              <span className="day-date">{shortDate(item.date)}</span>
              <span className="day-week">{weekdayLabel(item.date)}</span>
              <div className="day-bar">
                <div
                  className="day-bar-fill"
                  style={{
                    width: `${(item.total / peakValue) * 100}%`,
                    background: barTone(item.total / peakValue),
                  }}
                />
              </div>
              <span className="day-value">{item.total.toFixed(2)}</span>
            </div>
          ))}
      </section>
    </div>
  );
}
