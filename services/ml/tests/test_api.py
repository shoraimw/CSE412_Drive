import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.features import TripFeatures, vector
from app.main import app
from app.train import train

EXAMPLE = {
    "distance_km": 7.4, "traffic_index": 1.15,
    "demand_index": 0.9, "hour_local": 18,
    "weekday": 2, "vehicle_type": "car",
}

def test_feature_contract_and_one_hot():
    row = TripFeatures(**EXAMPLE)
    assert vector(row)[-3:] == [0.0, 1.0, 0.0]
    with pytest.raises(ValidationError):
        TripFeatures(**{**EXAMPLE, "distance_km": -1})
    with pytest.raises(ValidationError):
        TripFeatures(**{**EXAMPLE, "rider_id": "secret"})

def test_no_trained_model_never_fakes_ml_prediction(monkeypatch, tmp_path):
    monkeypatch.setenv("DRIVE_MODEL_DIR", str(tmp_path))
    with TestClient(app) as client:
        health = client.get("/healthz")
        assert health.status_code == 200
        assert health.json()["models_ready"] is False
        for path in ("eta", "fare", "demand"):
            result = client.post("/v1/predict/" + path, json={"features": EXAMPLE})
            assert result.status_code == 503
            assert "unavailable" in result.json()["detail"]

def test_anomaly_baseline_never_claims_alert_delivery(monkeypatch, tmp_path):
    monkeypatch.setenv("DRIVE_MODEL_DIR", str(tmp_path))
    with TestClient(app) as client:
        answer = client.post("/v1/anomaly/route", json={
            "route_distance_km": 7.4,
            "distance_from_route_m": 500,
            "stopped_minutes": 15,
            "gps_age_seconds": 4,
        })
        assert answer.status_code == 200
        body = answer.json()
        assert body["reasons"] == ["route_deviation", "long_stop"]
        assert body["automated_emergency_contact"] is False

def test_training_rejects_small_or_bad_data(tmp_path):
    path = tmp_path / "too_small.csv"
    path.write_text(
      "distance_km,traffic_index,demand_index,hour_local,weekday,"
      "vehicle_type,eta_minutes,observed_fare_minor,requests_next_hour\n"
      + "4,1,1,12,1,car,17,15000,20\n"
    )
    with pytest.raises(ValueError, match="150"):
        train(path, tmp_path / "out", "v1")
