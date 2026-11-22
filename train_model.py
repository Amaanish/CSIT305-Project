"""
train_model.py
Trains Random Forest models on real CyRide APC data.
Run after generate_data.py: python3 train_model.py
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.preprocessing import LabelEncoder
import joblib
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(os.path.join(BASE_DIR, "data/shuttle_data.csv"))

print(f"Loaded {len(df):,} records across {df['route'].nunique()} routes")

# Encode routes
le = LabelEncoder()
df["route_enc"] = le.fit_transform(df["route"])

FEATURES = ["hour", "day_of_week", "is_weekend", "route_enc"]

# Chronological 80/20 split
split_idx = int(len(df) * 0.8)
train, test = df.iloc[:split_idx], df.iloc[split_idx:]
X_train, X_test = train[FEATURES], test[FEATURES]

print(f"Train: {len(train):,}  Test: {len(test):,}")

# ── Occupancy model ──────────────────────────────────────────────────────────
print("Training occupancy model...")
rf_occ = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
rf_occ.fit(X_train, train["occupancy"])
pred_occ_rf = rf_occ.predict(X_test)

# Fast vectorized baseline: historical mean per (hour, route)
base_occ_df = train.groupby(["hour", "route"])["occupancy"].mean().reset_index(name="pred_occ")
pred_occ_base = test[["hour", "route"]].merge(base_occ_df, on=["hour", "route"], how="left")["pred_occ"].fillna(train["occupancy"].mean())

mae_rf_occ   = mean_absolute_error(test["occupancy"], pred_occ_rf)
mae_base_occ = mean_absolute_error(test["occupancy"], pred_occ_base)

# ── Travel time model ────────────────────────────────────────────────────────
print("Training travel time model...")
rf_tt = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
rf_tt.fit(X_train, train["travel_time_min"])
pred_tt_rf = rf_tt.predict(X_test)

# Fast vectorized baseline: historical mean per (hour, route)
base_tt_df = train.groupby(["hour", "route"])["travel_time_min"].mean().reset_index(name="pred_tt")
pred_tt_base = test[["hour", "route"]].merge(base_tt_df, on=["hour", "route"], how="left")["pred_tt"].fillna(train["travel_time_min"].mean())

mae_rf_tt   = mean_absolute_error(test["travel_time_min"], pred_tt_rf)
mae_base_tt = mean_absolute_error(test["travel_time_min"], pred_tt_base)

# ── Peak breakdown ───────────────────────────────────────────────────────────
peak_hours = [7, 8, 9, 12, 13, 16, 17, 18]
peak_mask = test["hour"].isin(peak_hours)
mae_rf_occ_peak = mean_absolute_error(
    test.loc[peak_mask, "occupancy"], pred_occ_rf[peak_mask])
mae_rf_occ_off  = mean_absolute_error(
    test.loc[~peak_mask, "occupancy"], pred_occ_rf[~peak_mask])

# ── Save ─────────────────────────────────────────────────────────────────────
print("Saving models and metrics...")
os.makedirs(os.path.join(BASE_DIR, "models"), exist_ok=True)
joblib.dump(rf_occ, os.path.join(BASE_DIR, "models/rf_occupancy.pkl"))
joblib.dump(rf_tt,  os.path.join(BASE_DIR, "models/rf_travel_time.pkl"))
joblib.dump(le,     os.path.join(BASE_DIR, "models/label_encoder.pkl"))

# Compute per-route average capacity from real data
avg_capacity = int(df["bus_capacity"].median())

metrics = {
    "mae_rf_occupancy":    round(mae_rf_occ,   2),
    "mae_base_occupancy":  round(mae_base_occ, 2),
    "mae_rf_travel_time":  round(mae_rf_tt,    2),
    "mae_base_travel_time":round(mae_base_tt,  2),
    "mae_rf_occ_peak":     round(mae_rf_occ_peak, 2),
    "mae_rf_occ_offpeak":  round(mae_rf_occ_off,  2),
    "routes":              sorted(df["route"].unique().tolist()),
    "bus_capacity":        avg_capacity,
    "total_records":       len(df),
    "data_source":         "CyRide APC (Iowa State University, 2021-2023)",
}
with open(os.path.join(BASE_DIR, "models/metrics.json"), "w") as f:
    json.dump(metrics, f, indent=2)

df.groupby(["hour","route"])["occupancy"].mean().reset_index().to_csv(
    os.path.join(BASE_DIR, "models/baseline_occupancy.csv"), index=False)
df.groupby(["hour","route"])["travel_time_min"].mean().reset_index().to_csv(
    os.path.join(BASE_DIR, "models/baseline_travel_time.csv"), index=False)

print("=" * 55)
print("MODEL RESULTS (Real CyRide APC data)")
print("=" * 55)
print(f"Occupancy   RF MAE: {mae_rf_occ:.2f} pax  |  Baseline: {mae_base_occ:.2f} pax")
print(f"Travel time RF MAE: {mae_rf_tt:.2f} min  |  Baseline: {mae_base_tt:.2f} min")
print(f"Peak-hour occ MAE:  {mae_rf_occ_peak:.2f}  |  Off-peak: {mae_rf_occ_off:.2f}")
print(f"Avg bus capacity (real): {avg_capacity} seats")
print(f"Routes in model: {metrics['routes']}")
print("Models saved to /models/")
