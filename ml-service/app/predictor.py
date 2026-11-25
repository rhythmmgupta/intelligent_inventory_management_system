from datetime import date, timedelta
from typing import Dict, List, Optional
import numpy as np
import pandas as pd

from .features import CLASSIFIER_FEATURES, FEATURE_COLUMNS, encode_category
from .schemas import HorizonPoint, ProductPredictInput, ProductPrediction


def _simulate_fefo_stockout(
    batches: List[Dict],
    horizon_daily_demand: List[float],
    avg_daily_demand: float,
    today: date,
) -> tuple[Optional[int], float]:
    """
    Day-by-day FEFO forward simulation over 30 days.
    Batches whose expiry_date passes before demand consumes them become projected spoilage,
    ensuring expired stock never prevents a future stockout prediction.
    """
    sim_batches = []
    for b in batches:
        qty = float(b.remaining_quantity)
        if qty <= 0:
            continue
        exp = date.fromisoformat(b.expiry_date[:10])
        days_left = (exp - today).days
        if days_left >= 0:
            sim_batches.append({"remaining": qty, "days_left": days_left})

    sim_batches.sort(key=lambda x: x["days_left"])
    if not sim_batches:
        return 1, 0.0

    projected_spoilage = 0.0
    stockout_day: Optional[int] = None

    for day_idx in range(30):
        # Expire batches whose shelf life ended before this day
        for batch in sim_batches:
            if batch["days_left"] < day_idx and batch["remaining"] > 0:
                projected_spoilage += batch["remaining"]
                batch["remaining"] = 0.0

        demand = (
            horizon_daily_demand[day_idx]
            if day_idx < len(horizon_daily_demand)
            else avg_daily_demand
        )
        demand_left = demand
        for batch in sim_batches:
            if demand_left <= 0:
                break
            if batch["remaining"] <= 0:
                continue
            take = min(batch["remaining"], demand_left)
            batch["remaining"] -= take
            demand_left -= take

        surviving = sum(b["remaining"] for b in sim_batches)
        if surviving <= 0.01 and stockout_day is None:
            stockout_day = day_idx + 1
            break

    return stockout_day, round(projected_spoilage, 2)


