import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import { BatchStatusBadge, PredictionSourceBadge, StockStatusBadges } from '../components/StatusBadges';
import DashboardPage from '../pages/DashboardPage';
import InventoryPage from '../pages/InventoryPage';
import * as apiClient from '../api/client';
import * as AuthCtx from '../context/AuthContext';

describe('FreshGuard UI Components', () => {
  test('renders orthogonal stock and expiry badges accurately', () => {
    render(<StockStatusBadges labels={['Low Stock', 'Near Expiry', 'Expired']} />);
    expect(screen.getByText('Low Stock')).toBeInTheDocument();
    expect(screen.getByText('Near Expiry')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  test('distinguishes real ML vs rule fallback badges and batch expiry status', () => {
    render(
      <div>
        <PredictionSourceBadge source="ml_model" modelUsed="RandomForestRegressor" />
        <PredictionSourceBadge source="rule_fallback" modelUsed="MovingAverageFallback" />
        <BatchStatusBadge batchStatus="expired" daysRemaining={-2} />
        <BatchStatusBadge batchStatus="near_expiry" daysRemaining={0} />
        <BatchStatusBadge batchStatus="fresh" daysRemaining={10} />
      </div>
    );
    expect(screen.getByText('ML: RandomForestRegressor')).toBeInTheDocument();
    expect(screen.getByText('Rule Fallback: MovingAverageFallback')).toBeInTheDocument();
    expect(screen.getByText('Expired (2d ago)')).toBeInTheDocument();
    expect(screen.getByText('Near Expiry (Today)')).toBeInTheDocument();
    expect(screen.getByText('Fresh (10d left)')).toBeInTheDocument();
  });

  test('renders Dashboard KPIs and recommendations from backend payload', async () => {
    vi.spyOn(apiClient, 'apiRequest').mockResolvedValue({
      kpis: {
        totalProducts: 15,
        totalPhysicalStock: 500,
        totalActiveStock: 450,
        totalExpiredStock: 50,
        totalNearExpiryStock: 60,
        nearExpiryItemCount: 4,
        lowStockCount: 3,
        outOfStockCount: 1,
        predictedStockoutCount: 2,
        estimatedWasteUnits30d: 35,
        estimatedWasteLoss30d: 84.5,
      },
      charts: {
        stockByCategory: [{ category: 'Dairy', healthyActive: 100, nearExpiry: 20, expired: 10 }],
        wasteTrends: [{ date: '2026-11-24', expired: 5, spoiled: 2, damaged: 0 }],
        frequentlyWasted: [{ name: 'Milk', totalLossAmount: 24.5 }],
        demandTrend: [{ date: '2026-11-24', actualUnits: 45, predictedUnits: 48 }],
      },
      reorderRecommendations: [
        {
          productId: 'p1',
          name: 'Organic Whole Milk 1L',
          unit: 'bottles',
          activeUsableQuantity: 8,
          minStockThreshold: 25,
          predictedDailyDemand: 18,
          predictedStockoutDays: 1,
          recommendedQuantity: 90,
          predictionSource: 'ml_model',
        },
      ],
      wasteRecommendations: [
        {
          productId: 'p2',
          productName: 'Greek Yogurt 500g',
          priority: 'high',
          title: 'Apply 20% markdown',
          action: 'Sell near-expiry units first.',
        },
      ],
      recentActivity: [],
      modelSummary: { selectedDemandAlgorithm: 'RandomForestRegressor' },
    });

    render(<DashboardPage />);
    expect(await screen.findByText('Store Operations Dashboard')).toBeInTheDocument();
    expect(screen.getByText('450')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('Organic Whole Milk 1L')).toBeInTheDocument();
    expect(screen.getByText('$84.50')).toBeInTheDocument();
  });

  test('renders Inventory explorer with expandable FEFO batch rows', async () => {
    vi.spyOn(AuthCtx, 'useAuth').mockReturnValue({
      user: { id: 'u1', name: 'Mgr', email: 'm@local', role: 'manager' },
      isManagerOrAdmin: true,
      isAdmin: false,
    });

    vi.spyOn(apiClient, 'apiRequest').mockResolvedValue({
      items: [
        {
          id: 'prod-1',
          sku: 'DRY-001',
          name: 'Organic Whole Milk 1L',
          category: 'Dairy',
          unit: 'bottles',
          defaultSupplier: 'GreenValley Dairy',
          sellingPrice: 2.6,
          storeLocation: 'Chiller A1',
          activeUsableQuantity: 10,
          nearExpiryQuantity: 4,
          expiredQuantity: 6,
          totalPhysicalQuantity: 16,
          wastedQuantity: 2,
          minStockThreshold: 25,
          statusLabels: ['Low Stock', 'Near Expiry', 'Expired'],
          batches: [
            {
              _id: 'b-1',
              batchNumber: 'DRY-001-NR01',
              purchaseDate: '2026-11-20T00:00:00.000Z',
              expiryDate: '2026-11-27T00:00:00.000Z',
              remainingQuantity: 4,
              initialQuantity: 10,
              costPrice: 1.4,
              sellingPrice: 2.6,
              storeLocation: 'Chiller A1',
              batchStatus: 'near_expiry',
              daysRemaining: 2,
              isExpired: false,
              isDiscarded: false,
            },
          ],
        },
      ],
      filters: { categories: ['Dairy'], suppliers: ['GreenValley Dairy'] },
    });

    render(
      <MemoryRouter>
        <InventoryPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Organic Whole Milk 1L')).toBeInTheDocument();
    const toggleBtn = screen.getByLabelText('Toggle batches for Organic Whole Milk 1L');
    fireEvent.click(toggleBtn);
    expect(await screen.findByText('DRY-001-NR01')).toBeInTheDocument();
  });
});
