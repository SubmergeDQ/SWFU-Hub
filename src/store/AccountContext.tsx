import { createContext, useContext, useState, type ReactNode } from 'react';
import { clearAccount, loadAccount, saveAccount, type Account } from './account';

interface AccountContextValue {
  account: Account | null;
  setAccount: (account: Account) => void;
  /** 在已绑定的多个户号之间切换 */
  switchMeter: (meterId: string) => void;
  signOut: () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccountState] = useState<Account | null>(() => loadAccount());

  const setAccount = (next: Account) => {
    saveAccount(next);
    setAccountState(next);
  };

  // 扁平字段与 meters 里的当前项保持一致，其余页面无需感知多户号结构
  const switchMeter = (meterId: string) => {
    if (!account || account.meterId === meterId) return;
    const target = account.meters.find((meter) => meter.meterId === meterId);
    if (!target) return;
    setAccount({ ...account, ...target });
  };

  const signOut = () => {
    clearAccount();
    setAccountState(null);
  };

  return (
    <AccountContext.Provider value={{ account, setAccount, switchMeter, signOut }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error('AccountProvider 尚未挂载');
  return context;
}
