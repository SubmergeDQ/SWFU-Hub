import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BalanceChart } from '../components/BalanceChart';
import { useMeter } from '../store/MeterContext';
import { useSettings } from '../store/SettingsContext';
import { chineseDate } from '../lib/date';
import { estimateUsage } from '../lib/estimate';
import { describeRoom } from '../lib/room';
import { useAccount } from '../store/AccountContext';

export function Home() {
  const { account } = useAccount();
  const navigate = useNavigate();
  const { averageWindow } = useSettings();
  const { status, daily, loading, error, updatedAt, reload } = useMeter();
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);

  const estimate = useMemo(
    () => (status ? estimateUsage(status, daily, averageWindow) : null),
    [status, daily, averageWindow],
  );

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  };

  const handleRefresh = async () => {
    const ok = await reload();
    showToast(ok ? '电量已刷新' : '刷新失败，请稍后重试');
  };

  if (!account) return null;

  if (loading && !status) {
    return (
      <div className="page">
        <div className="skeleton skeleton-head" />
        <div className="skeleton skeleton-number" />
        <div className="skeleton skeleton-chart" />
        <div className="skeleton skeleton-stats" />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="page page-centered">
        <p className="error-title">没能读到电表</p>
        <p className="error-message">{error}</p>
        <button className="ghost-btn" onClick={() => void handleRefresh()}>重试</button>
      </div>
    );
  }

  if (!estimate) return null;

  const room = describeRoom(account.userCode);
  const days = Number.isFinite(estimate.daysLeft) ? Math.round(estimate.daysLeft) : null;
  const lowBalance = days != null && days <= 7;
  const closed = status?.zhuangtai === '合闸';
  const syncLabel = updatedAt
    ? `${String(updatedAt.getHours()).padStart(2, '0')}:${String(updatedAt.getMinutes()).padStart(2, '0')} 同步`
    : '同步中';

  return (
    <div className="page page-home">
      <header className="topbar">
        <div>
          <div className="topbar-code">{account.userCode}</div>
          <div className="topbar-sub">{room ? room.text : `${account.address || '宿舍'} · 宿舍电表`}</div>
        </div>
        <div className="topbar-actions">
          <div className={`status-pill ${closed ? '' : 'status-pill-warn'}`}>
            <i />
            {status?.zhuangtai || '读取中'}
          </div>
          <button
            className={`icon-btn ${loading ? 'is-spinning' : ''}`}
            aria-label="刷新电量"
            onClick={() => void handleRefresh()}
            disabled={loading}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M20 11a8 8 0 1 1-2.4-5.7" />
              <path d="M20 4.5v4h-4" />
            </svg>
          </button>
        </div>
      </header>

      <section className="balance-block">
        <span className="balance-label">剩余电量</span>
        <div className="balance-row">
          <div className="balance-number">
            {estimate.balance.toFixed(2)}
            <span>度</span>
          </div>
          <div className="balance-side">
            约 <b>¥{estimate.balanceValue.toFixed(2)}</b>
            <br />
            电价 {estimate.price.toFixed(2)} 元/度
          </div>
        </div>
      </section>

      <div className="chart-head">
        <span className="chart-head-title">余额走势</span>
        <button className="link-btn" onClick={() => navigate('/usage')}>
          查看明细
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 4l7 8-7 8" />
          </svg>
        </button>
      </div>

      <BalanceChart history={estimate.history} forecast={estimate.forecast} syncedLabel={syncLabel} />

      {lowBalance ? (
        <section className="alert">
          <span className="alert-dot" />
          电量只能再撑 {days} 天，建议现在续上
        </section>
      ) : null}

      <section className="verdict">
        {days != null ? (
          <>
            <b>{days} 天</b>
            <span>
              后电量见底，约 <em>{chineseDate(estimate.endDate)}</em>
              <br />
              按{estimate.averageWindow === 1 ? '昨日' : `近 ${estimate.averageWindow} 天日均 ${estimate.dailyRecent.toFixed(2)} 度`}推算
            </span>
          </>
        ) : (
          <>
            <b>暂无估算</b>
            <span>历史用电记录还不够，明后天再来看会更准。</span>
          </>
        )}
      </section>

      <section className="stats">
        <div className="stat">
          <b>{estimate.todayUsage != null ? estimate.todayUsage.toFixed(2) : '—'}</b>
          <span>当日用量 · 度</span>
        </div>
        <div className="stat">
          <b>{estimate.daily30.toFixed(2)}</b>
          <span>近 30 日均 · 度</span>
        </div>
        <div className="stat">
          <b>{estimate.usedTotal.toFixed(2)}</b>
          <span>本期累计 · 度</span>
        </div>
      </section>

      <button className="primary-btn" onClick={() => navigate('/recharge')}>
        续 上 电 量
      </button>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
