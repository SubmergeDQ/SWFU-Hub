import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'swfu.electricity.settings.v1';
const DEFAULT_WINDOW = 7;

export type ThemeMode = 'system' | 'light' | 'dark';

interface AppSettings {
  /** 用最近几天的日均来推算可用天数 */
  averageWindow: number;
  /** 外观模式，默认跟随系统 */
  theme: ThemeMode;
}

interface SettingsContextValue extends AppSettings {
  setAverageWindow: (days: number) => void;
  setTheme: (theme: ThemeMode) => void;
  /** 实际生效的明暗主题 */
  resolvedTheme: 'light' | 'dark';
}

function clampWindow(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WINDOW;
  return Math.min(Math.max(Math.round(value), 1), 30);
}

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function loadSettings(): AppSettings {
  const fallback: AppSettings = { averageWindow: DEFAULT_WINDOW, theme: 'system' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      averageWindow: clampWindow(Number(parsed.averageWindow)),
      theme: normalizeTheme(parsed.theme),
    };
  } catch {
    return fallback;
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

  // 跟随系统时监听手机外观变化
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;

  // 同步到根节点和浏览器主题色，保证页面、表单控件与系统 UI 一致
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', resolvedTheme === 'dark' ? '#0f1512' : '#f3f4f1');
  }, [resolvedTheme]);

  const update = (patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const setAverageWindow = (days: number) => update({ averageWindow: clampWindow(days) });
  const setTheme = (theme: ThemeMode) => update({ theme });

  return (
    <SettingsContext.Provider
      value={{
        ...settings,
        setAverageWindow,
        setTheme,
        resolvedTheme,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('SettingsProvider 尚未挂载');
  return context;
}
