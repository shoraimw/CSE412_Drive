import json
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.main import app
from app.train import train

def test_training_records_holdout_metrics_and_predictions(tmp_path, monkeypatch):
    # Synthetic records are TEST FIXTURES only: production training requires
    # consented, de-identified, chronologically sorted observations.
    rng = np.random.default_rng(42)
    rows = []
    for i in range(200):
        km = 1 + i * 0.2
        traffic = 0.5 + float(rng.uniform(0, 1.4))
        demand = float(rng.uniform(0, 2))
        kind = ["car", "bike", "premium"][i % 3]
        rows.append({
            "distance_km": km, "traffic_index": traffic, "demand_index": demand,
            "hour_local": i % 24, "weekday": i % 7,
            "vehicle_type": kind,
            "eta_minutes": 5 + km * 2 + traffic * 8,
            "observed_fare_minor": 6000 + km * 1600 + 200 * traffic,
            "requests_next_hour": 15 + demand * 4 + 0.5 * traffic,
        })
    csv = tmp_path / "data.csv"
    pd.DataFrame(rows).to_csv(csv, index=False)
    out = tmp_path / "models"
    manifest = train(csv, out, "test-001")
    assert manifest["train_rows"] == 160
    assert manifest["test_rows"] == 40
    assert manifest["production_approved"] is False
    assert all("mae" in manifest["metrics"][name] for name in
               ("eta_minutes", "observed_fare_minor", "requests_next_hour"))
    monkeypatch.setenv("DRIVE_MODEL_DIR", str(out))
    with TestClient(app) as client:
        result = client.post("/v1/predict/eta", json={"features": {
            "distance_km": 8.0, "traffic_index": 1.0,
            "demand_index": 1.1, "hour_local": 11, "weekday": 3,
            "vehicle_type": "car",
        }})
        assert result.status_code == 200
        body = result.json()
        assert body["model_version"] == "test-001"
        assert body["estimate"] > 0 and body["lower"] <= body["estimate"] <= body["upper"]
        assert body["experimental"] is True
