import React, { useEffect, useState } from 'react';
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
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiRequest } from '../api/client';
import { PredictionSourceBadge } from '../components/StatusBadges';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [nearExpiryDays, setNearExpiryDays] = useState(7);
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
          <h1 className="page-title">Store Operations Dashboard</h1>
          <p className="page-subtitle">
            Real-time expiry-aware inventory, waste analytics, and ML demand outlook
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label htmlFor="near-window" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
            Near-Expiry Window:
          </label>
          <select
            id="near-window"
            className="select"
            style={{ width: 120 }}
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
          <div className="kpi-meta">Physical total: {kpis.totalPhysicalStock} units</div>
        </div>
        <div className="card">
          <div className="kpi-label">Expired On-Shelf</div>
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
            {kpis.lowStockCount} low · {kpis.outOfStockCount} out
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Predicted Stockouts</div>
          <div className="kpi-value" style={{ color: '#1d4ed8' }}>
            {kpis.predictedStockoutCount} SKUs
          </div>
          <div className="kpi-meta">
            {modelSummary
              ? `Model: ${modelSummary.selectedDemandAlgorithm}`
              : 'Using active demand engine'}
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">30-Day Food Waste</div>
          <div className="kpi-value" style={{ color: '#dc2626' }}>
            ${kpis.estimatedWasteLoss30d.toFixed(2)}
          </div>
          <div className="kpi-meta">{kpis.estimatedWasteUnits30d} units discarded</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="section-title">Stock Health by Category (Active vs Expired)</h3>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={charts.stockByCategory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="healthyActive" name="Healthy Active" stackId="a" fill="#0f766e" />
                <Bar dataKey="nearExpiry" name="Near Expiry" stackId="a" fill="#f59e0b" />
                <Bar dataKey="expired" name="Expired (Unusable)" stackId="a" fill="#dc2626" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3 className="section-title">Store Demand: 14d Actual vs 7d ML Forecast</h3>
          <div style={{ width: '100%', height: 260 }}>
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
                  name="Forecasted Demand"
                  stroke="#1d4ed8"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="section-title">Waste Trends Over Time (30 Days)</h3>
          <div style={{ width: '100%', height: 240 }}>
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

        <div className="card">
          <h3 className="section-title">Top Wasted Products (Cost Loss $)</h3>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={charts.frequentlyWasted} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="totalLossAmount" name="Loss ($)" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="section-title">
            <span>Reorder Recommendations</span>
            <span className="badge badge-blue">{reorderRecommendations.length} priority</span>
          </h3>
          {reorderRecommendations.length === 0 ? (
            <div className="alert alert-success">
              <CheckCircle2 size={15} /> All active stock levels are healthy.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Active</th>
                    <th>Forecast/d</th>
                    <th>Order Qty</th>
                    <th>Driver</th>
                  </tr>
                </thead>
                <tbody>
                  {reorderRecommendations.map((rec) => (
                    <tr key={rec.productId}>
                      <td>
                        <strong>{rec.name}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {rec.predictedStockoutDays
                            ? `Depletes in ~${rec.predictedStockoutDays}d`
                            : 'Below safety ROP'}
                        </div>
                      </td>
                      <td>
                        {rec.activeUsableQuantity} / {rec.minStockThreshold}
                      </td>
                      <td>{rec.predictedDailyDemand}</td>
                      <td>
                        <strong>
                          +{rec.recommendedQuantity} {rec.unit}
                        </strong>
                      </td>
                      <td>
                        <PredictionSourceBadge
                          source={rec.predictionSource}
                          modelUsed={rec.predictionSource === 'ml_model' ? 'ML' : 'Fallback'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="section-title">
            <span>Waste Reduction & FEFO Advisories</span>
            <AlertTriangle size={16} color="#d97706" />
          </h3>
          {wasteRecommendations.map((adv, idx) => (
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
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Recent Inventory & Audit Activity</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {recentActivity.map((act) => (
                <tr key={act._id}>
                  <td style={{ whiteSpace: 'nowrap', color: '#64748b' }}>
                    {new Date(act.timestamp).toLocaleString()}
                  </td>
                  <td>
                    <span className="badge badge-slate">{act.action}</span>
                  </td>
                  <td>{act.actorEmail}</td>
                  <td>{act.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
