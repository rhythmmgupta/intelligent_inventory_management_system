const request = require('supertest');
const bcrypt = require('bcryptjs');
const createApp = require('../src/app');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const { getStoreToday, addDaysUTC, formatISODate } = require('../src/utils/dateUtils');

const app = createApp();

async function createUserAndLogin(role = 'manager', email = 'mgr@test.local') {
  const password = 'TestPassword123!';
  const passwordHash = await bcrypt.hash(password, 8);
  await User.create({ name: `Test ${role}`, email, passwordHash, role });

  const loginRes = await request(app).post('/api/auth/login').send({ email, password });
  expect(loginRes.status).toBe(200);
  return loginRes.body.token;
}

describe('FreshGuard API Integration Tests', () => {
  test('health endpoint returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('enforces authentication and RBAC roles', async () => {
    const unauth = await request(app).get('/api/inventory');
    expect(unauth.status).toBe(401);

    const staffToken = await createUserAndLogin('staff', 'staff@test.local');
    const forbiddenBatchCreate = await request(app)
      .post('/api/inventory/batches')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});
    expect(forbiddenBatchCreate.status).toBe(403);
  });

  test('supports full inventory -> FEFO sale -> waste disposal -> dashboard & audit lifecycle', async () => {
    const mgrToken = await createUserAndLogin('manager', 'manager@test.local');
    const today = getStoreToday();

    // 1. Add new product + initial near-expiry batch
    const createRes = await request(app)
      .post('/api/inventory/batches')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({
        sku: 'PRD-55',
        name: 'Fresh Strawberries',
        category: 'Produce',
        unit: 'packs',
        minStockThreshold: 10,
        reorderQuantity: 30,
        batchNumber: 'STR-001',
        quantity: 20,
        purchaseDate: formatISODate(addDaysUTC(today, -3)),
        expiryDate: formatISODate(addDaysUTC(today, 2)),
        supplier: 'BerryBest',
        costPrice: 2.0,
        sellingPrice: 4.5,
        storeLocation: 'Cooler 2',
      });
    expect(createRes.status).toBe(201);
    const productId = createRes.body.product._id;
    const batchId = createRes.body.batch._id;

    // 2. Add expired batch to verify expired vs active separation
    const expBatchRes = await request(app)
      .post('/api/inventory/batches')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({
        productId,
        batchNumber: 'STR-000',
        quantity: 5,
        purchaseDate: formatISODate(addDaysUTC(today, -10)),
        expiryDate: formatISODate(addDaysUTC(today, -1)),
        supplier: 'BerryBest',
        costPrice: 2.0,
        sellingPrice: 4.5,
        storeLocation: 'Cooler 2',
      });
    expect(expBatchRes.status).toBe(201);
    const expiredBatchId = expBatchRes.body.batch._id;

    // 3. Record FEFO sale of 12 units
    const saleRes = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ productId, quantitySold: 12 });
    expect(saleRes.status).toBe(201);
    expect(saleRes.body.sale.batchAllocations[0].batchNumber).toBe('STR-001');

    // 4. Filter inventory by low_stock (8 active left <= 10 threshold)
    const invRes = await request(app)
      .get('/api/inventory?stockStatus=low_stock&expiryStatus=expired')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(invRes.status).toBe(200);
    expect(invRes.body.items).toHaveLength(1);
    expect(invRes.body.items[0].activeUsableQuantity).toBe(8);
    expect(invRes.body.items[0].expiredQuantity).toBe(5);

    // 5. Log disposal of expired batch
    const wasteRes = await request(app)
      .post('/api/waste')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ batchId: expiredBatchId, reason: 'expired', notes: 'Past sell-by date' });
    expect(wasteRes.status).toBe(201);
    expect(wasteRes.body.wasteLog.estimatedLossAmount).toBe(10);

    // 6. Dashboard summary works cleanly even with ML fallback when ML service is offline
    const dashRes = await request(app)
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.kpis.totalActiveStock).toBe(8);
    expect(dashRes.body.kpis.estimatedWasteUnits30d).toBe(5);
    expect(dashRes.body.reorderRecommendations.length).toBeGreaterThanOrEqual(1);

    // 7. Verify unreferenced deletion vs referenced protection
    const deleteBlocked = await request(app)
      .delete(`/api/inventory/batches/${batchId}`)
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(deleteBlocked.status).toBe(409);

    // 8. Audit logs captured actions
    const auditCount = await AuditLog.countDocuments();
    expect(auditCount).toBeGreaterThanOrEqual(4);
  });
});
