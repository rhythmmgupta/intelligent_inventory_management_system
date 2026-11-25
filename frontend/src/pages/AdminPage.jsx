import React, { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [config, setConfig] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'staff' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadAdminData = async () => {
    const reqs = [apiRequest('/config'), apiRequest('/audit-logs?limit=40')];
    if (isAdmin) reqs.push(apiRequest('/users'));
    const [cfgRes, auditRes, usersRes] = await Promise.all(reqs);
    setConfig(cfgRes.config);
    setAuditLogs(auditRes.logs || []);
    if (usersRes) setUsers(usersRes.users || []);
  };

  useEffect(() => {
    loadAdminData().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const res = await apiRequest('/config', {
        method: 'PATCH',
        body: JSON.stringify({
          storeName: config.storeName,
          defaultNearExpiryDays: Number(config.defaultNearExpiryDays),
          defaultLeadTimeDays: Number(config.defaultLeadTimeDays),
          targetCoverDays: Number(config.targetCoverDays),
          discountTriggerDays: Number(config.discountTriggerDays),
        }),
      });
      setConfig(res.config);
      setMessage('Store configuration updated.');
      loadAdminData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await apiRequest('/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      setNewUser({ name: '', email: '', password: '', role: 'staff' });
      setMessage('User account created.');
      loadAdminData();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Trail & Store Policy Settings</h1>
          <p className="page-subtitle">
            Configurable expiry windows, user RBAC administration, and security audit history
          </p>
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid-2">
        {config && (
          <div className="card">
            <h3 className="section-title">Store Inventory & Expiry Policy</h3>
            <form onSubmit={handleSaveConfig}>
              <div className="form-grid">
                <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <label>Store Name</label>
                  <input
                    className="input"
                    value={config.storeName}
                    onChange={(e) => setConfig({ ...config, storeName: e.target.value })}
                  />
                </div>
                <div className="form-field">
                  <label>Default Near-Expiry Window (Days)</label>
                  <input
                    type="number"
                    className="input"
                    value={config.defaultNearExpiryDays}
                    onChange={(e) =>
                      setConfig({ ...config, defaultNearExpiryDays: e.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label>Default Supplier Lead Time (Days)</label>
                  <input
                    type="number"
                    className="input"
                    value={config.defaultLeadTimeDays}
                    onChange={(e) =>
                      setConfig({ ...config, defaultLeadTimeDays: e.target.value })
                    }
                  />
                </div>
                <div className="form-field">
                  <label>Target Reorder Cover (Days)</label>
                  <input
                    type="number"
                    className="input"
                    value={config.targetCoverDays}
                    onChange={(e) => setConfig({ ...config, targetCoverDays: e.target.value })}
                  />
                </div>
                <div className="form-field">
                  <label>Markdown Trigger Window (Days)</label>
                  <input
                    type="number"
                    className="input"
                    value={config.discountTriggerDays}
                    onChange={(e) =>
                      setConfig({ ...config, discountTriggerDays: e.target.value })
                    }
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: 14 }}>
                Save Policy
              </button>
            </form>
          </div>
        )}

        {isAdmin && (
          <div className="card">
            <h3 className="section-title">User Access Control (Admin)</h3>
            <form onSubmit={handleCreateUser} style={{ marginBottom: 14 }}>
              <div className="form-grid">
                <div className="form-field">
                  <label>Full Name</label>
                  <input
                    className="input"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Email</label>
                  <input
                    type="email"
                    className="input"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Password (min 8 chars)</label>
                  <input
                    type="password"
                    className="input"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Role</label>
                  <select
                    className="select"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="staff">Staff</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: 10 }}>
                Create User
              </button>
            </form>

            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <span className="badge badge-blue">{u.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Immutable Audit Logs</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Role</th>
                <th>Action</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log._id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td>{log.actorEmail}</td>
                  <td>{log.actorRole}</td>
                  <td>
                    <span className="badge badge-slate">{log.action}</span>
                  </td>
                  <td>{log.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
