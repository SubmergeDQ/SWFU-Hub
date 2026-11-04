import { useEffect } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { Connect } from './pages/Connect';
import { Home } from './pages/Home';
import { Recharge } from './pages/Recharge';
import { Settings } from './pages/Settings';
import { Usage } from './pages/Usage';
import { AccountProvider, useAccount } from './store/AccountContext';
import { MeterProvider } from './store/MeterContext';
import { SettingsProvider } from './store/SettingsContext';

function Shell() {
  const location = useLocation();

  // 键盘弹出再收起会留下滚动偏移；电量/充值/我的固定一屏，禁止页面滚动
  useEffect(() => {
    const locked = ['/', '/recharge', '/settings'].includes(location.pathname);
    document.body.style.overflow = locked ? 'hidden' : '';
    window.scrollTo(0, 0);
    return () => {
      document.body.style.overflow = '';
    };
  }, [location.pathname]);

  return (
    <MeterProvider>
      <main className="shell">
        <Outlet />
      </main>
      <TabBar />
    </MeterProvider>
  );
}

function Guard() {
  const { account } = useAccount();
  if (!account) return <Navigate to="/connect" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <HashRouter>
      <AccountProvider>
        <SettingsProvider>
          <Routes>
            <Route path="/connect" element={<Connect />} />
            <Route element={<Guard />}>
              <Route element={<Shell />}>
                <Route path="/" element={<Home />} />
                <Route path="/usage" element={<Usage />} />
                <Route path="/recharge" element={<Recharge />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SettingsProvider>
      </AccountProvider>
    </HashRouter>
  );
}
