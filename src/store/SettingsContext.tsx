import { createContext, useContext, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'swfu.electricity.settings.v1';
const DEFAULT_WINDOW = 7;

interface AppSettings {
  /** 用最近几天的日均来推算可用天数 */
  averageWindow: number;
}

interface SettingsContextValue extends AppSettings {
  setAverageWindow: (days: number) => void;
}

function clampWindow(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WINDOW;
  return Math.min(Math.max(Math.round(value), 1), 30);
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { averageWindow: DEFAULT_WINDOW };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { averageWindow: clampWindow(Number(parsed.averageWindow)) };
  } catch {
    return { averageWindow: DEFAULT_WINDOW };
  }
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [averageWindow, setWindowState] = useState(() => loadSettings().averageWindow);

  const setAverageWindow = (days: number) => {
    const next = clampWindow(days);
    setWindowState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ averageWindow: next }));
  };

  return (
    <SettingsContext.Provider value={{ averageWindow, setAverageWindow }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('SettingsProvider 尚未挂载');
  return context;
}
