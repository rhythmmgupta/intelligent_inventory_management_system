from typing import Dict, List, Tuple
import numpy as np
import pandas as pd


FEATURE_COLUMNS = [
    "day_of_week",
    "is_weekend",
    "month",
    "lag_1",
    "lag_7",
    "rolling_mean_7",
    "rolling_mean_14",
    "rolling_std_7",
    "was_discounted",
    "unit_price",
    "category_code",
]

CLASSIFIER_FEATURES = [
    "stock_ratio",
    "days_of_cover",
    "rolling_mean_7",
    "rolling_std_7",
    "lead_time_days",
    "is_weekend",
]


def encode_category(category: str, category_map: Dict[str, int]) -> int:
    key = (category or "General").strip().lower()
    if key not in category_map:
        category_map[key] = len(category_map) + 1
    return category_map[key]


def build_product_frame(
    product: Dict, category_map: Dict[str, int]
) -> pd.DataFrame:
    """
    Converts a single product's sales history into sorted daily rows with leak-free
    lag and rolling window features (shifted by 1 day so today's target never leaks).
    """
    history = product.get("sales_history") or []
    if not history:
        return pd.DataFrame()

    df = pd.DataFrame(history)
    df["date"] = pd.to_datetime(df["date"])
    df = (
        df.groupby("date", as_index=False)
        .agg(
            units_sold=("units_sold", "sum"),
            unit_price=("unit_price", "mean"),
            was_discounted=("was_discounted", "max"),
        )
        .sort_values("date")
    )

    # Reindex across continuous calendar dates so missing zero-sale days are represented
    full_idx = pd.date_range(df["date"].min(), df["date"].max(), freq="D")
    df = df.set_index("date").reindex(full_idx)
    df.index.name = "date"
    df["units_sold"] = df["units_sold"].fillna(0.0)
    df["was_discounted"] = df["was_discounted"].fillna(0).astype(int)
    default_price = float(product.get("selling_price") or 3.0)
    df["unit_price"] = df["unit_price"].ffill().bfill().fillna(default_price)
    df = df.reset_index()

    df["product_id"] = product["product_id"]
    df["lead_time_days"] = int(product.get("lead_time_days") or 3)
    df["category_code"] = encode_category(product.get("category", "General"), category_map)
    df["day_of_week"] = df["date"].dt.day_of_week
    df["is_weekend"] = (df["day_of_week"] >= 4).astype(int)
    df["month"] = df["date"].dt.month

    shifted = df["units_sold"].shift(1)
    df["lag_1"] = shifted
    df["lag_7"] = df["units_sold"].shift(7)
    df["rolling_mean_7"] = shifted.rolling(window=7, min_periods=3).mean()
    df["rolling_mean_14"] = shifted.rolling(window=14, min_periods=5).mean()
    df["rolling_std_7"] = shifted.rolling(window=7, min_periods=3).std().fillna(0.0)

    # Compute future lead-time cumulative demand strictly for classifier labeling during training
    lead = max(1, int(product.get("lead_time_days") or 3))
    future_sum = pd.Series(0.0, index=df.index)
    for step in range(lead):
        future_sum = future_sum + df["units_sold"].shift(-step)
    df["future_lead_demand"] = future_sum

    df = df.dropna(subset=["lag_1", "lag_7", "rolling_mean_7", "rolling_mean_14"]).copy()
    return df


def build_training_dataset(
    products: List[Dict],
) -> Tuple[pd.DataFrame, Dict[str, int]]:
    category_map: Dict[str, int] = {}
    frames = []
    for product in products:
        frame = build_product_frame(product, category_map)
        if not frame.empty:
            frames.append(frame)

    if not frames:
        return pd.DataFrame(), category_map

    combined = pd.concat(frames, ignore_index=True).sort_values("date").reset_index(drop=True)
    return combined, category_map


def build_stockout_classification_frame(df: pd.DataFrame) -> pd.DataFrame:
    """
    Constructs labeled sliding-window stock states for evaluating stockout Precision/Recall/F1.
    Simulates varying on-hand stock ratios relative to expected lead-time demand.
    """
    rng = np.random.default_rng(99)
    valid = df.dropna(subset=["future_lead_demand"]).copy()
    if valid.empty:
        return pd.DataFrame()

    expected_lead = np.maximum(1.0, valid["rolling_mean_7"] * valid["lead_time_days"])
    simulated_stock = expected_lead * rng.uniform(0.35, 2.2, size=len(valid))

    clf_df = pd.DataFrame(
        {
            "date": valid["date"].values,
            "stock_ratio": simulated_stock / expected_lead,
            "days_of_cover": simulated_stock / np.maximum(0.5, valid["rolling_mean_7"]),
            "rolling_mean_7": valid["rolling_mean_7"].values,
            "rolling_std_7": valid["rolling_std_7"].values,
            "lead_time_days": valid["lead_time_days"].values,
            "is_weekend": valid["is_weekend"].values,
            "stockout_label": (valid["future_lead_demand"].values >= simulated_stock).astype(int),
        }
    )
    return clf_df
