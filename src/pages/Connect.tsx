import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectAccount } from '../api/electricity';
import { buildAccount, type LinkedAccount } from '../store/account';
import { useAccount } from '../store/AccountContext';
import { describeRoom } from '../lib/room';

export function Connect() {
  const { setAccount } = useAccount();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 一个微信号绑定多个户号时，先停在这一步让用户挑一间
  const [linked, setLinked] = useState<LinkedAccount | null>(null);

  const submit = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await connectAccount(input);
      if (result.meters.length > 1) {
        setLinked(result);
        return;
      }
      setAccount(buildAccount(result));
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '连接失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const chooseMeter = (meterId: string) => {
    if (!linked) return;
    setAccount(buildAccount(linked, meterId));
    navigate('/', { replace: true });
  };

  if (linked) {
    return (
      <div className="page connect">
        <div className="connect-mark">
          <span className="connect-dot" />
          <span className="connect-word">宿舍电量</span>
        </div>

        <h1 className="connect-title">选择宿舍</h1>
        <p className="connect-sub">
          这个微信号绑定了 {linked.meters.length} 个户号，先选一间查看。之后可以在「我的」里随时切换。
        </p>

        <div className="meter-picker">
          {linked.meters.map((meter) => {
            const room = describeRoom(meter.userCode);
            return (
              <button
                key={meter.meterId}
                type="button"
                className="meter-option"
                onClick={() => chooseMeter(meter.meterId)}
              >
                <span className="meter-option-main">
                  <b>{room ? room.text : meter.address || '宿舍'}</b>
                  <span>
                    户号 {meter.userCode}
                    {meter.meterNo ? ` · 表号 ${meter.meterNo}` : ''}
                  </span>
                </span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M8 4l7 8-7 8" />
                </svg>
              </button>
            );
          })}
        </div>

        <button type="button" className="ghost-btn ghost-btn-wide" onClick={() => setLinked(null)}>
          返回重新粘贴链接
        </button>
      </div>
    );
  }

  return (
    <div className="page connect">
      <div className="connect-mark">
        <span className="connect-dot" />
        <span className="connect-word">宿舍电量</span>
      </div>

      <h1 className="connect-title">
        先连上你的电表
      </h1>
      <p className="connect-sub">
        每个微信号的电表不同。按下面的步骤从公众号复制链接，粘贴进来就能读到真实余额。
      </p>

      <ol className="steps">
        <li>
          <span>1</span>
          微信关注公众号「西南林业大学后勤服务在线」
        </li>
        <li>
          <span>2</span>
          点底部菜单「费用办理」→「电费充值」，进入水电一体系统
        </li>
        <li>
          <span>3</span>
          点「绑定用户」，输入 8 位用户编号完成宿舍绑定
        </li>
        <li>
          <span>4</span>
          回到系统首页，点右上角「…」，选择「复制链接」
        </li>
        <li>
          <span>5</span>
          把复制的链接粘贴到下方，点「连接电表」
        </li>
      </ol>

      <p className="connect-note">
        用户编号共 8 位：片区 1 位、楼栋 2 位、单元 1 位、楼层 2 位、房间 2 位，没有单元时第 4 位填 0。例如 60101117 是秋海苑 1 栋 1 单元 1 楼 17 号。
      </p>

      <label className="field">
        <span>公众号链接或 openId</span>
        <textarea
          rows={4}
          value={input}
          placeholder="粘贴形如 http://sdcz.swfu.edu.cn/refund/index.html#/?openId=… 的链接"
          onChange={(event) => setInput(event.target.value)}
        />
      </label>

      {error ? <p className="field-error">{error}</p> : null}

      <button className="primary-btn" disabled={loading || !input.trim()} onClick={() => void submit()}>
        {loading ? '正在连接…' : '连 接 电 表'}
      </button>

      <p className="fineprint">
        链接里只包含你自己的 openId，用来向学校服务器读取电表；本应用不会保存任何支付信息。
      </p>
    </div>
  );
}
