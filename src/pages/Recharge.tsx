import { useMemo, useState } from 'react';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { buildRechargeUrl } from '../api/electricity';
import { useMeter } from '../store/MeterContext';
import { useSettings } from '../store/SettingsContext';
import { estimateUsage } from '../lib/estimate';
import { useAccount } from '../store/AccountContext';

const PRESETS = [20, 50, 100, 200];

export function Recharge() {
  const { account } = useAccount();
  const { averageWindow } = useSettings();
  const { status, daily } = useMeter();
  const [amount, setAmount] = useState(50);
  const [custom, setCustom] = useState('');
  const [copied, setCopied] = useState(false);

  const estimate = useMemo(
    () => (status ? estimateUsage(status, daily, averageWindow) : null),
    [status, daily, averageWindow],
  );

  const value = custom ? Number(custom) : amount;
  const valid = Number.isFinite(value) && value > 0 && value <= 500;
  const price = estimate?.price || 0.5;
  const dailyAverage = estimate?.dailyRecent || 0;

  const addedKwh = valid ? value / price : 0;
  const addedDays = dailyAverage > 0 ? addedKwh / dailyAverage : 0;

  if (!account) return null;

  const openPayPage = async () => {
    const url = buildRechargeUrl(account);
    if (Capacitor.isNativePlatform()) {
      // 微信支付只能在微信内拉起，原生端先把链接分享出去，由微信打开
      try {
        await Share.share({
          title: '宿舍电费缴费',
          text: url,
          dialogTitle: '发送到微信打开',
        });
        return;
      } catch {
        // 取消分享时退回到浏览器
      }
      await Browser.open({ url });
      return;
    }
    window.location.href = url;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(buildRechargeUrl(account));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="page page-recharge">
      <header className="topbar">
        <div>
          <div className="page-title">充值</div>
          <div className="topbar-sub">
            {estimate
              ? `现在剩 ${estimate.balance.toFixed(2)} 度，约 ¥${estimate.balanceValue.toFixed(2)}`
              : '正在读取电表'}
          </div>
        </div>
      </header>

      <div className="recharge-head">
        <span>选择金额</span>
        <span className="recharge-hint">最高 500 元</span>
      </div>
      <div className="amount-row">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            className={`amount-cell ${!custom && amount === preset ? 'is-on' : ''}`}
            onClick={() => {
              setAmount(preset);
              setCustom('');
            }}
          >
            <span className="amount-number">{preset}</span>
            <span className="amount-unit">元</span>
          </button>
        ))}
      </div>

      <label className="custom-field">
        <span>其他金额</span>
        <input
          inputMode="decimal"
          placeholder="最高 500"
          value={custom}
          onChange={(event) => setCustom(event.target.value.replace(/[^\d.]/g, ''))}
        />
        <span className="custom-unit">元</span>
      </label>

      <section className="conversion">
        <div>
          <b>{addedKwh ? addedKwh.toFixed(1) : '—'}</b>
          <span>度电</span>
        </div>
        <div>
          <b>{addedDays ? Math.round(addedDays) : '—'}</b>
          <span>天可用</span>
        </div>
        <div>
          <b>{price.toFixed(2)}</b>
          <span>元/度</span>
        </div>
      </section>

      <button className="primary-btn" disabled={!valid} onClick={() => void openPayPage()}>
        发 到 微 信 缴 费
      </button>

      <button className="ghost-btn ghost-btn-wide" onClick={() => void copyLink()}>
        {copied ? '链接已复制' : '复制缴费链接'}
      </button>

      <p className="fineprint">
        微信支付只能在微信里拉起，所以这个按钮会把缴费链接发送到微信；在微信里点开链接即可付款。余额仍以学校页面为准。
      </p>
    </div>
  );
}
