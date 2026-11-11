import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMeter } from '../store/MeterContext';
import { useSettings } from '../store/SettingsContext';
import { useAccount } from '../store/AccountContext';
import { describeRoom } from '../lib/room';

const WINDOW_PRESETS = [1, 3, 5, 7, 15];

export function Settings() {
  const { account, signOut, switchMeter } = useAccount();
  const navigate = useNavigate();
  const { status } = useMeter();
  const { averageWindow, setAverageWindow } = useSettings();
  const [draft, setDraft] = useState('');
  const [meterMenuOpen, setMeterMenuOpen] = useState(false);

  if (!account) return null;

  const room = describeRoom(account.userCode);
  const multipleMeters = account.meters.length > 1;

  const handleSignOut = () => {
    signOut();
    navigate('/connect', { replace: true });
  };

  // 输入合法天数后立即生效，不需要额外的确认按钮
  const handleCustom = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    setDraft(digits);
    const value = Number(digits);
    if (digits && value >= 1 && value <= 30) {
      setAverageWindow(value);
    }
  };

  return (
    <div className="page page-settings">
      <header className="topbar">
        <div>
          <div className="page-title">我的</div>
          <div className="topbar-sub">账号与电表</div>
        </div>
      </header>

      <section className="profile">
        {account.avatar ? (
          <img className="profile-avatar" src={account.avatar} alt="" referrerPolicy="no-referrer" />
        ) : (
          <div className="profile-avatar profile-avatar-empty" />
        )}
        <div>
          <div className="profile-name">{account.nickname || '微信用户'}</div>
          <div className="profile-meta">{room ? room.text : `户号 ${account.userCode}`}</div>
        </div>
      </section>

      <section className="panel">
        <button
          type="button"
          className={`kv kv-select ${meterMenuOpen ? 'is-open' : ''}`}
          onClick={multipleMeters ? () => setMeterMenuOpen((open) => !open) : undefined}
          disabled={!multipleMeters}
        >
          <span>户号</span>
          <b>
            {account.userCode}
            {multipleMeters ? (
              <svg className="kv-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            ) : null}
          </b>
        </button>

        {multipleMeters && meterMenuOpen ? (
          <div className="meter-menu">
            {account.meters.map((meter) => {
              const meterRoom = describeRoom(meter.userCode);
              const active = meter.meterId === account.meterId;
              return (
                <button
                  key={meter.meterId}
                  type="button"
                  className={`meter-menu-item ${active ? 'is-on' : ''}`}
                  onClick={() => {
                    switchMeter(meter.meterId);
                    setMeterMenuOpen(false);
                  }}
                >
                  <span className="meter-menu-main">
                    <b>{meterRoom ? meterRoom.text : meter.address || '宿舍'}</b>
                    <span>{meter.userCode}</span>
                  </span>
                  {active ? (
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="kv">
          <span>宿舍</span>
          <b>{room ? room.text : '—'}</b>
        </div>
        <div className="kv">
          <span>表号</span>
          <b>{account.meterNo || '—'}</b>
        </div>
        <div className="kv">
          <span>表类型</span>
          <b>{account.typeRemark || '—'}</b>
        </div>
        <div className="kv">
          <span>当前状态</span>
          <b>{status?.zhuangtai || '读取中'}</b>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">日均推算</div>
        <div className="window-chips">
          {WINDOW_PRESETS.map((days) => (
            <button
              key={days}
              className={`window-chip ${averageWindow === days ? 'is-on' : ''}`}
              onClick={() => {
                setAverageWindow(days);
                setDraft('');
              }}
            >
              {days} 天
            </button>
          ))}
        </div>

        <div className="window-custom">
          <span className="window-custom-label">自定义</span>
          <input
            inputMode="numeric"
            placeholder="1 - 30"
            value={draft}
            onChange={(event) => handleCustom(event.target.value)}
          />
          <span>天</span>
        </div>

        <p className="panel-hint">
          用最近几天的日均来推算还能用几天。天数越短，越跟得上最近的用电变化；天数越长，越平稳。
        </p>
      </section>

      <button className="ghost-btn ghost-btn-wide ghost-btn-danger" onClick={handleSignOut}>
        更换账号
      </button>

      <p className="fineprint">
        本应用直接读取西南林业大学水电一体系统的数据，不做任何缓存改写。电表读数与学校系统保持一致，余额以学校页面为准。
      </p>
    </div>
  );
}
