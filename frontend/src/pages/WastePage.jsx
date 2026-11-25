import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../api/client';

export default function WastePage() {
  const [periodDays, setPeriodDays] = useState(30);
  const [analytics, setAnalytics] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');

  const loadWaste = async (days = periodDays) => {
    setError('');
    try {
      const [repRes, recRes, logsRes] = await Promise.all([
        apiRequest(`/waste/analytics?periodDays=${days}`),
        apiRequest('/waste/recommendations'),
        apiRequest('/waste?limit=30'),
      ]);
      setAnalytics(repRes);
      setRecommendations(recRes.recommendations || []);
      setLogs(logsRes.logs || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadWaste(periodDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDays]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Food Waste Analytics & Reduction</h1>
          <p className="page-subtitle">
            Track expired/discarded items by item, category, supplier, and reason with actionable advisories
          </p>
        </div>

        <select
          className="select"
          style={{ width: 140 }}
          value={periodDays}
          onChange={(e) => setPeriodDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 Days</option>
          <option value={30}>Last 30 Days</option>
          <option value={90}>Last 90 Days</option>
          <option value={0}>All Time</option>
        </select>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {analytics && (
        <>
          <div className="kpi-grid">
            <div className="card">
              <div className="kpi-label">Total Wasted Units</div>
              <div className="kpi-value" style={{ color: '#dc2626' }}>
                {analytics.summary.totalQuantity}
              </div>
              <div className="kpi-meta">{analytics.summary.incidentCount} disposal events</div>
            </div>
            <div className="card">
              <div className="kpi-label">Estimated Financial Loss</div>
              <div className="kpi-value" style={{ color: '#dc2626' }}>
                ${analytics.summary.totalLossAmount.toFixed(2)}
              </div>
              <div className="kpi-meta">Based on batch cost price</div>
            </div>
            <div className="card">
              <div className="kpi-label">Top Wasted Category</div>
              <div className="kpi-value" style={{ fontSize: '1.25rem' }}>
                {analytics.byCategory[0]?.category || 'None'}
              </div>
              <div className="kpi-meta">
                ${(analytics.byCategory[0]?.totalLossAmount || 0).toFixed(2)} loss
              </div>
            </div>
            <div className="card">
              <div className="kpi-label">Highest-Waste Supplier</div>
              <div className="kpi-value" style={{ fontSize: '1.2rem' }}>
                {analytics.bySupplier[0]?.supplier || 'None'}
              </div>
              <div className="kpi-meta">
                ${(analytics.bySupplier[0]?.totalLossAmount || 0).toFixed(2)} loss
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <h3 className="section-title">Waste Loss by Category ($)</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={analytics.byCategory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="totalLossAmount" name="Cost Loss ($)" fill="#dc2626" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3 className="section-title">Waste Loss by Supplier ($)</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={analytics.bySupplier}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="supplier" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="totalLossAmount" name="Cost Loss ($)" fill="#ea580c" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="grid-2">
        <div className="card">
          <h3 className="section-title">Actionable Waste-Reduction Recommendations</h3>
          {recommendations.length === 0 ? (
            <div className="alert alert-success">No urgent waste risks detected right now.</div>
          ) : (
            recommendations.map((rec, i) => (
              <div
                key={`${rec.productId}-${i}`}
                style={{ padding: '10px 0', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>{rec.productName}</strong>
                  <span
                    className={`badge ${
                      rec.priority === 'critical'
                        ? 'badge-red'
                        : rec.priority === 'high'
                        ? 'badge-amber'
                        : 'badge-blue'
                    }`}
                  >
                    {rec.type}
                  </span>
                </div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{rec.title}</div>
                <div style={{ color: '#475569' }}>{rec.action}</div>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h3 className="section-title">Frequently Wasted Products</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Incidents</th>
                  <th>Qty Wasted</th>
                  <th>Loss ($)</th>
                </tr>
              </thead>
              <tbody>
                {(analytics?.frequentlyWastedProducts || []).map((item) => (
                  <tr key={item.productId}>
                    <td>
                      <strong>{item.name}</strong>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{item.category}</div>
                    </td>
                    <td>{item.incidents}</td>
                    <td>
                      {item.totalQuantity} {item.unit}
                    </td>
                    <td style={{ color: '#dc2626', fontWeight: 600 }}>
                      ${item.totalLossAmount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Recent Disposal & Spoilage Log</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Batch</th>
                <th>Supplier</th>
                <th>Qty</th>
                <th>Reason</th>
                <th>Loss ($)</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l._id}>
                  <td>{l.wastedAt.slice(0, 10)}</td>
                  <td>{l.productId?.name || 'Item'}</td>
                  <td>{l.batchNumber}</td>
                  <td>{l.supplier}</td>
                  <td>{l.quantityWasted}</td>
                  <td>
                    <span className="badge badge-red">{l.reason}</span>
                  </td>
                  <td>${l.estimatedLossAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
