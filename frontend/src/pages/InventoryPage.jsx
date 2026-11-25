import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BatchStatusBadge, StockStatusBadges } from '../components/StatusBadges';

const INITIAL_BATCH_FORM = {
  mode: 'new',
  productId: '',
  sku: '',
  name: '',
  category: 'Dairy',
  unit: 'units',
  minStockThreshold: 15,
  reorderQuantity: 30,
  batchNumber: '',
  quantity: 25,
  purchaseDate: new Date().toISOString().slice(0, 10),
  expiryDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
  supplier: '',
  costPrice: 1.5,
  sellingPrice: 3.0,
  storeLocation: 'Aisle 1',
};

export default function InventoryPage() {
  const { isManagerOrAdmin } = useAuth();
  const [items, setItems] = useState([]);
  const [filtersMeta, setFiltersMeta] = useState({ categories: [], suppliers: [] });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState('');
  const [stockStatus, setStockStatus] = useState('');
  const [expiryStatus, setExpiryStatus] = useState('');
  const [nearExpiryDays, setNearExpiryDays] = useState(7);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [batchForm, setBatchForm] = useState(INITIAL_BATCH_FORM);
  const [wasteModalBatch, setWasteModalBatch] = useState(null);
  const [wasteReason, setWasteReason] = useState('expired');
  const [wasteQty, setWasteQty] = useState('');
  const [editBatch, setEditBatch] = useState(null);

  const loadInventory = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      if (category) qs.set('category', category);
      if (supplier) qs.set('supplier', supplier);
      if (stockStatus) qs.set('stockStatus', stockStatus);
      if (expiryStatus) qs.set('expiryStatus', expiryStatus);
      qs.set('nearExpiryDays', String(nearExpiryDays));

      const res = await apiRequest(`/inventory?${qs.toString()}`);
      setItems(res.items || []);
      setFiltersMeta(res.filters || { categories: [], suppliers: [] });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, supplier, stockStatus, expiryStatus, nearExpiryDays]);

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const payload =
        batchForm.mode === 'existing'
          ? {
              productId: batchForm.productId,
              batchNumber: batchForm.batchNumber,
              quantity: batchForm.quantity,
              purchaseDate: batchForm.purchaseDate,
              expiryDate: batchForm.expiryDate,
              supplier: batchForm.supplier,
              costPrice: batchForm.costPrice,
              sellingPrice: batchForm.sellingPrice,
              storeLocation: batchForm.storeLocation,
            }
          : {
              sku: batchForm.sku || undefined,
              name: batchForm.name,
              category: batchForm.category,
              unit: batchForm.unit,
              minStockThreshold: batchForm.minStockThreshold,
              reorderQuantity: batchForm.reorderQuantity,
              batchNumber: batchForm.batchNumber,
              quantity: batchForm.quantity,
              purchaseDate: batchForm.purchaseDate,
              expiryDate: batchForm.expiryDate,
              supplier: batchForm.supplier,
              costPrice: batchForm.costPrice,
              sellingPrice: batchForm.sellingPrice,
              storeLocation: batchForm.storeLocation,
            };

      await apiRequest('/inventory/batches', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setShowAddModal(false);
      setBatchForm(INITIAL_BATCH_FORM);
      setMessage('Inventory batch added successfully.');
      loadInventory();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleWasteSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/waste', {
        method: 'POST',
        body: JSON.stringify({
          batchId: wasteModalBatch._id,
          quantityWasted: wasteQty ? Number(wasteQty) : undefined,
          reason: wasteReason,
          notes: 'Logged from inventory explorer',
        }),
      });
      setWasteModalBatch(null);
      setMessage('Waste disposal recorded and deducted from physical shelf stock.');
      loadInventory();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleBatchUpdate = async (e) => {
    e.preventDefault();
    try {
      await apiRequest(`/inventory/batches/${editBatch._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          remainingQuantity: Number(editBatch.remainingQuantity),
          expiryDate: editBatch.expiryDate.slice(0, 10),
          storeLocation: editBatch.storeLocation,
          sellingPrice: Number(editBatch.sellingPrice),
        }),
      });
      setEditBatch(null);
      setMessage('Batch updated.');
      loadInventory();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteBatch = async (batchId) => {
    setError('');
    try {
      await apiRequest(`/inventory/batches/${batchId}`, { method: 'DELETE' });
      setMessage('Batch deleted.');
      loadInventory();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteProduct = async (productId) => {
    setError('');
    try {
      const res = await apiRequest(`/inventory/products/${productId}`, { method: 'DELETE' });
      setMessage(res.message);
      loadInventory();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory & FEFO Batches</h1>
          <p className="page-subtitle">
            Active usable quantities exclude expired lots while preserving physical & waste history
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            className="select"
            style={{ width: 130 }}
            value={nearExpiryDays}
            onChange={(e) => setNearExpiryDays(Number(e.target.value))}
          >
            <option value={7}>Near: 7 days</option>
            <option value={14}>Near: 14 days</option>
            <option value={30}>Near: 30 days</option>
          </select>
          {isManagerOrAdmin && (
            <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
              <Plus size={15} /> Add Item / Batch
            </button>
          )}
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filters-bar" style={{ marginBottom: 0 }}>
          <input
            className="input"
            placeholder="Search by item name, SKU, batch number, or supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All Categories</option>
            {filtersMeta.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select className="select" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">All Suppliers</option>
            {filtersMeta.suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={stockStatus}
            onChange={(e) => setStockStatus(e.target.value)}
          >
            <option value="">All Stock Statuses</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
          </select>
          <select
            className="select"
            value={expiryStatus}
            onChange={(e) => setExpiryStatus(e.target.value)}
          >
            <option value="">All Expiry States</option>
            <option value="near_expiry">Has Near-Expiry</option>
            <option value="expired">Has Expired</option>
            <option value="fresh">Fresh Only</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th>Item & SKU</th>
                <th>Category / Supplier</th>
                <th>Active Usable</th>
                <th>Near Expiry</th>
                <th>Expired</th>
                <th>Physical</th>
                <th>Wasted</th>
                <th>Min Threshold</th>
                <th>Status</th>
                {isManagerOrAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11}>Loading inventory...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11}>No inventory items match the selected filters.</td>
                </tr>
              ) : (
                items.map((item) => {
                  const isOpen = Boolean(expanded[item.id]);
                  return (
                    <React.Fragment key={item.id}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm"
                            aria-label={`Toggle batches for ${item.name}`}
                            onClick={() =>
                              setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                            }
                          >
                            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td>
                          <strong>{item.name}</strong>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {item.sku} · {item.storeLocation} · ${item.sellingPrice.toFixed(2)}/{item.unit}
                          </div>
                        </td>
                        <td>
                          <div>{item.category}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {item.defaultSupplier}
                          </div>
                        </td>
                        <td>
                          <strong style={{ color: '#0f766e' }}>
                            {item.activeUsableQuantity} {item.unit}
                          </strong>
                        </td>
                        <td style={{ color: item.nearExpiryQuantity > 0 ? '#d97706' : '#64748b' }}>
                          {item.nearExpiryQuantity}
                        </td>
                        <td style={{ color: item.expiredQuantity > 0 ? '#dc2626' : '#64748b' }}>
                          {item.expiredQuantity}
                        </td>
                        <td>{item.totalPhysicalQuantity}</td>
                        <td>{item.wastedQuantity}</td>
                        <td>{item.minStockThreshold}</td>
                        <td>
                          <StockStatusBadges labels={item.statusLabels} />
                        </td>
                        {isManagerOrAdmin && (
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDeleteProduct(item.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={11} style={{ background: '#f8fafc', padding: 14 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: 8 }}>
                              FEFO Batch Queue (Earliest Expiry First)
                            </div>
                            <table>
                              <thead>
                                <tr>
                                  <th>Batch #</th>
                                  <th>Purchase Date</th>
                                  <th>Expiry Date</th>
                                  <th>Remaining / Initial</th>
                                  <th>Cost / Sell</th>
                                  <th>Location</th>
                                  <th>State</th>
                                  <th>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {item.batches.map((b) => (
                                  <tr key={b._id}>
                                    <td>
                                      <strong>{b.batchNumber}</strong>
                                    </td>
                                    <td>{b.purchaseDate.slice(0, 10)}</td>
                                    <td>{b.expiryDate.slice(0, 10)}</td>
                                    <td>
                                      {b.remainingQuantity} / {b.initialQuantity} {item.unit}
                                    </td>
                                    <td>
                                      ${b.costPrice} / ${b.sellingPrice}
                                    </td>
                                    <td>{b.storeLocation}</td>
                                    <td>
                                      <BatchStatusBadge
                                        batchStatus={b.batchStatus}
                                        daysRemaining={b.daysRemaining}
                                      />
                                    </td>
                                    <td style={{ display: 'flex', gap: 6 }}>
                                      {!b.isDiscarded && b.remainingQuantity > 0 && (
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-danger"
                                          onClick={() => {
                                            setWasteModalBatch(b);
                                            setWasteQty(String(b.remainingQuantity));
                                            setWasteReason(b.isExpired ? 'expired' : 'damaged');
                                          }}
                                        >
                                          Dispose / Waste
                                        </button>
                                      )}
                                      {isManagerOrAdmin && (
                                        <>
                                          <button
                                            type="button"
                                            className="btn btn-sm"
                                            onClick={() => setEditBatch({ ...b })}
                                          >
                                            Edit
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-sm"
                                            onClick={() => handleDeleteBatch(b._id)}
                                          >
                                            Delete
                                          </button>
                                        </>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 style={{ marginTop: 0 }}>Add Inventory Item / Batch</h3>
            <form onSubmit={handleAddSubmit}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${batchForm.mode === 'new' ? 'btn-primary' : ''}`}
                  onClick={() => setBatchForm({ ...batchForm, mode: 'new' })}
                >
                  New Item + Batch
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${batchForm.mode === 'existing' ? 'btn-primary' : ''}`}
                  onClick={() =>
                    setBatchForm({
                      ...batchForm,
                      mode: 'existing',
                      productId: items[0]?.id || '',
                      supplier: items[0]?.defaultSupplier || '',
                    })
                  }
                >
                  Restock Existing Item
                </button>
              </div>

              <div className="form-grid">
                {batchForm.mode === 'existing' ? (
                  <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                    <label>Select Product</label>
                    <select
                      className="select"
                      value={batchForm.productId}
                      onChange={(e) => setBatchForm({ ...batchForm, productId: e.target.value })}
                      required
                    >
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div className="form-field">
                      <label>Item Name</label>
                      <input
                        className="input"
                        value={batchForm.name}
                        onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label>SKU (optional)</label>
                      <input
                        className="input"
                        value={batchForm.sku}
                        onChange={(e) => setBatchForm({ ...batchForm, sku: e.target.value })}
                      />
                    </div>
                    <div className="form-field">
                      <label>Category</label>
                      <input
                        className="input"
                        value={batchForm.category}
                        onChange={(e) => setBatchForm({ ...batchForm, category: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label>Unit</label>
                      <select
                        className="select"
                        value={batchForm.unit}
                        onChange={(e) => setBatchForm({ ...batchForm, unit: e.target.value })}
                      >
                        {['units', 'kg', 'liters', 'packs', 'boxes', 'bottles', 'loaves'].map(
                          (u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Min Stock Threshold</label>
                      <input
                        type="number"
                        className="input"
                        value={batchForm.minStockThreshold}
                        onChange={(e) =>
                          setBatchForm({ ...batchForm, minStockThreshold: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label>Reorder Quantity</label>
                      <input
                        type="number"
                        className="input"
                        value={batchForm.reorderQuantity}
                        onChange={(e) =>
                          setBatchForm({ ...batchForm, reorderQuantity: e.target.value })
                        }
                        required
                      />
                    </div>
                  </>
                )}

                <div className="form-field">
                  <label>Batch Number</label>
                  <input
                    className="input"
                    value={batchForm.batchNumber}
                    onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Quantity</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input"
                    value={batchForm.quantity}
                    onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Purchase Date</label>
                  <input
                    type="date"
                    className="input"
                    value={batchForm.purchaseDate}
                    onChange={(e) => setBatchForm({ ...batchForm, purchaseDate: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Expiry Date</label>
                  <input
                    type="date"
                    className="input"
                    value={batchForm.expiryDate}
                    onChange={(e) => setBatchForm({ ...batchForm, expiryDate: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Supplier</label>
                  <input
                    className="input"
                    value={batchForm.supplier}
                    onChange={(e) => setBatchForm({ ...batchForm, supplier: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Store Location</label>
                  <input
                    className="input"
                    value={batchForm.storeLocation}
                    onChange={(e) => setBatchForm({ ...batchForm, storeLocation: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Cost Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={batchForm.costPrice}
                    onChange={(e) => setBatchForm({ ...batchForm, costPrice: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Selling Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    value={batchForm.sellingPrice}
                    onChange={(e) => setBatchForm({ ...batchForm, sellingPrice: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button type="button" className="btn" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {wasteModalBatch && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: 420 }}>
            <h3 style={{ marginTop: 0 }}>Log Waste Disposal — {wasteModalBatch.batchNumber}</h3>
            <form onSubmit={handleWasteSubmit}>
              <div className="form-field" style={{ marginBottom: 10 }}>
                <label>Quantity Wasted (max {wasteModalBatch.remainingQuantity})</label>
                <input
                  type="number"
                  step="0.1"
                  max={wasteModalBatch.remainingQuantity}
                  className="input"
                  value={wasteQty}
                  onChange={(e) => setWasteQty(e.target.value)}
                  required
                />
              </div>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>Reason</label>
                <select
                  className="select"
                  value={wasteReason}
                  onChange={(e) => setWasteReason(e.target.value)}
                >
                  <option value="expired">Expired</option>
                  <option value="spoiled">Spoiled</option>
                  <option value="damaged">Damaged</option>
                  <option value="quality_reject">Quality Reject</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn" onClick={() => setWasteModalBatch(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger">
                  Confirm Disposal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editBatch && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: 440 }}>
            <h3 style={{ marginTop: 0 }}>Edit Batch — {editBatch.batchNumber}</h3>
            <form onSubmit={handleBatchUpdate}>
              <div className="form-field" style={{ marginBottom: 10 }}>
                <label>Remaining Quantity</label>
                <input
                  type="number"
                  step="0.1"
                  className="input"
                  value={editBatch.remainingQuantity}
                  onChange={(e) =>
                    setEditBatch({ ...editBatch, remainingQuantity: e.target.value })
                  }
                  required
                />
              </div>
              <div className="form-field" style={{ marginBottom: 10 }}>
                <label>Expiry Date</label>
                <input
                  type="date"
                  className="input"
                  value={editBatch.expiryDate.slice(0, 10)}
                  onChange={(e) => setEditBatch({ ...editBatch, expiryDate: e.target.value })}
                  required
                />
              </div>
              <div className="form-field" style={{ marginBottom: 10 }}>
                <label>Selling Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input"
                  value={editBatch.sellingPrice}
                  onChange={(e) => setEditBatch({ ...editBatch, sellingPrice: e.target.value })}
                  required
                />
              </div>
              <div className="form-field" style={{ marginBottom: 14 }}>
                <label>Store Location</label>
                <input
                  className="input"
                  value={editBatch.storeLocation}
                  onChange={(e) => setEditBatch({ ...editBatch, storeLocation: e.target.value })}
                  required
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn" onClick={() => setEditBatch(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Update Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
