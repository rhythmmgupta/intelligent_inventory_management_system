import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('manager@freshguard.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Activity size={28} color="#0f766e" />
          <div>
            <h1 style={{ margin: 0, fontSize: '1.35rem' }}>FreshGuard Inventory</h1>
            <p style={{ margin: 0, color: '#64748b', fontSize: '0.84rem' }}>
              Expiry-Aware Stock Control & Demand Intelligence
            </p>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-field" style={{ marginBottom: 12 }}>
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-field" style={{ marginBottom: 16 }}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              placeholder="Enter store account password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={submitting}
          >
            <Lock size={15} /> {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid #e2e8f0',
            fontSize: '0.78rem',
            color: '#475569',
          }}
        >
          <strong>Seeded Role Accounts:</strong>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {['admin@freshguard.local', 'manager@freshguard.local', 'staff@freshguard.local'].map(
              (acct) => (
                <button
                  key={acct}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setEmail(acct)}
                >
                  {acct.split('@')[0]}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
