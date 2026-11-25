import React, { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Brain, RefreshCw } from 'lucide-react';
import { apiRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PredictionSourceBadge } from '../components/StatusBadges';

export default function ForecastsPage() {
  const { isManagerOrAdmin } = useAuth();
  const [predictions, setPredictions] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [detail, setDetail] = useState(null);
  const [reorders, setReorders] = useState([]);
  const [metricsRun, setMetricsRun] = useState(null);
  const [training, setTraining] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadAll = async () => {
    setError('');
    try {
      const [predRes, recRes, metRes] = await Promise.all([
        apiRequest('/predictions/stockouts'),
        apiRequest('/reorders/recommendations'),
        apiRequest('/predictions/metrics'),
      ]);
      const list = predRes.predictions || [];
      setPredictions(list);
      setReorders(recRes.recommendations || []);
      setMetricsRun(metRes.modelRun || null);
      if (!selectedProductId && list.length > 0) {
        setSelectedProductId(list[0].productId);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProductId) return;
    apiRequest(`/predictions/forecast/${selectedProductId}`)
      .then((res) => setDetail(res))
      .catch((err) => setError(err.message));
  }, [selectedProductId]);

  const handleRetrain = async () => {
    setTraining(true);
    setError('');
    setMessage('');
    try {
      const res = await apiRequest('/predictions/retrain', { method: 'POST' });
      setMetricsRun(res.modelRun);
      setMessage(
        `Models retrained successfully (${res.modelRun.selectedDemandAlgorithm}, ${res.modelRun.trainingRows} rows).`
      );
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setTraining(false);
    }
  };

  const handleReorderStatus = async (id, status) => {
    try {
      await apiRequest(`/reorders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const chartData = detail
    ? [
        ...detail.historicalSales.slice(-14).map((h) => ({
          date: h.date,
          actual: h.units_sold,
          forecast: null,
        })),
        ...(detail.prediction?.forecastHorizon || []).map((f) => ({
          date: f.date,
          actual: null,
          forecast: f.predicted_units,
          lower: f.lower_bound,
          upper: f.upper_bound,
        })),
      ]
    : [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">ML Demand Forecasting & Reorder Planner</h1>
          <p className="page-subtitle">
            Explainable scikit-learn forecasting coupled with expiry-aware FEFO stockout simulation
          </p>
        </div>

        {isManagerOrAdmin && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={training}
            onClick={handleRetrain}
          >
            <RefreshCw size={15} /> {training ? 'Retraining ML...' : 'Retrain ML Models'}
          </button>
        )}
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid-2">
        <div className="card">
          <h3 className="section-title">
            <span>SKU Forecast & Explanation</span>
            <select
              className="select"
              style={{ width: 220 }}
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
            >
              {predictions.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.name}
                </option>
              ))}
            </select>
          </h3>

          {detail?.prediction && (
            <>
              <div style={{ marginBottom: 10 }}>
                <PredictionSourceBadge
                  source={detail.prediction.predictionSource}
                  modelUsed={detail.prediction.modelUsed}
                />
                <span
                  className={`badge ${
                    detail.prediction.stockoutRisk === 'HIGH'
                      ? 'badge-red'
                      : detail.prediction.stockoutRisk === 'MEDIUM'
                      ? 'badge-amber'
                      : 'badge-green'
                  }`}
                >
                  Stockout Risk: {detail.prediction.stockoutRisk} (
                  {Math.round(detail.prediction.stockoutProbability * 100)}%)
                </span>
              </div>

              <div className="alert alert-info" style={{ fontSize: '0.84rem' }}>
                <strong>How this prediction was generated:</strong> {detail.prediction.explanation}
              </div>

              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="actual" name="Actual Sales" stroke="#0f766e" strokeWidth={2} />
                    <Line
                      type="monotone"
                      dataKey="forecast"
                      name="ML Forecast"
                      stroke="#1d4ed8"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h3 className="section-title">
            <span>ML Model Evaluation Metrics</span>
            <Brain size={17} color="#1d4ed8" />
          </h3>
          {!metricsRun ? (
            <div className="alert alert-info">
              No saved model run record in MongoDB yet. Click &ldquo;Retrain ML Models&rdquo; to
              benchmark Moving Average, Ridge, and Random Forest on live store sales.
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.84rem', marginBottom: 12 }}>
                Selected Demand Model: <strong>{metricsRun.selectedDemandAlgorithm}</strong> ·
                Stockout Classifier: <strong>{metricsRun.selectedClassifierAlgorithm}</strong> ·
                Training Rows: <strong>{metricsRun.trainingRows}</strong>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>Demand Candidate</th>
                    <th>MAE</th>
                    <th>RMSE</th>
                    <th>MAPE (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {(metricsRun.metrics?.candidates || []).map((c) => (
                    <tr key={c.name}>
                      <td>
                        <strong>{c.name}</strong>
                      </td>
                      <td>{c.mae}</td>
                      <td>{c.rmse}</td>
                      <td>{c.mape}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 14, fontSize: '0.85rem' }}>
                <strong>Stockout Risk Classifier Metrics:</strong> Precision{' '}
                <span className="badge badge-blue">
                  {metricsRun.metrics?.classification?.precision}
                </span>{' '}
                Recall{' '}
                <span className="badge badge-green">
                  {metricsRun.metrics?.classification?.recall}
                </span>{' '}
                F1-Score{' '}
                <span className="badge badge-slate">{metricsRun.metrics?.classification?.f1}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Reorder Recommendations Queue</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Active Stock</th>
                <th>Predicted / Day</th>
                <th>ROP</th>
                <th>Order Qty</th>
                <th>Urgency</th>
                <th>Source</th>
                <th>Status</th>
                {isManagerOrAdmin && <th>Decision</th>}
              </tr>
            </thead>
            <tbody>
              {reorders.map((rec) => (
                <tr key={rec._id}>
                  <td>
                    <strong>{rec.product?.name}</strong>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {rec.product?.supplier} · {rec.explanation}
                    </div>
                  </td>
                  <td>{rec.activeStockAtGeneration}</td>
                  <td>{rec.predictedDailyDemand}</td>
                  <td>{rec.recommendedReorderPoint}</td>
                  <td>
                    <strong>
                      +{rec.recommendedQuantity} {rec.product?.unit}
                    </strong>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        rec.urgency === 'critical'
                          ? 'badge-red'
                          : rec.urgency === 'high'
                          ? 'badge-amber'
                          : 'badge-blue'
                      }`}
                    >
                      {rec.urgency}
                    </span>
                  </td>
                  <td>
                    <PredictionSourceBadge
                      source={rec.predictionSource}
                      modelUsed={rec.predictionSource === 'ml_model' ? 'ML' : 'Fallback'}
                    />
                  </td>
                  <td>
                    <span className="badge badge-slate">{rec.status}</span>
                  </td>
                  {isManagerOrAdmin && (
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => handleReorderStatus(rec._id, 'approved')}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleReorderStatus(rec._id, 'ordered')}
                      >
                        Ordered
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => handleReorderStatus(rec._id, 'dismissed')}
                      >
                        Dismiss
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
