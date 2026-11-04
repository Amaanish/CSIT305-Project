/* app.js — ShuttleIQ passenger view */
const $ = id => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

const ROUTES = ["Campus → Mall", "Mall → Campus", "Campus → Metro", "Metro → Campus"];
const BUS_CAPACITY = 40;
const SEAT_ROWS = 10;

let activeRoute = ROUTES[0];
let currentHour = Math.min(22, Math.max(6, new Date().getHours()));
let currentDay  = [6,0,1,2,3,4,5][new Date().getDay()];

window.addEventListener('DOMContentLoaded', () => {
  $('sel-hour').value = currentHour;
  $('sel-day').value  = currentDay;

  document.querySelectorAll('#route-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#route-tabs button').forEach(b => {
        b.classList.remove('active');
        b.style.background = 'var(--surface-2)';
        b.style.color = '';
      });
      btn.classList.add('active');
      btn.style.background = 'var(--accent)';
      btn.style.color = '#000';
      activeRoute = btn.dataset.route;
      refresh();
    });
  });
  // style initial active tab
  const firstTab = document.querySelector('#route-tabs button');
  if (firstTab) { firstTab.style.background = 'var(--accent)'; firstTab.style.color = '#000'; }

  $('btn-go').addEventListener('click', () => {
    currentHour = parseInt($('sel-hour').value);
    currentDay  = parseInt($('sel-day').value);
    refresh();
  });

  loadMetrics();
  refresh();
});

function refresh() { loadDepartures(); }

// ── Departures ────────────────────────────────────────────────────────────────
async function loadDepartures() {
  const container = $('departures');
  container.innerHTML = '<div class="loading-msg">Fetching…</div>';

  const offsets = [0, 15, 30];
  const results = await Promise.all(offsets.map(async offset => {
    const h = Math.min(22, currentHour + (offset >= 60 ? 1 : 0));
    const params = new URLSearchParams({ route: activeRoute, hour: h, day: currentDay });
    const res = await fetch(`/api/predict?${params}`);
    return { offset, data: await res.json() };
  }));

  container.innerHTML = '';
  const bestIdx = results.reduce((bi, r, i) => r.data.occupancy < results[bi].data.occupancy ? i : bi, 0);

  results.forEach(({ offset, data }, i) => {
    if (data.error) return;
    const depTime = new Date();
    depTime.setHours(currentHour, offset, 0, 0);
    const timeStr = depTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const isBest = i === bestIdx;
    const isFull = data.occupancy_pct >= 95;
    const seatChance = isFull ? 0 : Math.round(100 - data.occupancy_pct);

    // Build row using existing CSS classes
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;
      background:var(--surface-2);border:1px solid ${isBest ? 'var(--success)' : 'var(--border)'};
      border-radius:var(--radius);padding:0.75rem 0.9rem;cursor:pointer;
      ${isBest ? 'background:rgba(45,219,106,0.06);' : ''}`;

    const left = document.createElement('div');
    left.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:1.1rem;font-weight:700;">${timeStr}</div>
      <div style="font-size:0.75rem;color:var(--text-dim);">~${data.travel_time_min} min journey</div>`;

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;';

    const chanceColor = seatChance >= 60 ? 'var(--success)' : seatChance >= 30 ? 'var(--warning)' : 'var(--danger)';
    const chanceText  = isFull ? '🚫 Full' : `${seatChance}% chance of a seat`;

    let badgeClass = isBest && !isFull ? 'success' : isFull ? 'danger' : data.occupancy_pct >= 70 ? 'warning' : 'moderate';
    let badgeText  = isBest && !isFull ? 'Best option' : isFull ? 'Full' : data.crowd_label;

    right.innerHTML = `
      <span style="font-size:0.82rem;font-weight:600;color:${chanceColor};">${chanceText}</span>
      <span class="crowd-badge ${badgeClass}">${badgeText}</span>`;

    row.append(left, right);
    row.addEventListener('click', () => renderSeatMap(data, activeRoute));
    container.appendChild(row);

    // Update hero strip with best bus
    if (isBest) {
      $('hero-occ-pct').textContent = data.occupancy_pct + '%';
      $('hero-seats').textContent   = data.available_seats;
      $('hero-eta').textContent     = data.travel_time_min;
    }
  });

  renderSeatMap(results[bestIdx].data, activeRoute);
  renderRecommendation(results, bestIdx);
}

