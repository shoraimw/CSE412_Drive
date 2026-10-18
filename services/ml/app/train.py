"""Train transparent baseline models on consented, de-identified trip CSV.

Usage:
python -m app.train --csv data/historical_trips.csv --out models --version experiment-001

CSV numeric columns:
distance_km,traffic_index,demand_index,hour_local,weekday,vehicle_type,
eta_minutes,observed_fare_minor,requests_next_hour

Do not train on user IDs, exact GPS, phone numbers, rider identities, or
unconsented personal data. Output .joblib must be treated as trusted code.
"""
import argparse
import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

from .features import FEATURE_NAMES, TripFeatures, vector
from .main import MODELS

def train(csv: Path, out: Path, version: str) -> dict:
    if not version or len(version) > 80 or not all(c.isalnum() or c in "_-" for c in version):
        raise ValueError("version must be 1–80 ASCII alphanumeric, underscore or hyphen")
    df = pd.read_csv(csv)
    cols = ["distance_km","traffic_index","demand_index","hour_local",
            "weekday","vehicle_type", *MODELS]
    if any(name not in df.columns for name in cols):
        raise ValueError("Missing one or more required columns: " + ", ".join(cols))
    if len(df) < 150:
        raise ValueError("Use at least 150 real, de-identified historical examples")
    records = []
    for item in df[cols].to_dict("records"):
        f = TripFeatures.model_validate({
            k: item[k] for k in cols[:6]
        })
        outputs = [float(item[t]) for t in MODELS]
        if any(not np.isfinite(v) or v < 0 for v in outputs):
            raise ValueError("Target values must be finite, nonnegative")
        records.append((vector(f), outputs))
    X = np.asarray([record[0] for record in records])
    Y = np.asarray([record[1] for record in records])
    # Time-aware split when data includes ordered trips. The input CSV should
    # be sorted chronologically oldest→newest; never shuffle future into past.
    split = int(len(X) * 0.8)
    X_train, X_test = X[:split], X[split:]
    Y_train, Y_test = Y[:split], Y[split:]
    metrics = {}
    artifact_sha256 = {}
    # Train all models and evaluate against a trivial mean-only baseline.
    # Models are NOT deployed by this script.
    out.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(MODELS):
        model = HistGradientBoostingRegressor(max_iter=90, max_leaf_nodes=15,
            min_samples_leaf=12, l2_regularization=2, random_state=42)
        model.fit(X_train, Y_train[:, i])
        baseline = DummyRegressor(strategy="median")
        baseline.fit(X_train, Y_train[:, i])
        mae = mean_absolute_error(Y_test[:, i], model.predict(X_test))
        baseline_mae = mean_absolute_error(Y_test[:, i], baseline.predict(X_test))
        metrics[name] = {
            "mae": float(mae), "baseline_mae": float(baseline_mae),
            "beats_baseline": bool(mae < baseline_mae),
        }
        output = out / f"{name}.joblib"
        joblib.dump(model, output)
        artifact_sha256[name] = hashlib.sha256(output.read_bytes()).hexdigest()
    manifest = {
        "version": version,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "feature_names": list(FEATURE_NAMES),
        "train_rows": len(X_train), "test_rows": len(X_test),
        "training_method": "temporal_holdout_80_20",
        "metrics": metrics,
        "artifact_sha256": artifact_sha256,
        "production_approved": False,
        "note": "Experimental; only deploy after human data/metric review.",
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest

if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("--csv", type=Path, required=True)
    cli.add_argument("--out", type=Path, default=Path("models"))
    cli.add_argument("--version", type=str, required=True)
    args = cli.parse_args()
    print(json.dumps(train(args.csv, args.out, args.version), indent=2))
