import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Button, Icon, Text } from '@gravity-ui/uikit';
import {
  Plus,
  ClockArrowRotateLeft,
  Gear,
  Bars,
  ArrowRightFromSquare,
} from '@gravity-ui/icons';
import { useAuthStore } from '../stores/authStore';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const clearToken = useAuthStore((s) => s.clearToken);

  const navItems = [
    { to: '/', label: 'Новый чат', icon: <Plus />, end: true },
    { to: '/history', label: 'История', icon: <ClockArrowRotateLeft /> },
    { to: '/settings', label: 'Настройки', icon: <Gear /> },
  ];

  const handleLogout = () => {
    setMobileOpen(false);
    clearToken();
  };

  const nav = (
    <nav className="app-nav">
      <Text className="app-nav-title" variant="subheader-2">
        Dexity
      </Text>
      <ul className="app-nav-list">
        {navItems.map(({ to, label, icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) => `app-nav-item${isActive ? ' app-nav-item--active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              {icon}
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="app-nav-footer">
        <div className="app-nav-user">
          <div className="app-nav-avatar">В</div>
          <span>Влад</span>
        </div>
        <Button view="flat" size="m" title="Выйти" onClick={handleLogout}>
          <Icon data={ArrowRightFromSquare} />
        </Button>
      </div>
    </nav>
  );

  return (
    <div className="app-layout">
      {/* Desktop nav */}
      <div className="app-nav-desktop">{nav}</div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="app-nav-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div className={`app-nav-mobile${mobileOpen ? ' app-nav-mobile--open' : ''}`}>{nav}</div>

      <div className="app-main">
        {/* Mobile header */}
        <div className="app-mobile-header">
          <Button view="flat" size="s" onClick={() => setMobileOpen(true)}>
            <Bars />
          </Button>
          <Text variant="subheader-2">Dexity</Text>
        </div>

        <Outlet />
      </div>
    </div>
  );
}
