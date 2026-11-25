from typing import List, Optional
from pydantic import BaseModel, Field


class SalesPoint(BaseModel):
    date: str
    units_sold: float = Field(..., ge=0)
    unit_price: float = Field(default=0.0, ge=0)
    was_discounted: int = Field(default=0, ge=0, le=1)


class ActiveBatchInput(BaseModel):
    remaining_quantity: float = Field(..., ge=0)
    expiry_date: str


class ProductTrainInput(BaseModel):
    product_id: str
    sku: str
    name: str
    category: str
    selling_price: float = Field(default=3.0, ge=0)
    lead_time_days: int = Field(default=3, ge=1)
    min_stock_threshold: float = Field(default=10.0, ge=0)
    sales_history: List[SalesPoint] = Field(default_factory=list)


class TrainRequest(BaseModel):
    products: List[ProductTrainInput] = Field(default_factory=list)


class ProductPredictInput(BaseModel):
    product_id: str
    sku: str
    name: str
    category: str
    selling_price: float = Field(default=3.0, ge=0)
    lead_time_days: int = Field(default=3, ge=1)
    min_stock_threshold: float = Field(default=10.0, ge=0)
    active_usable_quantity: float = Field(default=0.0, ge=0)
    batches: List[ActiveBatchInput] = Field(default_factory=list)
    sales_history: List[SalesPoint] = Field(default_factory=list)


class StockoutPredictRequest(BaseModel):
    horizon_days: int = Field(default=7, ge=1, le=30)
    target_cover_days: int = Field(default=10, ge=1, le=60)
    safety_z_score: float = Field(default=1.28, ge=0.5, le=3.0)
    products: List[ProductPredictInput]


class HorizonPoint(BaseModel):
    date: str
    predicted_units: float
    lower_bound: float
    upper_bound: float


class ProductPrediction(BaseModel):
    product_id: str
    sku: str
    name: str
    predicted_daily_demand: float
    predicted_7day_demand: float
    demand_std_dev: float
    predicted_stockout_days: Optional[int]
    projected_spoilage_units: float
    stockout_risk: str
    stockout_probability: float
    recommended_reorder_point: int
    recommended_reorder_quantity: int
    prediction_source: str
    model_used: str
    explanation: str
    forecast_horizon: List[HorizonPoint]


class StockoutPredictResponse(BaseModel):
    predictions: List[ProductPrediction]
