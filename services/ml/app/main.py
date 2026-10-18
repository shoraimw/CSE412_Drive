"""DRIVE inference API, intended exclusively for IAM-protected Cloud Run.

Never deploy with --allow-unauthenticated. Firebase Functions authenticates
the end user and calls this service using its own Cloud Run Invoker identity.
"""
import logging
import os
import hashlib
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .features import FEATURE_NAMES, TripFeatures, vector

logger = logging.getLogger(__name__)
registry: dict = {}
MODELS = ("eta_minutes", "observed_fare_minor", "requests_next_hour")

@asynccontextmanager
async def lifespan(_: FastAPI):
    global registry
    path = Path(os.environ.get("DRIVE_MODEL_DIR", "/app/models"))
    registry = {}
    # joblib uses pickle. Load ONLY signed/controlled model artifacts from
    # your own CI pipeline, never user uploads or untrusted internet files.
    if path.is_dir() and (path / "manifest.json").exists():
        import json
        manifest = json.loads((path / "manifest.json").read_text())
        if manifest.get("feature_names") != list(FEATURE_NAMES):
            raise RuntimeError("ML feature schema mismatch")
        approved = manifest.get("production_approved") is True
        allow_experiment = os.environ.get("DRIVE_ALLOW_EXPERIMENTAL_MODELS") == "true"
        if not approved and not allow_experiment:
            logger.warning("Experimental model refused: set local test opt-in or review artifact")
        else:
            for name in MODELS:
                model_path = path / (name + ".joblib")
                expected = manifest.get("artifact_sha256", {}).get(name)
                if model_path.exists() and name in manifest.get("metrics", {}):
                    if not expected or hashlib.sha256(model_path.read_bytes()).hexdigest() != expected:
                        raise RuntimeError("ML artifact checksum mismatch")
                    registry[name] = joblib.load(model_path)
            registry["manifest"] = manifest
            logger.info("Loaded %d controlled ML model(s)", len(registry) - 1)
    else:
        logger.warning("No audited models present: predictions return 503")
    yield
    registry.clear()

app = FastAPI(
    title="DRIVE Private ML", version="0.1.0",
    docs_url=None, redoc_url=None, openapi_url=None,
    lifespan=lifespan,
)

class InferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    features: TripFeatures

class Prediction(BaseModel):
    model_name: str
    model_version: str
    estimate: float
    lower: float
    upper: float
    unit: str
    mae_test: float
    experimental: bool = True

@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "models_ready": all(name in registry for name in MODELS),
        "loaded": [name for name in MODELS if name in registry],
    }

def predict(name: str, features: TripFeatures, unit: str) -> Prediction:
    model = registry.get(name)
    if model is None:
        raise HTTPException(
            status_code=503,
            detail="ML model unavailable; use trusted non-ML baseline",
            headers={"Retry-After": "60"},
        )
    manifest = registry["manifest"]
    score = manifest["metrics"][name]
    mean = float(model.predict(np.array([vector(features)]))[0])
    if not np.isfinite(mean):
        raise HTTPException(503, "Model produced invalid output")
    lower_limit = 0 if name == "requests_next_hour" else (1 if name == "eta_minutes" else 0)
    value = max(lower_limit, mean)
    error = max(0.0, float(score["mae"]))
    return Prediction(
        model_name=name, model_version=str(manifest["version"]),
        estimate=round(value, 2),
        lower=round(max(lower_limit, value - error), 2),
        upper=round(value + error, 2),
        unit=unit,
        mae_test=round(error, 2),
    )

@app.post("/v1/predict/eta", response_model=Prediction)
async def eta(body: InferenceRequest):
    return predict("eta_minutes", body.features, "minutes")

@app.post("/v1/predict/fare", response_model=Prediction)
async def fare(body: InferenceRequest):
    # Advisory historical observed fare, NOT a binding fare. The signed server
    # pricing formula continues to control all payment and ride values.
    return predict("observed_fare_minor", body.features, "BDT_minor_advisory")

@app.post("/v1/predict/demand", response_model=Prediction)
async def demand(body: InferenceRequest):
    return predict("requests_next_hour", body.features, "requests_per_hour_cell")

@app.post("/v1/predict/all")
async def all_predictions(body: InferenceRequest):
    return {
        "eta": predict("eta_minutes", body.features, "minutes").model_dump(),
        "historical_fare": predict(
            "observed_fare_minor", body.features,
            "BDT_minor_advisory"
        ).model_dump(),
        "demand": predict(
            "requests_next_hour", body.features,
            "requests_per_hour_cell"
        ).model_dump(),
        "authoritative_fare": False,
    }


class AnomalyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route_distance_km: float = Field(ge=0.1, le=150)
    distance_from_route_m: float = Field(ge=0, le=10000)
    stopped_minutes: float = Field(ge=0, le=600)
    gps_age_seconds: float = Field(ge=0, le=3600)

@app.post("/v1/anomaly/route")
async def route_anomaly(body: AnomalyInput):
    reasons = []
    if body.distance_from_route_m > 350:
        reasons.append("route_deviation")
    if body.stopped_minutes > 12:
        reasons.append("long_stop")
    if body.gps_age_seconds > 90:
        reasons.append("stale_gps")
    return {
        "possible_anomaly": bool(reasons),
        "reasons": reasons,
        "source": "transparent_rule_based_baseline",
        "automated_emergency_contact": False,
        "human_review_required": True,
    }