def predict_for_product(
    item: ProductPredictInput,
    bundle: Dict,
    horizon_days: int = 7,
    target_cover_days: int = 10,
    safety_z_score: float = 1.28,
) -> ProductPrediction:
    today = date.today()
    history = sorted(item.sales_history, key=lambda x: x.date)

    # Cold-start guardrail (<14 days history -> honest rule fallback)
    if len(history) < 14:
        recent_vals = [p.units_sold for p in history[-7:]]
        avg_daily = float(np.mean(recent_vals)) if recent_vals else max(1.0, item.min_stock_threshold / 5.0)
        std_daily = float(np.std(recent_vals)) if len(recent_vals) > 1 else avg_daily * 0.25
        forecast_points = [
            HorizonPoint(
                date=(today + timedelta(days=i + 1)).isoformat(),
                predicted_units=round(avg_daily, 2),
                lower_bound=round(max(0.0, avg_daily - safety_z_score * std_daily), 2),
                upper_bound=round(avg_daily + safety_z_score * std_daily, 2),
            )
            for i in range(horizon_days)
        ]
        stockout_days, spoilage = _simulate_fefo_stockout(
            item.batches, [p.predicted_units for p in forecast_points], avg_daily, today
        )
        safety_stock = safety_z_score * std_daily * np.sqrt(item.lead_time_days)
        rop = int(np.ceil(avg_daily * item.lead_time_days + safety_stock))
        needs_reorder = item.active_usable_quantity <= rop or (
            stockout_days is not None and stockout_days <= item.lead_time_days + 3
        )
        rec_qty = (
            max(1, int(np.ceil(avg_daily * target_cover_days + safety_stock - item.active_usable_quantity)))
            if needs_reorder
            else 0
        )
        risk = (
            "HIGH"
            if item.active_usable_quantity <= 0
            or (stockout_days is not None and stockout_days <= item.lead_time_days + 2)
            else "MEDIUM"
            if item.active_usable_quantity <= rop
            else "LOW"
        )
        return ProductPrediction(
            product_id=item.product_id,
            sku=item.sku,
            name=item.name,
            predicted_daily_demand=round(avg_daily, 2),
            predicted_7day_demand=round(avg_daily * 7.0, 2),
            demand_std_dev=round(std_daily, 2),
            predicted_stockout_days=stockout_days,
            projected_spoilage_units=spoilage,
            stockout_risk=risk,
            stockout_probability=0.85 if risk == "HIGH" else 0.5 if risk == "MEDIUM" else 0.15,
            recommended_reorder_point=rop,
            recommended_reorder_quantity=rec_qty,
            prediction_source="rule_fallback",
            model_used="MovingAverageFallback",
            explanation=f"Rule-based fallback used because SKU has only {len(history)} day(s) of sales history (<14 required for ML).",
            forecast_horizon=forecast_points,
        )

    # Full ML recursive multi-step forecast
    demand_model = bundle["demand_model"]
    stockout_clf = bundle["stockout_classifier"]
    category_map = dict(bundle.get("category_map", {}))
    residual_std = float(bundle.get("residual_std", 1.5))
    model_name = bundle["metadata"]["selected_demand_algorithm"]

    series = [float(p.units_sold) for p in history[-30:]]
    recent_7 = float(np.mean(series[-7:]))
    recent_14 = float(np.mean(series[-14:]))
    std_7 = float(np.std(series[-7:]))
    cat_code = encode_category(item.category, category_map)

    forecast_points: List[HorizonPoint] = []
    working_series = list(series)

    for step in range(1, horizon_days + 1):
        target_date = today + timedelta(days=step)
        dow = target_date.weekday()
        is_weekend = 1 if dow >= 4 else 0

        row = pd.DataFrame(
            [
                {
                    "day_of_week": dow,
                    "is_weekend": is_weekend,
                    "month": target_date.month,
                    "lag_1": working_series[-1],
                    "lag_7": working_series[-7] if len(working_series) >= 7 else recent_7,
                    "rolling_mean_7": float(np.mean(working_series[-7:])),
                    "rolling_mean_14": float(np.mean(working_series[-14:])),
                    "rolling_std_7": float(np.std(working_series[-7:])),
                    "was_discounted": 0,
                    "unit_price": item.selling_price,
                    "category_code": cat_code,
                }
            ]
        )[FEATURE_COLUMNS]

        pred_val = max(0.2, float(demand_model.predict(row)[0]))
        working_series.append(pred_val)
        forecast_points.append(
            HorizonPoint(
                date=target_date.isoformat(),
                predicted_units=round(pred_val, 2),
                lower_bound=round(max(0.0, pred_val - safety_z_score * residual_std), 2),
                upper_bound=round(pred_val + safety_z_score * residual_std, 2),
            )
        )

    daily_preds = [pt.predicted_units for pt in forecast_points]
    avg_pred_daily = float(np.mean(daily_preds))
    sum_7day = float(np.sum(daily_preds[:7]))

    stockout_days, projected_spoilage = _simulate_fefo_stockout(
        item.batches, daily_preds, avg_pred_daily, today
    )

    # Stockout classifier probability
    expected_lead_demand = max(1.0, avg_pred_daily * item.lead_time_days)
    clf_input = pd.DataFrame(
        [
            {
                "stock_ratio": item.active_usable_quantity / expected_lead_demand,
                "days_of_cover": item.active_usable_quantity / max(0.5, avg_pred_daily),
                "rolling_mean_7": recent_7,
                "rolling_std_7": std_7,
                "lead_time_days": item.lead_time_days,
                "is_weekend": 1 if (today + timedelta(days=1)).weekday() >= 4 else 0,
            }
        ]
    )[CLASSIFIER_FEATURES]

    clf_prob = float(stockout_clf.predict_proba(clf_input)[0][1])

    effective_std = max(std_7, residual_std * 0.5)
    safety_stock = safety_z_score * effective_std * np.sqrt(item.lead_time_days)
    rop = int(np.ceil(avg_pred_daily * item.lead_time_days + safety_stock))

    if item.active_usable_quantity <= 0 or (
        stockout_days is not None and stockout_days <= item.lead_time_days + 2
    ):
        risk_tier = "HIGH"
    elif item.active_usable_quantity <= rop or clf_prob >= 0.55:
        risk_tier = "MEDIUM"
    else:
        risk_tier = "LOW"

    needs_reorder = item.active_usable_quantity <= rop or risk_tier == "HIGH"
    rec_qty = (
        max(
            1,
            int(np.ceil(avg_pred_daily * target_cover_days + safety_stock - item.active_usable_quantity)),
        )
        if needs_reorder
        else 0
    )

    trend_pct = ((avg_pred_daily - recent_14) / max(0.5, recent_14)) * 100.0
    trend_phrase = (
        f"trending {abs(trend_pct):.0f}% {'above' if trend_pct >= 0 else 'below'} 14-day baseline"
    )
    spoilage_note = (
        f" Expiry simulation warns {projected_spoilage:.1f} units may expire before sale."
        if projected_spoilage > 0
        else ""
    )
    stockout_note = (
        f" Active stock projected to deplete in {stockout_days} day(s) under FEFO."
        if stockout_days is not None
        else " Stock covers the next 30 days."
    )

    explanation = (
        f"{model_name} forecasts {avg_pred_daily:.1f} units/day (7d avg: {recent_7:.1f}, {trend_phrase})."
        f"{stockout_note}{spoilage_note}"
    )

    return ProductPrediction(
        product_id=item.product_id,
        sku=item.sku,
        name=item.name,
        predicted_daily_demand=round(avg_pred_daily, 2),
        predicted_7day_demand=round(sum_7day, 2),
        demand_std_dev=round(effective_std, 2),
        predicted_stockout_days=stockout_days,
        projected_spoilage_units=projected_spoilage,
        stockout_risk=risk_tier,
        stockout_probability=round(clf_prob, 3),
        recommended_reorder_point=rop,
        recommended_reorder_quantity=rec_qty,
        prediction_source="ml_model",
        model_used=model_name,
        explanation=explanation,
        forecast_horizon=forecast_points,
    )
