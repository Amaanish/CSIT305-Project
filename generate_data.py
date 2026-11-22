"""
generate_data.py
Loads real CyRide APC data from counts/ directory and preprocesses it
into the format expected by train_model.py.
Place your counts/*.csv files in the same directory as this script.
Run: python generate_data.py
"""

import pandas as pd
import numpy as np
import os
import glob

DATA_DIR = os.path.join(os.path.dirname(__file__), "counts")
OUT_PATH = os.path.join(os.path.dirname(__file__), "data", "shuttle_data.csv")

def load_cyride(data_dir):
    files = sorted(glob.glob(os.path.join(data_dir, "*.csv")))
    if not files:
        raise FileNotFoundError(
            f"No CSV files found in {data_dir}/\n"
            "Copy your CyRide counts/*.csv files there and re-run."
        )
    print(f"Loading {len(files)} file(s): {[os.path.basename(f) for f in files]}")
    dfs = []
    for f in files:
        try:
            dfs.append(pd.read_csv(f, low_memory=False))
        except Exception as e:
            print(f"  Skipping {f}: {e}")
    df = pd.concat(dfs, ignore_index=True)
    print(f"  Raw rows: {len(df):,}")
    return df

def preprocess(df):
    # Parse timestamps (format: "2022-09-01 06:21:52.0000000 -05:00")
    df["arrive_dt"] = pd.to_datetime(df["arrive"].str[:19], errors="coerce")
    df["sched_dt"]  = pd.to_datetime(df["scheduled_arrive"].str[:19], errors="coerce")

    # Drop rows with unparseable timestamps or missing occupancy
    df = df.dropna(subset=["arrive_dt", "arrival_passengers", "vehicle_capacity"])

    # Time features
    df["hour"]        = df["arrive_dt"].dt.hour
    df["day_of_week"] = df["arrive_dt"].dt.dayofweek   # 0=Mon
    df["is_weekend"]  = (df["day_of_week"] >= 5).astype(int)
    df["date"]        = df["arrive_dt"].dt.date

    # Travel time delay in minutes (actual - scheduled)
    df["travel_time_min"] = (
        (df["arrive_dt"] - df["sched_dt"]).dt.total_seconds() / 60
    ).abs().clip(0, 60)   # cap at 60 min; negatives = early, treat as 0 delay

    # Occupancy — use departure_passengers as the "on board" count
    df["occupancy"]        = pd.to_numeric(df["departure_passengers"], errors="coerce").fillna(0).clip(0)
    df["vehicle_capacity"] = pd.to_numeric(df["vehicle_capacity"],      errors="coerce").fillna(60)
    df["available_seats"]  = (df["vehicle_capacity"] - df["occupancy"]).clip(0)

    # Route name — use RouteName directly
    df["route"] = df["RouteName"].astype(str).str.strip()

    # Only keep operating hours
    df = df[(df["hour"] >= 6) & (df["hour"] <= 22)]

    # Drop rows where occupancy > capacity (data errors)
    df = df[df["occupancy"] <= df["vehicle_capacity"]]

    # Keep only the columns we need
    out = df[[
        "arrive_dt", "hour", "day_of_week", "is_weekend",
        "route", "occupancy", "available_seats",
        "travel_time_min", "vehicle_capacity"
    ]].copy()

    out = out.rename(columns={"arrive_dt": "timestamp", "vehicle_capacity": "bus_capacity"})
    out["timestamp"] = out["timestamp"].astype(str)
    out = out.sort_values("timestamp").reset_index(drop=True)

    # Add a gps_ok flag — real data, so always 1
    out["gps_ok"] = 1

    print(f"  Clean rows: {len(out):,}")
    print(f"  Routes: {sorted(out['route'].unique())}")
    print(f"  Hour range: {out['hour'].min()}–{out['hour'].max()}")
    print(f"  Avg occupancy: {out['occupancy'].mean():.1f}")
    return out

if __name__ == "__main__":
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    raw = load_cyride(DATA_DIR)
    clean = preprocess(raw)
    clean.to_csv(OUT_PATH, index=False)
    print(f"\nSaved {len(clean):,} records → {OUT_PATH}")
    print(clean.head())
