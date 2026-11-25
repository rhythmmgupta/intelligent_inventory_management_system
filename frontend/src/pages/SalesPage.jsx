import React, { useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { apiRequest } from '../api/client';

export default function SalesPage() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [productId, setProductId] = useState('');
  const [quantitySold, setQuantitySold] = useState(5);
  const [wasDiscounted, setWasDiscounted] = useState(false);
  const [lastAllocation, setLastAllocation] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    const [invRes, salesRes] = await Promise.all([
      apiRequest('/inventory'),
      apiRequest('/sales?limit=25'),
    ]);
    const list = invRes.items || [];
    setProducts(list);
    if (!productId && list.length > 0) setProductId(list[0].id);
    setSales(salesRes.sales || []);
  };

  useEffect(() => {
    loadData().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProduct = products.find((p) => p.id === productId);

  const handleSale = async (e) => {
    e.preventDefault();
    setError('');
    setLastAllocation(null);
    setSubmitting(true);
    try {
      const price =
        selectedProduct && wasDiscounted
          ? Number((selectedProduct.sellingPrice * 0.75).toFixed(2))
          : selectedProduct?.sellingPrice;

      const res = await apiRequest('/sales', {
        method: 'POST',
        body: JSON.stringify({
          productId,
          quantitySold: Number(quantitySold),
          unitSellingPrice: price,
          wasDiscounted,
        }),
      });
      setLastAllocation(res.sale);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Point of Sale & FEFO Deduction</h1>
          <p className="page-subtitle">
            Sales automatically deplete earliest-expiring active batches and block expired stock
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {lastAllocation && (
        <div className="alert alert-success">
          <strong>Sale Recorded (${lastAllocation.totalRevenue.toFixed(2)})</strong> — FEFO
          allocated from:{' '}
          {lastAllocation.batchAllocations
            .map((a) => `${a.batchNumber} (${a.quantityDeducted} units, exp ${a.expiryDate.slice(0, 10)})`)
            .join(', ')}
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h3 className="section-title">Record Customer Sale</h3>
          <form onSubmit={handleSale}>
            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>Product</label>
              <select
                className="select"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — Active: {p.activeUsableQuantity} {p.unit}
                    {p.expiredQuantity > 0 ? ` (${p.expiredQuantity} expired blocked)` : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedProduct && (
              <div className="alert alert-info" style={{ fontSize: '0.82rem' }}>
                Active Usable: <strong>{selectedProduct.activeUsableQuantity}</strong> · Expired
                (Blocked): <strong>{selectedProduct.expiredQuantity}</strong> · Min Threshold:{' '}
                <strong>{selectedProduct.minStockThreshold}</strong>
              </div>
            )}

            <div className="form-field" style={{ marginBottom: 12 }}>
              <label>Quantity Sold</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                className="input"
                value={quantitySold}
                onChange={(e) => setQuantitySold(e.target.value)}
                required
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: '0.86rem' }}>
              <input
                type="checkbox"
                checked={wasDiscounted}
                onChange={(e) => setWasDiscounted(e.target.checked)}
              />
              Apply 25% Near-Expiry Markdown Discount
            </label>

            <button type="submit" className="btn btn-primary" disabled={submitting || !productId}>
              <ShoppingCart size={15} /> {submitting ? 'Processing FEFO...' : 'Complete Sale'}
            </button>
          </form>
        </div>

        <div className="card">
          <h3 className="section-title">Recent Sales & Batch Allocations</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Revenue</th>
                  <th>FEFO Batches</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s._id}>
                    <td>{s.saleDate.slice(0, 10)}</td>
                    <td>{s.productId?.name || 'Item'}</td>
                    <td>{s.quantitySold}</td>
                    <td>${s.totalRevenue.toFixed(2)}</td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {s.batchAllocations.length > 0
                        ? s.batchAllocations.map((a) => `${a.batchNumber}(-${a.quantityDeducted})`).join(', ')
                        : 'Historical Seed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
