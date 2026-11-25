from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List
import uuid
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    f1_score,
    mean_absolute_error,
    precision_score,
    recall_score,
    root_mean_squared_error,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .features import (
    CLASSIFIER_FEATURES,
    FEATURE_COLUMNS,
    build_stockout_classification_frame,
    build_training_dataset,
)
from .synthetic_data import generate_synthetic_products

ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "artifacts"
BUNDLE_PATH = ARTIFACTS_DIR / "model_bundle.joblib"


def compute_mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    mask = y_true > 0
    if not np.any(mask):
        return 0.0
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100.0)


def train_and_evaluate(products: List[Dict] | None = None) -> Dict:
    """
    Trains Moving Average baseline, Ridge Regression, and Random Forest Regressor on a
    chronological 80/20 split, plus a Stockout Risk Classifier, and persists the best bundle.
    """
    source_products = products if products and any(p.get("sales_history") for p in products) else generate_synthetic_products()
    df, category_map = build_training_dataset(source_products)

    if len(df) < 30:
        source_products = generate_synthetic_products()
        df, category_map = build_training_dataset(source_products)

    # Strictly chronological split (no random shuffling on time series)
    split_idx = max(20, int(len(df) * 0.8))
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]
    if test_df.empty:
        test_df = train_df.tail(10)

    X_train = train_df[FEATURE_COLUMNS]
    y_train = train_df["units_sold"].values
    X_test = test_df[FEATURE_COLUMNS]
    y_test = test_df["units_sold"].values

    # 1. Baseline: 7-Day Rolling Mean
    baseline_pred = np.maximum(0.0, test_df["rolling_mean_7"].values)
    baseline_metrics = {
        "name": "MovingAverage7dBaseline",
        "mae": round(float(mean_absolute_error(y_test, baseline_pred)), 3),
        "rmse": round(float(root_mean_squared_error(y_test, baseline_pred)), 3),
        "mape": round(compute_mape(y_test, baseline_pred), 2),
    }

    # 2. Ridge Regression
    ridge_model = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("ridge", Ridge(alpha=2.0)),
        ]
    )
    ridge_model.fit(X_train, y_train)
    ridge_pred = np.maximum(0.0, ridge_model.predict(X_test))
    ridge_metrics = {
        "name": "RidgeRegression",
        "mae": round(float(mean_absolute_error(y_test, ridge_pred)), 3),
        "rmse": round(float(root_mean_squared_error(y_test, ridge_pred)), 3),
        "mape": round(compute_mape(y_test, ridge_pred), 2),
    }

    # 3. Random Forest Regressor (depth-constrained to prevent overfitting on store history)
    rf_model = RandomForestRegressor(
        n_estimators=80,
        max_depth=8,
        min_samples_leaf=3,
        random_state=42,
        n_jobs=-1,
    )
    rf_model.fit(X_train, y_train)
    rf_pred = np.maximum(0.0, rf_model.predict(X_test))
    rf_metrics = {
        "name": "RandomForestRegressor",
        "mae": round(float(mean_absolute_error(y_test, rf_pred)), 3),
        "rmse": round(float(root_mean_squared_error(y_test, rf_pred)), 3),
        "mape": round(compute_mape(y_test, rf_pred), 2),
    }

    # Select best ML model by holdout RMSE
    if rf_metrics["rmse"] <= ridge_metrics["rmse"]:
        best_demand_model = rf_model
        selected_demand_name = "RandomForestRegressor"
        selected_reg_metrics = rf_metrics
        residual_std = float(np.std(y_test - rf_pred))
        importances = rf_model.feature_importances_
    else:
        best_demand_model = ridge_model
        selected_demand_name = "RidgeRegression"
        selected_reg_metrics = ridge_metrics
        residual_std = float(np.std(y_test - ridge_pred))
        coefs = np.abs(ridge_model.named_steps["ridge"].coef_)
        importances = coefs / max(1e-9, coefs.sum())

    feature_importance = sorted(
        [
            {"feature": col, "importance": round(float(imp), 4)}
            for col, imp in zip(FEATURE_COLUMNS, importances)
        ],
        key=lambda x: x["importance"],
        reverse=True,
    )

    # 4. Stockout Risk Classifier
    clf_df = build_stockout_classification_frame(df)
    clf_split = max(20, int(len(clf_df) * 0.8))
    clf_train = clf_df.iloc[:clf_split]
    clf_test = clf_df.iloc[clf_split:]
    if clf_test.empty:
        clf_test = clf_train.tail(10)

    lr_clf = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(class_weight="balanced", max_iter=500, random_state=42)),
        ]
    )
    rf_clf = RandomForestClassifier(
        n_estimators=60,
        max_depth=6,
        class_weight="balanced",
        random_state=42,
    )

    lr_clf.fit(clf_train[CLASSIFIER_FEATURES], clf_train["stockout_label"])
    rf_clf.fit(clf_train[CLASSIFIER_FEATURES], clf_train["stockout_label"])

    lr_pred = lr_clf.predict(clf_test[CLASSIFIER_FEATURES])
    rf_clf_pred = rf_clf.predict(clf_test[CLASSIFIER_FEATURES])

    lr_f1 = float(f1_score(clf_test["stockout_label"], lr_pred, zero_division=0))
    rf_f1 = float(f1_score(clf_test["stockout_label"], rf_clf_pred, zero_division=0))

    if rf_f1 >= lr_f1:
        best_clf = rf_clf
        selected_clf_name = "RandomForestClassifier"
        chosen_pred = rf_clf_pred
    else:
        best_clf = lr_clf
        selected_clf_name = "LogisticRegression"
        chosen_pred = lr_pred

    clf_metrics = {
        "precision": round(
            float(precision_score(clf_test["stockout_label"], chosen_pred, zero_division=0)), 3
        ),
        "recall": round(
            float(recall_score(clf_test["stockout_label"], chosen_pred, zero_division=0)), 3
        ),
        "f1": round(float(f1_score(clf_test["stockout_label"], chosen_pred, zero_division=0)), 3),
    }

    run_id = f"run-{uuid.uuid4().hex[:10]}"
    trained_at = datetime.now(timezone.utc).isoformat()

    metadata = {
        "run_id": run_id,
        "selected_demand_algorithm": selected_demand_name,
        "selected_classifier_algorithm": selected_clf_name,
        "training_rows": int(len(train_df)),
        "trained_at": trained_at,
        "feature_importance": feature_importance,
        "metrics": {
            "regression": {
                "mae": selected_reg_metrics["mae"],
                "rmse": selected_reg_metrics["rmse"],
                "mape": selected_reg_metrics["mape"],
            },
            "baselineMovingAvg": {
                "mae": baseline_metrics["mae"],
                "rmse": baseline_metrics["rmse"],
                "mape": baseline_metrics["mape"],
            },
            "candidates": [baseline_metrics, ridge_metrics, rf_metrics],
            "classification": clf_metrics,
        },
    }

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    bundle = {
        "demand_model": best_demand_model,
        "stockout_classifier": best_clf,
        "category_map": category_map,
        "residual_std": max(0.5, residual_std),
        "metadata": metadata,
    }
    joblib.dump(bundle, BUNDLE_PATH)
    return bundle


def load_or_bootstrap_bundle() -> Dict:
    if BUNDLE_PATH.exists():
        return joblib.load(BUNDLE_PATH)
    return train_and_evaluate(None)
