"""
train_model.py
Trains Random Forest models for:
  - Occupancy prediction
  - Travel time prediction
Compares against historical average baseline.
Run once after generate_data.py: python train_model.py
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.preprocessing import LabelEncoder
import joblib
import json
import os

# ── Load data ──────────────────────────────────────────────────────────────
df = pd.read_csv("data/shuttle_data.csv")

ROUTES = df["route"].unique().tolist()
le = LabelEncoder()
df["route_enc"] = le.fit_transform(df["route"])

FEATURES = ["hour", "day_of_week", "is_weekend", "route_enc"]

# ── Chronological train/test split (80/20) ──────────────────────────────────
split_idx = int(len(df) * 0.8)
train, test = df.iloc[:split_idx], df.iloc[split_idx:]

X_train, X_test = train[FEATURES], test[FEATURES]

# ── Occupancy model ─────────────────────────────────────────────────────────
rf_occ = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
rf_occ.fit(X_train, train["occupancy"])
pred_occ_rf = rf_occ.predict(X_test)

# Baseline: historical average per (hour, route)
baseline_occ = train.groupby(["hour", "route"])["occupancy"].mean().to_dict()
def baseline_predict_occ(row):
    key = (row["hour"], row["route"])
    return baseline_occ.get(key, train["occupancy"].mean())
pred_occ_base = test.apply(baseline_predict_occ, axis=1)

mae_rf_occ   = mean_absolute_error(test["occupancy"], pred_occ_rf)
mae_base_occ = mean_absolute_error(test["occupancy"], pred_occ_base)

# ── Travel time model ────────────────────────────────────────────────────────
rf_tt = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
rf_tt.fit(X_train, train["travel_time_min"])
pred_tt_rf = rf_tt.predict(X_test)

baseline_tt = train.groupby(["hour", "route"])["travel_time_min"].mean().to_dict()
def baseline_predict_tt(row):
    key = (row["hour"], row["route"])
    return baseline_tt.get(key, train["travel_time_min"].mean())
pred_tt_base = test.apply(baseline_predict_tt, axis=1)

mae_rf_tt   = mean_absolute_error(test["travel_time_min"], pred_tt_rf)
mae_base_tt = mean_absolute_error(test["travel_time_min"], pred_tt_base)

# ── Peak-hour MAE breakdown ──────────────────────────────────────────────────
peak_mask = test["hour"].isin([7, 8, 9, 12, 13, 16, 17, 18])
mae_rf_occ_peak  = mean_absolute_error(test.loc[peak_mask, "occupancy"], pred_occ_rf[peak_mask])
mae_rf_occ_off   = mean_absolute_error(test.loc[~peak_mask, "occupancy"], pred_occ_rf[~peak_mask])

# ── Save artefacts ────────────────────────────────────────────────────────────
os.makedirs("models", exist_ok=True)
joblib.dump(rf_occ, "models/rf_occupancy.pkl")
joblib.dump(rf_tt,  "models/rf_travel_time.pkl")
joblib.dump(le,     "models/label_encoder.pkl")

# Save baselines and metadata as JSON for the app to use
metrics = {
    "mae_rf_occupancy":    round(mae_rf_occ, 2),
    "mae_base_occupancy":  round(mae_base_occ, 2),
    "mae_rf_travel_time":  round(mae_rf_tt, 2),
    "mae_base_travel_time":round(mae_base_tt, 2),
    "mae_rf_occ_peak":     round(mae_rf_occ_peak, 2),
    "mae_rf_occ_offpeak":  round(mae_rf_occ_off, 2),
    "routes":              ROUTES,
    "bus_capacity":        27,
}
with open("models/metrics.json", "w") as f:
    json.dump(metrics, f, indent=2)

# Save baseline lookup tables
df_base_occ = train.groupby(["hour", "route"])["occupancy"].mean().reset_index()
df_base_occ.to_csv("models/baseline_occupancy.csv", index=False)

df_base_tt = train.groupby(["hour", "route"])["travel_time_min"].mean().reset_index()
df_base_tt.to_csv("models/baseline_travel_time.csv", index=False)

print("=" * 50)
print("MODEL EVALUATION RESULTS")
print("=" * 50)
print(f"Occupancy  — RF MAE: {mae_rf_occ:.2f} pax  |  Baseline MAE: {mae_base_occ:.2f} pax")
print(f"Travel Time— RF MAE: {mae_rf_tt:.2f} min  |  Baseline MAE: {mae_base_tt:.2f} min")
print(f"Peak-hour occupancy MAE: {mae_rf_occ_peak:.2f}  |  Off-peak: {mae_rf_occ_off:.2f}")
print("Models saved to /models/")
