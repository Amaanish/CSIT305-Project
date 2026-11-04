/* app.js — ShuttleIQ transit UI */

const $ = id => document.getElementById(id);

const ROUTES = ["Campus → Mall", "Mall → Campus", "Campus → Metro", "Metro → Campus"];
const BUS_CAPACITY = 40;

// Optare Solo layout: 4 seats per row (2+2), ~10 rows, driver at front
// Total ~38 seats + some standing room
const SEAT_ROWS = 10; // 10 rows of 4 seats = 40 seats

let activeRoute = ROUTES[0];
let currentHour = Math.min(22, Math.max(6, new Date().getHours()));
let currentDay  = (() => { const m=[6,0,1,2,3,4,5]; return m[new Date().getDay()]; })();

// ── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  $('sel-hour').value = currentHour;
  $('sel-day').value  = currentDay;

  // Route tabs
  document.querySelectorAll('.route-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.route-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeRoute = btn.dataset.route;
      refresh();
    });
  });

  $('btn-go').addEventListener('click', () => {
    currentHour = parseInt($('sel-hour').value);
    currentDay  = parseInt($('sel-day').value);
    refresh();
  });

  loadMetrics();
  refresh();
});

function refresh() {
  loadDepartures();
}

// ── Departures ────────────────────────────────────────────────────────────────
// Simulate 3 upcoming buses: now, +15min, +30min
async function loadDepartures() {
  const container = $('departures');
  container.innerHTML = '<div class="loading">Fetching…</div>';

  // Fetch predictions for current hour and next (simulating ±15min slots)
  const offsets = [0, 15, 30]; // minutes from now
  const results = await Promise.all(offsets.map(async (offset) => {
    const h = Math.min(22, currentHour + (offset >= 60 ? 1 : 0));
    const params = new URLSearchParams({ route: activeRoute, hour: h, day: currentDay });
    const res = await fetch(`/api/predict?${params}`);
    return { offset, data: await res.json() };
  }));

  container.innerHTML = '';

  // Find the best (least crowded) bus
  const bestIdx = results.reduce((bi, r, i) =>
    r.data.occupancy < results[bi].data.occupancy ? i : bi, 0);

  results.forEach(({ offset, data }, i) => {
    if (data.error) return;

    const depTime = new Date();
    depTime.setHours(currentHour, offset, 0, 0);
    const timeStr = depTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const isBest = i === bestIdx;
    const isFull = data.occupancy_pct >= 95;
    const seatChance = isFull ? 0 : Math.round(100 - data.occupancy_pct);

    const row = document.createElement('div');
    row.className = `dep-row${isBest ? ' best' : ''}`;

    let chanceClass = seatChance >= 60 ? 'high' : seatChance >= 30 ? 'medium' : 'low';
    let chanceText  = isFull
      ? '🚫 Full'
      : `${seatChance}% chance of a seat`;

    let badgeHtml = '';
    if (isBest && !isFull) badgeHtml = `<span class="dep-badge best-tag">Best option</span>`;
    else if (isFull)       badgeHtml = `<span class="dep-badge full-tag">Full</span>`;
    else if (data.occupancy_pct >= 70) badgeHtml = `<span class="dep-badge busy-tag">Busy</span>`;

    row.innerHTML = `
      <div class="dep-left">
        <span class="dep-time">${timeStr}</span>
        <span class="dep-eta">~${data.travel_time_min} min journey</span>
      </div>
      <div class="dep-right">
        <span class="dep-chance ${chanceClass}">${chanceText}</span>
        ${badgeHtml}
      </div>`;

    row.addEventListener('click', () => renderSeatMap(data, activeRoute));
    container.appendChild(row);
  });

  // Auto-render seat map for best bus
  renderSeatMap(results[bestIdx].data, activeRoute);
  renderRecommendation(results, bestIdx);
}

// ── Seat map ──────────────────────────────────────────────────────────────────
function renderSeatMap(data, route) {
  const busBody = $('bus-body');
  $('seatmap-route').textContent = route;

  const occupancy = data.occupancy;
  const standing  = Math.max(0, occupancy - BUS_CAPACITY);
  const seated    = Math.min(occupancy, BUS_CAPACITY);

  busBody.innerHTML = '';

  // Driver row
  const driverArea = document.createElement('div');
  driverArea.className = 'driver-area';
  driverArea.innerHTML = `<span class="driver-wheel">🚌</span><span>Driver · Door</span>`;
  busBody.appendChild(driverArea);

  // Seat grid: 10 rows × 4 seats (2 left + aisle + 2 right) = 40 seats
  const grid = document.createElement('div');
  grid.className = 'seat-grid';

  for (let row = 0; row < SEAT_ROWS; row++) {
    for (let col = 0; col < 5; col++) {
      if (col === 2) {
        // aisle
        const aisle = document.createElement('div');
        aisle.className = 'aisle';
        grid.appendChild(aisle);
        continue;
      }
      const seatIndex = row * 4 + (col > 2 ? col - 1 : col);
      const seat = document.createElement('div');
      seat.className = 'seat ' + (seatIndex < seated ? 'taken' : 'free');
      grid.appendChild(seat);
    }
  }

  busBody.appendChild(grid);

  // Standing indicator
  if (standing > 0) {
    const standDiv = document.createElement('div');
    standDiv.style.cssText = 'margin-top:0.6rem;font-size:0.72rem;color:var(--yellow);text-align:center;';
    standDiv.textContent = `+${standing} standing passengers`;
    busBody.appendChild(standDiv);
  }

  // Occupancy summary
  const summary = document.createElement('div');
  summary.style.cssText = 'margin-top:0.5rem;font-size:0.75rem;color:var(--dim);text-align:center;';
  summary.textContent = `${seated} seated · ${BUS_CAPACITY - seated} seats free · ${data.occupancy_pct}% full`;
  busBody.appendChild(summary);
}

// ── Recommendation ────────────────────────────────────────────────────────────
function renderRecommendation(results, bestIdx) {
  const best = results[bestIdx].data;
  const offset = results[bestIdx].offset;

  const depTime = new Date();
  depTime.setHours(currentHour, offset, 0, 0);
  const timeStr = depTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const freeSeats = BUS_CAPACITY - best.occupancy;
  const isFull = best.occupancy_pct >= 95;

  if (isFull) {
    $('rec-card').querySelector('.rec-icon').textContent = '⚠️';
    $('rec-title').textContent = 'All upcoming buses are busy';
    $('rec-sub').textContent   = 'Consider travelling outside peak hours';
  } else {
    $('rec-card').querySelector('.rec-icon').textContent = '✅';
    $('rec-title').textContent = `Take the ${timeStr} bus`;
    $('rec-sub').textContent   = `~${freeSeats} seats available · ${best.travel_time_min} min journey · ${best.crowd_label}`;
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────────
async function loadMetrics() {
  try {
    const res = await fetch('/api/metrics');
    const m   = await res.json();
    const strip = $('accuracy-strip');
    const diff  = (m.mae_base_occupancy - m.mae_rf_occupancy).toFixed(2);
    strip.innerHTML = `RF model: <span class="acc-better">${m.mae_rf_occupancy} pax MAE</span> vs baseline ${m.mae_base_occupancy} pax — <span class="acc-better">${diff} pax improvement</span>`;
  } catch (e) {}
}
