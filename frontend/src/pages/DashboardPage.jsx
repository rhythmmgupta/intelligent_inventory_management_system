import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiRequest } from '../api/client';
import { formatINR } from '../utils/currency';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [nearExpiryDays, setNearExpiryDays] = useState(7);
  const [actionTab, setActionTab] = useState('reorders');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async (windowDays = nearExpiryDays) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest(`/dashboard/summary?nearExpiryDays=${windowDays}`);
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard(nearExpiryDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearExpiryDays]);

  if (loading && !data) return <div className="card">Loading store operations dashboard...</div>;
  if (error && !data) return <div className="alert alert-error">{error}</div>;
  if (!data) return null;

  const { kpis, charts, reorderRecommendations, wasteRecommendations, recentActivity, modelSummary } =
    data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Store Overview</h1>
          <p className="page-subtitle">
            Active stock, expiry alerts, waste trends, and ML reorder outlook
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label htmlFor="near-window" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Expiry Alert Window:
          </label>
          <select
            id="near-window"
            className="select"
            style={{ width: 115 }}
            value={nearExpiryDays}
            onChange={(e) => setNearExpiryDays(Number(e.target.value))}
          >
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <button type="button" className="btn" onClick={() => loadDashboard(nearExpiryDays)}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="kpi-grid">
        <div className="card">
          <div className="kpi-label">Active Usable Stock</div>
          <div className="kpi-value" style={{ color: '#0f766e' }}>
            {kpis.totalActiveStock}
          </div>
          <div className="kpi-meta">{kpis.totalPhysicalStock} total physical units</div>
        </div>

        <div className="card">
          <div className="kpi-label">Expired Stock</div>
          <div className="kpi-value" style={{ color: '#dc2626' }}>
            {kpis.totalExpiredStock}
          </div>
          <div className="kpi-meta">Excluded from active stock</div>
        </div>

        <div className="card">
          <div className="kpi-label">Near-Expiry Items</div>
          <div className="kpi-value" style={{ color: '#d97706' }}>
            {kpis.nearExpiryItemCount} SKUs
          </div>
          <div className="kpi-meta">
            {kpis.totalNearExpiryStock} units within {nearExpiryDays}d
          </div>
        </div>

        <div className="card">
          <div className="kpi-label">Low / Out of Stock</div>
          <div className="kpi-value" style={{ color: '#b45309' }}>
            {kpis.lowStockCount + kpis.outOfStockCount}
          </div>
          <div className="kpi-meta">
            {kpis.lowStockCount} low · {kpis.outOfStockCount} out of stock
          </div>
        </div>

        <div className="card">
          <div className="kpi-label">Predicted Stockouts</div>
          <div className="kpi-value" style={{ color: '#1d4ed8' }}>
            {kpis.predictedStockoutCount} SKUs
          </div>
          <div className="kpi-meta">
            {modelSummary ? modelSummary.selectedDemandAlgorithm : 'Demand engine active'}
          </div>
        </div>

        <div className="card">
          <div className="kpi-label">30-Day Food Waste</div>
          <div className="kpi-value" style={{ color: '#dc2626' }}>
            {formatINR(kpis.estimatedWasteLoss30d)}
          </div>
          <div className="kpi-meta">{kpis.estimatedWasteUnits30d} units discarded</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="section-title">Stock Levels by Category</h3>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={charts.stockByCategory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="healthyActive" name="Active" stackId="a" fill="#0f766e" />
                <Bar dataKey="nearExpiry" name="Near Expiry" stackId="a" fill="#f59e0b" />
                <Bar dataKey="expired" name="Expired" stackId="a" fill="#dc2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3 className="section-title">Daily Demand: Actual vs ML Forecast</h3>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={charts.demandTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="actualUnits"
                  name="Actual Sold"
                  stroke="#0f766e"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="predictedUnits"
                  name="Forecast"
                  stroke="#1d4ed8"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title">
          <span>Waste Trends (Last 30 Days)</span>
          <Link to="/waste" className="btn btn-sm">
            Full Waste Report <ArrowRight size={13} />
          </Link>
        </h3>
        <div style={{ width: '100%', height: 210 }}>
          <ResponsiveContainer>
            <BarChart data={charts.wasteTrends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="expired" name="Expired" stackId="w" fill="#dc2626" />
              <Bar dataKey="spoiled" name="Spoiled" stackId="w" fill="#ea580c" />
              <Bar dataKey="damaged" name="Damaged" stackId="w" fill="#ca8a04" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="section-title" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${actionTab === 'reorders' ? 'btn-primary' : ''}`}
                onClick={() => setActionTab('reorders')}
              >
                Reorder Alerts ({reorderRecommendations.length})
              </button>
              <button
                type="button"
                className={`btn btn-sm ${actionTab === 'waste' ? 'btn-primary' : ''}`}
                onClick={() => setActionTab('waste')}
              >
                <AlertTriangle size={13} /> Waste Actions ({wasteRecommendations.length})
              </button>
            </div>
            <Link
              to={actionTab === 'reorders' ? '/forecasts' : '/waste'}
              style={{ fontSize: '0.8rem', color: '#0f766e', textDecoration: 'none' }}
            >
              Open Planner →
            </Link>
          </div>

          {actionTab === 'reorders' ? (
            reorderRecommendations.length === 0 ? (
              <div className="alert alert-success">
                <CheckCircle2 size={15} /> All active stock levels are healthy.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Active / Min</th>
                      <th>Order Qty</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reorderRecommendations.slice(0, 6).map((rec) => (
                      <tr key={rec.productId}>
                        <td>
                          <strong>{rec.name}</strong>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {rec.predictedStockoutDays
                              ? `Runs out in ~${rec.predictedStockoutDays}d`
                              : `Est. ${rec.predictedDailyDemand}/day`}
                          </div>
                        </td>
                        <td>
                          {rec.activeUsableQuantity} / {rec.minStockThreshold}
                        </td>
                        <td>
                          <strong style={{ color: '#0f766e' }}>
                            +{rec.recommendedQuantity} {rec.unit}
                          </strong>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              rec.predictionSource === 'ml_model' ? 'badge-blue' : 'badge-slate'
                            }`}
                          >
                            {rec.predictionSource === 'ml_model' ? 'ML' : 'Rule'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : wasteRecommendations.length === 0 ? (
            <div className="alert alert-success">No urgent waste risks detected.</div>
          ) : (
            wasteRecommendations.slice(0, 5).map((adv, idx) => (
              <div
                key={`${adv.productId}-${idx}`}
                style={{
                  padding: '9px 0',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '0.84rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <strong>{adv.productName}</strong>
                  <span
                    className={`badge ${
                      adv.priority === 'critical'
                        ? 'badge-red'
                        : adv.priority === 'high'
                        ? 'badge-amber'
                        : 'badge-blue'
                    }`}
                  >
                    {adv.title}
                  </span>
                </div>
                <div style={{ color: '#475569' }}>{adv.action}</div>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <h3 className="section-title">
            <span>Recent Inventory Activity</span>
            <Link
              to="/inventory"
              style={{ fontSize: '0.8rem', color: '#0f766e', textDecoration: 'none' }}
            >
              View Stock →
            </Link>
          </h3>
          {recentActivity.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
              No recent stock movements recorded yet.
            </div>
          ) : (
            <div>
              {recentActivity.slice(0, 6).map((act) => (
                <div
                  key={act._id}
                  style={{
                    padding: '9px 0',
                    borderBottom: '1px solid #e2e8f0',
                    fontSize: '0.84rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span className="badge badge-slate">{act.action.replaceAll('_', ' ')}</span>
                    <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      {new Date(act.timestamp).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div style={{ color: '#1e293b' }}>{act.summary}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
