import { createContext, useContext, useState, type ReactNode } from 'react';
import { clearAccount, loadAccount, saveAccount, type Account } from './account';

interface AccountContextValue {
  account: Account | null;
  setAccount: (account: Account) => void;
  signOut: () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccountState] = useState<Account | null>(() => loadAccount());

  const setAccount = (next: Account) => {
    saveAccount(next);
    setAccountState(next);
  };

  const signOut = () => {
    clearAccount();
    setAccountState(null);
  };

  return (
    <AccountContext.Provider value={{ account, setAccount, signOut }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context) throw new Error('AccountProvider 尚未挂载');
  return context;
}
