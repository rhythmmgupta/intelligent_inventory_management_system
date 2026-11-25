from datetime import date, timedelta
from typing import Dict, List
import numpy as np


def generate_synthetic_products(days: int = 150) -> List[Dict]:
    """
    Deterministic retail demand dataset used for initial cold-start model training
    and standalone ML unit verification before live store sales accumulate.
    """
    rng = np.random.default_rng(2026)
    today = date.today()
    catalog = [
        ("syn-1", "DRY-001", "Organic Whole Milk 1L", "Dairy", 2.6, 2, 25, 18),
        ("syn-2", "DRY-002", "Greek Yogurt 500g", "Dairy", 3.4, 2, 18, 12),
        ("syn-3", "BKY-001", "Sourdough Artisan Loaf", "Bakery", 3.8, 1, 15, 14),
        ("syn-4", "PRD-001", "Baby Spinach 200g", "Produce", 2.7, 2, 18, 13),
        ("syn-5", "BEV-001", "Cold-Pressed Orange Juice 1L", "Beverages", 4.4, 3, 20, 15),
        ("syn-6", "DEL-001", "Free-Range Eggs 12-Pack", "Dairy & Eggs", 4.3, 2, 24, 17),
        ("syn-7", "PNT-001", "Extra Virgin Olive Oil 750ml", "Pantry", 11.9, 5, 12, 5),
    ]

    dataset = []
    for pid, sku, name, category, price, lead_time, min_thresh, base in catalog:
        history = []
        for offset in range(days, 0, -1):
            d = today - timedelta(days=offset)
            dow = d.weekday()  # 0=Mon, 4=Fri, 5=Sat, 6=Sun
            weekend_boost = 1.24 if dow >= 4 else 0.94
            wave = 1.0 + 0.1 * np.sin((2.0 * np.pi * offset) / 30.0)
            discounted = 1 if (offset % 21 in (0, 1)) else 0
            promo_mult = 1.3 if discounted else 1.0
            noise = float(rng.normal(1.0, 0.12))
            units = max(1, int(round(base * weekend_boost * wave * promo_mult * noise)))
            history.append(
                {
                    "date": d.isoformat(),
                    "units_sold": float(units),
                    "unit_price": round(price * (0.85 if discounted else 1.0), 2),
                    "was_discounted": discounted,
                }
            )

        dataset.append(
            {
                "product_id": pid,
                "sku": sku,
                "name": name,
                "category": category,
                "selling_price": price,
                "lead_time_days": lead_time,
                "min_stock_threshold": min_thresh,
                "sales_history": history,
            }
        )
    return dataset
