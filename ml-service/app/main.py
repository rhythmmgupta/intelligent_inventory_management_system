from contextlib import asynccontextmanager
from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from .predictor import predict_for_product
from .schemas import StockoutPredictRequest, StockoutPredictResponse, TrainRequest
from .trainer import load_or_bootstrap_bundle, train_and_evaluate

MODEL_STATE = {"bundle": None}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    MODEL_STATE["bundle"] = load_or_bootstrap_bundle()
    yield


app = FastAPI(
    title="FreshGuard ML Demand & Stockout Service",
    version="1.0.0",
    lifespan=lifespan,
)

Instrumentator().instrument(app).expose(app, endpoint="/metrics")


def get_bundle():
    if MODEL_STATE["bundle"] is None:
        MODEL_STATE["bundle"] = load_or_bootstrap_bundle()
    return MODEL_STATE["bundle"]


@app.get("/health")
def health():
    bundle = get_bundle()
    return {
        "status": "ok",
        "service": "freshguard-ml",
        "model_loaded": bundle is not None,
        "selected_demand_algorithm": bundle["metadata"]["selected_demand_algorithm"],
    }


@app.get("/metrics/model")
def model_metrics():
    bundle = get_bundle()
    return bundle["metadata"]


@app.post("/train")
def train_models(req: TrainRequest):
    raw_products = [p.model_dump() for p in req.products]
    bundle = train_and_evaluate(raw_products)
    MODEL_STATE["bundle"] = bundle
    return bundle["metadata"]


@app.post("/predict/stockout-risk", response_model=StockoutPredictResponse)
def predict_stockout_risk(req: StockoutPredictRequest):
    bundle = get_bundle()
    predictions = [
        predict_for_product(
            item=prod,
            bundle=bundle,
            horizon_days=req.horizon_days,
            target_cover_days=req.target_cover_days,
            safety_z_score=req.safety_z_score,
        )
        for prod in req.products
    ]
    return StockoutPredictResponse(predictions=predictions)
