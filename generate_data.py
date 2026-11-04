"""
generate_data.py
Generates a synthetic shuttle bus dataset for training the ML model.
Run once: python generate_data.py
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os

np.random.seed(42)

ROUTES = ["Campus → Mall", "Mall → Campus", "Campus → Metro", "Metro → Campus"]
BUS_CAPACITY = 27  # Optare Solo actual capacity
N_RECORDS = 5000

def peak_factor(hour):
    """Returns a demand multiplier based on time of day."""
    if 7 <= hour <= 9:    return 1.8   # morning rush
    if 12 <= hour <= 13:  return 1.5   # lunch
    if 16 <= hour <= 18:  return 1.9   # evening rush
    if 22 <= hour <= 23:  return 0.4   # late night
    return 1.0

records = []
base_time = datetime(2025, 1, 1, 6, 0, 0)

for i in range(N_RECORDS):
    timestamp = base_time + timedelta(minutes=np.random.randint(0, 365 * 24 * 60))
    hour = timestamp.hour
    day_of_week = timestamp.weekday()  # 0=Mon, 6=Sun
    is_weekend = day_of_week >= 5

    route = np.random.choice(ROUTES)

    # Base occupancy with peak and weekend adjustments
    pf = peak_factor(hour)
    if is_weekend:
        pf *= 0.5

    mean_occ = min(BUS_CAPACITY, int(BUS_CAPACITY * 0.55 * pf))
    occupancy = int(np.clip(np.random.normal(mean_occ, 6), 0, BUS_CAPACITY))

    # Travel time: base + traffic noise during peak
    base_travel_min = {"Campus → Mall": 18, "Mall → Campus": 20,
                       "Campus → Metro": 12, "Metro → Campus": 14}[route]
    traffic_noise = np.random.normal(0, 2 * pf)
    travel_time = max(5, base_travel_min + traffic_noise)

    # GPS failure flag (rare)
    gps_ok = np.random.random() > 0.03

    records.append({
        "timestamp": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        "hour": hour,
        "day_of_week": day_of_week,
        "is_weekend": int(is_weekend),
        "route": route,
        "occupancy": occupancy,
        "available_seats": BUS_CAPACITY - occupancy,
        "travel_time_min": round(travel_time, 1),
        "gps_ok": int(gps_ok),
        "bus_capacity": BUS_CAPACITY,
    })

df = pd.DataFrame(records).sort_values("timestamp").reset_index(drop=True)
os.makedirs("data", exist_ok=True)
df.to_csv("data/shuttle_data.csv", index=False)
print(f"Generated {len(df)} records → data/shuttle_data.csv")
print(df.head())
