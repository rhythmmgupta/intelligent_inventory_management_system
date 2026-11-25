import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import SalesPage from './pages/SalesPage';
import WastePage from './pages/WastePage';
import ForecastsPage from './pages/ForecastsPage';
import AdminPage from './pages/AdminPage';

function ProtectedRoute({ children, managerOnly = false }) {
  const { user, loading, isManagerOrAdmin } = useAuth();
  if (loading) return <div style={{ padding: 32 }}>Loading session...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (managerOnly && !isManagerOrAdmin) return <Navigate to="/" replace />;
  return children;
}

export function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="sales" element={<SalesPage />} />
        <Route path="waste" element={<WastePage />} />
        <Route path="forecasts" element={<ForecastsPage />} />
        <Route
          path="admin"
          element={
            <ProtectedRoute managerOnly>
              <AdminPage />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
