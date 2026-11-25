from datetime import date, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.synthetic_data import generate_synthetic_products


def test_health_and_model_bootstrap():
    with TestClient(app) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["model_loaded"] is True


def test_train_and_predict_with_expiry_simulation_and_cold_start():
    today = date.today()
    synthetic = generate_synthetic_products(days=90)

    with TestClient(app) as client:
        train_resp = client.post("/train", json={"products": synthetic})
        assert train_resp.status_code == 200
        meta = train_resp.json()
        assert "regression" in meta["metrics"]
        assert "classification" in meta["metrics"]
        assert meta["metrics"]["regression"]["mae"] >= 0
        assert 0.0 <= meta["metrics"]["classification"]["f1"] <= 1.0

        # Product 1 has 90 days history + batch expiring in 1 day -> triggers expiry-aware stockout
        # Product 2 has only 3 days history -> triggers honest cold-start rule fallback
        predict_payload = {
            "horizon_days": 7,
            "target_cover_days": 10,
            "safety_z_score": 1.28,
            "products": [
                {
                    **synthetic[0],
                    "active_usable_quantity": 40.0,
                    "batches": [
                        {
                            "remaining_quantity": 40.0,
                            "expiry_date": (today + timedelta(days=1)).isoformat(),
                        }
                    ],
                },
                {
                    "product_id": "cold-1",
                    "sku": "NEW-01",
                    "name": "New Seasonal Juice",
                    "category": "Beverages",
                    "selling_price": 4.0,
                    "lead_time_days": 2,
                    "min_stock_threshold": 10.0,
                    "active_usable_quantity": 5.0,
                    "batches": [
                        {
                            "remaining_quantity": 5.0,
                            "expiry_date": (today + timedelta(days=10)).isoformat(),
                        }
                    ],
                    "sales_history": [
                        {
                            "date": (today - timedelta(days=2)).isoformat(),
                            "units_sold": 6.0,
                            "unit_price": 4.0,
                            "was_discounted": 0,
                        },
                        {
                            "date": (today - timedelta(days=1)).isoformat(),
                            "units_sold": 8.0,
                            "unit_price": 4.0,
                            "was_discounted": 0,
                        },
                    ],
                },
            ],
        }

        pred_resp = client.post("/predict/stockout-risk", json=predict_payload)
        assert pred_resp.status_code == 200
        preds = pred_resp.json()["predictions"]
        assert len(preds) == 2

        ml_pred = preds[0]
        assert ml_pred["prediction_source"] == "ml_model"
        assert len(ml_pred["forecast_horizon"]) == 7
        # 40 units expire after day 1, so stockout happens around day 3 despite 40 units on shelf!
        assert ml_pred["predicted_stockout_days"] is not None
        assert ml_pred["predicted_stockout_days"] <= 4
        assert ml_pred["projected_spoilage_units"] > 0

        cold_pred = preds[1]
        assert cold_pred["prediction_source"] == "rule_fallback"
        assert cold_pred["stockout_risk"] == "HIGH"
        assert "fallback" in cold_pred["explanation"].lower()
