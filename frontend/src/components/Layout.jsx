import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Boxes,
  LogOut,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout, isManagerOrAdmin } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Activity size={24} color="#2dd4bf" />
          <div>
            <div className="brand-title">FreshGuard</div>
            <div className="brand-sub">Smart Retail Inventory</div>
          </div>
        </div>

        <nav className="nav-links">
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <BarChart3 size={17} /> Dashboard
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Boxes size={17} /> Inventory & FEFO
          </NavLink>
          <NavLink to="/sales" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <ShoppingCart size={17} /> Sales & POS
          </NavLink>
          <NavLink to="/waste" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Trash2 size={17} /> Waste & Reduction
          </NavLink>
          <NavLink to="/forecasts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <TrendingUp size={17} /> ML Forecasts & Reorders
          </NavLink>
          {isManagerOrAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <ShieldCheck size={17} /> Audit & Settings
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div style={{ fontWeight: 600 }}>{user?.name}</div>
          <div style={{ color: '#94a3b8', marginBottom: 10 }}>
            {user?.email} ({user?.role})
          </div>
          <button type="button" className="btn btn-sm" style={{ width: '100%' }} onClick={logout}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      <main className="main-area">
        <Outlet />
      </main>
    </div>
  );
}
