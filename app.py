"""
app.py  —  Smart Shuttle Bus Management System
Flask backend serving predictions, dashboard data and the employee dispatch portal.
"""

from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from functools import wraps
import joblib
import json
import math
import uuid
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import os

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-change-me")
EMPLOYEE_PIN   = os.environ.get("EMPLOYEE_PIN", "1234")   # set a real one on Render
DISPATCHES     = []   # in-memory log (resets on restart; use ONE gunicorn worker)

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

BUS_CAPACITY = 27  # Optare Solo actual capacity
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


# ── Customer routes ───────────────────────────────────────────────────────────

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


@app.route("/api/dispatches_public")
def dispatches_public():
    """Public read-only endpoint — returns active/scheduled dispatches for consumer page."""
    active = [{"route": d["route"], "buses": d["buses"], "status": d["status"]}
              for d in DISPATCHES if d["status"] != "Cancelled"]
    return jsonify(active)


# ── Employee portal ───────────────────────────────────────────────────────────

def employee_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("employee"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for("employee_login"))
        return f(*args, **kwargs)
    return wrapper


@app.route("/employee/login", methods=["GET", "POST"])
def employee_login():
    error = None
    if request.method == "POST":
        if request.form.get("pin", "") == EMPLOYEE_PIN:
            session["employee"] = True
            return redirect(url_for("employee_dashboard"))
        error = "Incorrect PIN. Try again."
    return render_template("employee_login.html", error=error)


@app.route("/employee/logout")
def employee_logout():
    session.pop("employee", None)
    return redirect(url_for("index"))


@app.route("/employee")
@employee_required
def employee_dashboard():
    return render_template("employee.html", routes=ROUTES, route_stops=ROUTE_STOPS)


@app.route("/api/employee/overview")
@employee_required
def employee_overview():
    """Heatmap of predicted load (all routes x hours) + dispatch recommendations."""
    if not MODELS_LOADED:
        return jsonify({"error": "Models not loaded"}), 503
    now = datetime.now()
    day, wk = now.weekday(), int(now.weekday() >= 5)
    cur = min(22, max(6, now.hour))

    heat = {r: [get_prediction(h, day, wk, r)["occupancy_pct"] for h in range(6, 23)] for r in ROUTES}

    active = [d for d in DISPATCHES if d["status"] != "Cancelled"]
    recs = []
    for r in ROUTES:
        for h in range(cur, min(23, cur + 4)):      # now + next 3 hours
            p = get_prediction(h, day, wk, r)
            if p["occupancy_pct"] >= 80:
                covered = sum(d["buses"] for d in active if d["route"] == r)
                recs.append({
                    "route": r, "hour": h, "occupancy_pct": p["occupancy_pct"],
                    "suggested_buses": 2 if p["occupancy_pct"] >= 95 else 1,
                    "is_peak": p["is_peak"], "already_covered": covered > 0,
                })
    recs.sort(key=lambda x: (-x["occupancy_pct"], x["hour"]))
    return jsonify({
        "now_hour": cur, "hours": list(range(6, 23)), "heatmap": heat,
        "recommendations": recs[:8],
        "stats": {
            "active_dispatches": len(active),
            "buses_out": sum(d["buses"] for d in active),
            "alerts": len(recs),
        },
    })


@app.route("/api/employee/dispatches", methods=["GET", "POST"])
@employee_required
def employee_dispatches():
    if request.method == "GET":
        return jsonify(sorted(DISPATCHES, key=lambda d: d["created_at"], reverse=True))

    d = request.get_json(silent=True) or {}
    route, dest = d.get("route"), d.get("destination")
    if route not in ROUTES or dest not in ROUTE_STOPS[route]:
        return jsonify({"error": "Choose a valid route and stop."}), 400
    try:
        buses = int(d.get("buses", 1))
    except (TypeError, ValueError):
        buses = 0
    if not 1 <= buses <= 5:
        return jsonify({"error": "Buses must be between 1 and 5."}), 400

    when = d.get("when", "now")
    if when != "now":
        try:
            datetime.strptime(when, "%H:%M")
        except ValueError:
            return jsonify({"error": "Invalid departure time."}), 400

    rec = {
        "id": uuid.uuid4().hex[:8], "route": route, "destination": dest,
        "buses": buses, "when": when,
        "reason": str(d.get("reason", "High demand"))[:60],
        "note": str(d.get("note", ""))[:200],
        "status": "Dispatched" if when == "now" else "Scheduled",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    DISPATCHES.append(rec)
    return jsonify(rec), 201


@app.route("/api/employee/dispatches/<did>", methods=["DELETE"])
@employee_required
def cancel_dispatch(did):
    for d in DISPATCHES:
        if d["id"] == did:
            d["status"] = "Cancelled"
            return jsonify(d)
    return jsonify({"error": "Not found"}), 404


if __name__ == "__main__":
    app.run(debug=True, port=5000)