// ── Seat map ──────────────────────────────────────────────────────────────────
function renderSeatMap(data, route) {
  const busBody = $('bus-body');
  $('seatmap-route').textContent = route;
  busBody.innerHTML = '';

  const seated   = Math.min(data.occupancy, BUS_CAPACITY);
  const standing = Math.max(0, data.occupancy - BUS_CAPACITY);

  // Driver row
  const driver = document.createElement('div');
  driver.style.cssText = 'display:flex;align-items:center;gap:0.5rem;margin-bottom:0.9rem;padding-bottom:0.7rem;border-bottom:1px dashed var(--border);font-size:0.72rem;color:var(--text-dim);';
  driver.innerHTML = '<span style="font-size:1.2rem;">🚌</span><span>Driver · Door</span>';
  busBody.appendChild(driver);

  // Seat grid
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 16px 1fr 1fr;gap:5px;align-items:center;';

  for (let row = 0; row < SEAT_ROWS; row++) {
    for (let col = 0; col < 5; col++) {
      if (col === 2) {
        const aisle = document.createElement('div');
        grid.appendChild(aisle);
        continue;
      }
      const seatIdx = row * 4 + (col > 2 ? col - 1 : col);
      const seat = document.createElement('div');
      const taken = seatIdx < seated;
      seat.style.cssText = `aspect-ratio:1;border-radius:5px;border:1px solid;
        background:${taken ? 'rgba(240,82,82,0.25)' : 'rgba(45,219,106,0.18)'};
        border-color:${taken ? 'rgba(240,82,82,0.5)' : 'rgba(45,219,106,0.4)'};`;
      grid.appendChild(seat);
    }
  }
  busBody.appendChild(grid);

  if (standing > 0) {
    const s = document.createElement('div');
    s.style.cssText = 'margin-top:0.6rem;font-size:0.72rem;color:var(--warning);text-align:center;';
    s.textContent = `+${standing} standing passengers`;
    busBody.appendChild(s);
  }

  const summary = document.createElement('div');
  summary.style.cssText = 'margin-top:0.5rem;font-size:0.75rem;color:var(--text-dim);text-align:center;';
  summary.textContent = `${seated} seated · ${BUS_CAPACITY - seated} seats free · ${data.occupancy_pct}% full`;
  busBody.appendChild(summary);
}

// ── Recommendation ────────────────────────────────────────────────────────────
function renderRecommendation(results, bestIdx) {
  const best   = results[bestIdx].data;
  const offset = results[bestIdx].offset;
  const depTime = new Date();
  depTime.setHours(currentHour, offset, 0, 0);
  const timeStr = depTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (best.occupancy_pct >= 95) {
    $('rec-icon').textContent  = '⚠️';
    $('rec-title').textContent = 'All upcoming buses are busy';
    $('rec-sub').textContent   = 'Consider travelling outside peak hours';
  } else {
    $('rec-icon').textContent  = '✅';
    $('rec-title').textContent = `Take the ${timeStr} bus`;
    $('rec-sub').textContent   = `~${BUS_CAPACITY - best.occupancy} seats free · ${best.travel_time_min} min journey · ${best.crowd_label}`;
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────────
async function loadMetrics() {
  try {
    const res = await fetch('/api/metrics');
    const m   = await res.json();
    $('hero-mae').textContent = m.mae_rf_occupancy ?? '—';

    const grid = $('metrics-grid');
    grid.innerHTML = '';
    const cards = [
      { val: m.mae_rf_occupancy,     label: 'RF Occupancy MAE',    sub: 'passengers' },
      { val: m.mae_base_occupancy,   label: 'Baseline Occ MAE',    sub: 'passengers (hist. avg)' },
      { val: m.mae_rf_travel_time,   label: 'RF Travel Time MAE',  sub: 'minutes' },
      { val: m.mae_base_travel_time, label: 'Baseline ETA MAE',    sub: 'minutes (hist. avg)' },
      { val: m.mae_rf_occ_peak,      label: 'Peak-hour MAE',       sub: 'RF, peak hours only' },
      { val: m.mae_rf_occ_offpeak,   label: 'Off-peak MAE',        sub: 'RF, off-peak' },
    ];
    cards.forEach(c => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.innerHTML = `<span class="mc-val">${c.val ?? '—'}</span><span class="mc-label">${c.label}</span><span class="mc-sub">${c.sub}</span>`;
      grid.appendChild(card);
    });
  } catch (e) {}
}
