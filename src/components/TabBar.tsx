import { NavLink } from 'react-router-dom';

const TABS = [
  {
    to: '/',
    label: '电量',
    icon: (
      <path d="M3 15c3-1 4-8 7-8s4 7 7 7 4-5 7-6" />
    ),
  },
  {
    to: '/usage',
    label: '明细',
    icon: (
      <>
        <path d="M4 19V13M10 19V7M16 19V11M21 19V5" />
      </>
    ),
  },
  {
    to: '/recharge',
    label: '充值',
    icon: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
      </>
    ),
  },
  {
    to: '/settings',
    label: '我的',
    icon: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20c.7-3.6 3.3-5.4 6.5-5.4s5.8 1.8 6.5 5.4" />
      </>
    ),
  },
];

export function TabBar() {
  return (
    <nav className="tabbar">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => `tabbar-item ${isActive ? 'is-active' : ''}`}
        >
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            {tab.icon}
          </svg>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
