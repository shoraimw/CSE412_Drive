# DRIVE Phase 7 Private ML Service

Independent FastAPI inference service, designed for IAM-private Cloud Run in
asia-south1. Do not expose it with `--allow-unauthenticated`.

## Local development (Python 3.11+)

```powershell
cd CSE412_Drive\services\ml
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
pytest -q
uvicorn app.main:app --reload
```

The server starts WITHOUT a model. By default experimental artifacts
are NOT loaded even when mounted. For local development with models,
set DRIVE_ALLOW_EXPERIMENTAL_MODELS=true (never for live public traffic).
The model loader checks SHA-256 per artifact against the manifest and
loads only artifacts produced by the controlled training pipeline.
 /healthz returns models_ready=false,
and all model predictions return 503 until explicitly trained and provisioned.

## Historical data for training

Provide consented, de-identified, chronologically sorted CSV with columns
`distance_km,traffic_index,demand_index,hour_local,weekday,vehicle_type,
eta_minutes,observed_fare_minor,requests_next_hour`.

```powershell
python -m app.train --csv data\historical_trips.csv --out models --version candidate-001
```

Training writes non-production-approved manifest.json and three joblib
artifacts locally. Inspect temporal holdout MAE against median baseline, bias,
dataset provenance and consent BEFORE using those artifacts in a private
production deployment. Never load or deploy arbitrary user-provided joblib
files: joblib uses pickle and may run malicious code.

Model outputs are experimental advisory values. Payment and dispatch decisions
continue to use secure server rules until separately audited and enabled.

See `docs/PHASE_7_ML_SCALABILITY_SECURITY.md` for deployment.
