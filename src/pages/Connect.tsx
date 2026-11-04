import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectAccount } from '../api/electricity';
import { useAccount } from '../store/AccountContext';

export function Connect() {
  const { setAccount } = useAccount();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const account = await connectAccount(input);
      setAccount(account);
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '连接失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

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
        每个微信号的电表不同。把学校缴费页的链接粘贴进来，就能读到真实余额。
      </p>

      <ol className="steps">
        <li>
          <span>1</span>
          在微信里打开学校的「水电一体」缴费页
        </li>
        <li>
          <span>2</span>
          复制地址栏里整段链接
        </li>
        <li>
          <span>3</span>
          粘贴到下面，点连接
        </li>
      </ol>

      <label className="field">
        <span>缴费页链接或 openId</span>
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
