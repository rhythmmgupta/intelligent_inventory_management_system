import React from 'react';

const STATUS_STYLE = {
  'In Stock': 'badge-green',
  'Low Stock': 'badge-amber',
  'Out of Stock': 'badge-red',
  'Near Expiry': 'badge-amber',
  Expired: 'badge-red',
};

export function StockStatusBadges({ labels = [] }) {
  return (
    <span>
      {labels.map((label) => (
        <span key={label} className={`badge ${STATUS_STYLE[label] || 'badge-slate'}`}>
          {label}
        </span>
      ))}
    </span>
  );
}

export function BatchStatusBadge({ batchStatus, daysRemaining }) {
  if (batchStatus === 'expired') {
    return <span className="badge badge-red">Expired ({Math.abs(daysRemaining)}d ago)</span>;
  }
  if (batchStatus === 'near_expiry') {
    return (
      <span className="badge badge-amber">
        Near Expiry ({daysRemaining === 0 ? 'Today' : `${daysRemaining}d left`})
      </span>
    );
  }
  if (batchStatus === 'fresh') {
    return <span className="badge badge-green">Fresh ({daysRemaining}d left)</span>;
  }
  return <span className="badge badge-slate">{batchStatus}</span>;
}

export function PredictionSourceBadge({ source, modelUsed }) {
  const isMl = source === 'ml_model';
  return (
    <span className={`badge ${isMl ? 'badge-blue' : 'badge-slate'}`}>
      {isMl ? `ML: ${modelUsed}` : `Rule Fallback: ${modelUsed}`}
    </span>
  );
}
