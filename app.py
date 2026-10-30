"""
app.py  —  Smart Shuttle Bus Management System
Flask backend serving predictions and dashboard data.
"""

from flask import Flask, render_template, jsonify, request
import joblib
import json
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import os

app = Flask(__name__)

# ── Load models & metadata ────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(__file__)

def load_assets():
    rf_occ  = joblib.load(os.path.join(BASE_DIR, "models/rf_occupancy.pkl"))
    rf_tt   = joblib.load(os.path.join(BASE_DIR, "models/rf_travel_time.pkl"))
    le      = joblib.load(os.path.join(BASE_DIR, "models/label_encoder.pkl"))
    with open(os.path.join(BASE_DIR, "models/metrics.json")) as f:
        metrics = json.load(f)
    base_occ = pd.read_csv(os.path.join(BASE_DIR, "models/baseline_occupancy.csv"))
    base_tt  = pd.read_csv(os.path.join(BASE_DIR, "models/baseline_travel_time.csv"))
    return rf_occ, rf_tt, le, metrics, base_occ, base_tt

try:
    rf_occ, rf_tt, le, METRICS, base_occ_df, base_tt_df = load_assets()
    MODELS_LOADED = True
except Exception as e:
    print(f"⚠️  Models not loaded: {e}. Run generate_data.py + train_model.py first.")
    MODELS_LOADED = False
    METRICS = {}

BUS_CAPACITY = 40
ROUTES = ["Campus → Mall", "Mall → Campus", "Campus → Metro", "Metro → Campus"]

ROUTE_STOPS = {
    "Campus → Mall":    ["Campus Gate", "Block A", "Sports Complex", "City Mall"],
    "Mall → Campus":    ["City Mall", "Sports Complex", "Block A", "Campus Gate"],
    "Campus → Metro":   ["Campus Gate", "Library", "Hostel", "Metro Station"],
    "Metro → Campus":   ["Metro Station", "Hostel", "Library", "Campus Gate"],
}


def encode_route(route_name):
    try:
        return int(le.transform([route_name])[0])
    except Exception:
        return 0


def get_prediction(hour, day_of_week, is_weekend, route_name):
    """Return RF prediction dict for a given context."""
    if not MODELS_LOADED:
        return None

    route_enc = encode_route(route_name)
    X = np.array([[hour, day_of_week, is_weekend, route_enc]])

    occ_pred = float(rf_occ.predict(X)[0])
    tt_pred  = float(rf_tt.predict(X)[0])

    occ_pred = max(0, min(BUS_CAPACITY, round(occ_pred)))
    tt_pred  = max(1, round(tt_pred, 1))

    available = BUS_CAPACITY - occ_pred
    occupancy_pct = (occ_pred / BUS_CAPACITY) * 100

    # Crowding label
    if occupancy_pct >= 90:
        crowd = "Full"
        crowd_class = "danger"
    elif occupancy_pct >= 70:
        crowd = "Busy"
        crowd_class = "warning"
    elif occupancy_pct >= 40:
        crowd = "Moderate"
        crowd_class = "moderate"
    else:
        crowd = "Available"
        crowd_class = "success"

    # Baseline comparison
    row_occ = base_occ_df[(base_occ_df["hour"] == hour) & (base_occ_df["route"] == route_name)]
    row_tt  = base_tt_df[(base_tt_df["hour"] == hour) & (base_tt_df["route"] == route_name)]
    base_occ = float(row_occ["occupancy"].values[0]) if len(row_occ) else occ_pred
    base_tt  = float(row_tt["travel_time_min"].values[0]) if len(row_tt) else tt_pred

    # Peak detection
    is_peak = hour in [7, 8, 9, 12, 13, 16, 17, 18]

    # Additional bus recommendation
    recommend_extra = occupancy_pct >= 80 and is_peak

    return {
        "occupancy":        occ_pred,
        "available_seats":  available,
        "occupancy_pct":    round(occupancy_pct, 1),
        "travel_time_min":  tt_pred,
        "crowd_label":      crowd,
        "crowd_class":      crowd_class,
        "is_peak":          is_peak,
        "recommend_extra":  recommend_extra,
        "baseline_occ":     round(base_occ, 1),
        "baseline_tt":      round(base_tt, 1),
        "eta_minutes":      tt_pred,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", routes=ROUTES, metrics=METRICS)


@app.route("/api/predict", methods=["GET"])
def predict():
    """
    GET /api/predict?route=Campus → Mall&hour=8&day=0
    Returns prediction JSON.
    """
    route = request.args.get("route", ROUTES[0])
    now   = datetime.now()
    hour  = int(request.args.get("hour", now.hour))
    day   = int(request.args.get("day",  now.weekday()))
    is_weekend = int(day >= 5)

    if route not in ROUTES:
        return jsonify({"error": "Invalid route"}), 400

    pred = get_prediction(hour, day, is_weekend, route)
    if pred is None:
        return jsonify({"error": "Models not loaded. Run generate_data.py and train_model.py first."}), 503

    # GPS failure simulation
    gps_ok = request.args.get("gps_ok", "1") == "1"
    pred["gps_ok"] = gps_ok
    if not gps_ok:
        pred["gps_warning"] = "GPS signal lost — arrival time estimate may be unreliable."

    pred["route"]  = route
    pred["hour"]   = hour
    pred["stops"]  = ROUTE_STOPS.get(route, [])
    pred["timestamp"] = now.strftime("%H:%M:%S")
    return jsonify(pred)


@app.route("/api/schedule", methods=["GET"])
def schedule():
    """
    Returns hourly demand forecast for a given route across the day.
    Used for the demand chart on the dashboard.
    """
    route = request.args.get("route", ROUTES[0])
    day   = int(request.args.get("day", datetime.now().weekday()))
    is_weekend = int(day >= 5)

    if not MODELS_LOADED:
        return jsonify({"error": "Models not loaded"}), 503

    hours = list(range(6, 23))
    data  = []
    for h in hours:
        p = get_prediction(h, day, is_weekend, route)
        data.append({
            "hour":           h,
            "label":          f"{h:02d}:00",
            "occupancy":      p["occupancy"],
            "occupancy_pct":  p["occupancy_pct"],
            "travel_time":    p["travel_time_min"],
            "is_peak":        p["is_peak"],
            "recommend_extra":p["recommend_extra"],
        })

    return jsonify({"route": route, "day": day, "forecast": data})


@app.route("/api/all_routes", methods=["GET"])
def all_routes():
    """Snapshot of current predictions for all routes (live dashboard panel)."""
    now  = datetime.now()
    hour = now.hour
    day  = now.weekday()
    is_weekend = int(day >= 5)

    if not MODELS_LOADED:
        return jsonify({"error": "Models not loaded"}), 503

    results = []
    for r in ROUTES:
        p = get_prediction(hour, day, is_weekend, r)
        p["route"] = r
        results.append(p)

    return jsonify({"timestamp": now.strftime("%H:%M:%S"), "routes": results})


@app.route("/api/metrics")
def metrics():
    return jsonify(METRICS)


@app.route("/api/simulate_gps_failure")
def simulate_gps_failure():
    """Edge-case test endpoint — simulates GPS dropout."""
    route = request.args.get("route", ROUTES[0])
    now   = datetime.now()
    pred  = get_prediction(now.hour, now.weekday(), int(now.weekday() >= 5), route)
    pred["gps_ok"]      = False
    pred["gps_warning"] = "GPS signal lost — arrival time estimate may be unreliable. Showing last-known prediction."
    pred["route"]       = route
    return jsonify(pred)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
