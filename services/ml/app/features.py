"""Feature contract is shared by training and inference (no PII)."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

VEHICLES = ("bike", "car", "premium")
FEATURE_NAMES = (
    "distance_km", "traffic_index", "demand_index",
    "hour_local", "weekday", "bike", "car", "premium"
)

class TripFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    distance_km: float = Field(ge=0.1, le=150)
    traffic_index: float = Field(ge=0, le=2)
    demand_index: float = Field(ge=0, le=2)
    hour_local: int = Field(ge=0, le=23)
    weekday: int = Field(ge=0, le=6)
    vehicle_type: Literal["bike", "car", "premium"]

def vector(row: TripFeatures) -> list[float]:
    return [
        row.distance_km, row.traffic_index, row.demand_index,
        float(row.hour_local), float(row.weekday),
        *[float(row.vehicle_type == key) for key in VEHICLES],
    ]
