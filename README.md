# ShuttleIQ — Smart Shuttle Bus Management System
> CSIT305 POC · Random Forest vs Baseline · Flask + Synthetic Data

## Quick start (local)

```bash
pip install -r requirements.txt

# 1. Generate synthetic dataset
python generate_data.py

# 2. Train models (saves to /models/)
python train_model.py

# 3. Run the app
python app.py
# → http://localhost:5000
```

## Project structure

```
shuttle-bus/
├── app.py                  # Flask backend + REST API
├── generate_data.py        # Synthetic dataset generator
├── train_model.py          # Model training + evaluation
├── requirements.txt
├── Procfile                # Gunicorn for deployment
├── render.yaml             # One-click Render deploy config
├── data/
│   └── shuttle_data.csv    # Generated after step 1
├── models/
│   ├── rf_occupancy.pkl    # Trained Random Forest (occupancy)
│   ├── rf_travel_time.pkl  # Trained Random Forest (ETA)
│   ├── label_encoder.pkl   # Route label encoder
│   ├── metrics.json        # MAE comparison results
│   ├── baseline_occupancy.csv
│   └── baseline_travel_time.csv
├── templates/
│   └── index.html          # Dashboard UI
└── static/
    ├── css/style.css
    └── js/app.js
```

## API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/predict?route=...&hour=8&day=0` | Single prediction |
| `GET /api/schedule?route=...&day=0` | Hourly forecast (for chart) |
| `GET /api/all_routes` | Current snapshot of all routes |
| `GET /api/metrics` | Model evaluation metrics |
| `GET /api/simulate_gps_failure?route=...` | Edge-case GPS test |

## Deploy to Render (free tier)

1. Push repo to GitHub
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` — click **Deploy**

> ⚠️ **Vercel note:** Vercel doesn't support persistent Python processes.
> Use Render, Railway, or Fly.io for this Flask app.
> If you need Vercel specifically, the app can be rewritten as Next.js + Python serverless functions.

## What it predicts

- **Passenger occupancy** — how many passengers will be on the bus
- **Available seats** — capacity minus predicted occupancy  
- **ETA / travel time** — predicted journey duration in minutes
- **Peak-hour detection** — flags 07–09, 12–13, 16–18
- **Extra bus recommendation** — when occupancy ≥ 80% during peak hours
- **GPS failure handling** — warns users when location data is stale

## Models

| Model | Occupancy MAE | ETA MAE |
|---|---|---|
| Random Forest | see metrics.json | see metrics.json |
| Historical Baseline | see metrics.json | see metrics.json |

Both models are compared head-to-head on a chronological 80/20 train/test split.
