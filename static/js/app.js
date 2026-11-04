/* app.js — ShuttleIQ passenger view */
const $ = id => document.getElementById(id);

const ROUTES = ["Campus → Mall", "Mall → Campus", "Campus → Metro", "Metro → Campus"];
const BUS_CAPACITY = 27; // Optare Solo actual capacity

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
  const firstTab = document.querySelector('#route-tabs button');
  if (firstTab) { firstTab.style.background = 'var(--accent)'; firstTab.style.color = '#000'; }

  $('btn-go').addEventListener('click', () => {
    currentHour = parseInt($('sel-hour').value);
    currentDay  = parseInt($('sel-day').value);
    refresh();
  });

  loadMetrics();
  refresh();
  setInterval(refresh, 30000); // auto-refresh every 30s to pick up staff dispatches
});

function refresh() { loadDepartures(); }

// ── Departures (factors in staff dispatches) ──────────────────────────────────
async function loadDepartures() {
  const container = $('departures');
  container.innerHTML = '<div class="loading-msg">Fetching…</div>';

  // Fetch predictions + any active staff dispatches for this route
  const offsets = [0, 15, 30];
  const [results, dispatches] = await Promise.all([
    Promise.all(offsets.map(async offset => {
      const h = Math.min(22, currentHour + (offset >= 60 ? 1 : 0));
      const params = new URLSearchParams({ route: activeRoute, hour: h, day: currentDay });
      const res = await fetch(`/api/predict?${params}`);
      return { offset, data: await res.json() };
    })),
    fetch('/api/dispatches_public').then(r => r.json()).catch(() => [])
  ]);

  // Count extra buses dispatched for this route
  const extraBuses = dispatches.filter(d =>
    d.route === activeRoute && d.status !== 'Cancelled'
  ).reduce((sum, d) => sum + d.buses, 0);

  container.innerHTML = '';
  const bestIdx = results.reduce((bi, r, i) => r.data.occupancy < results[bi].data.occupancy ? i : bi, 0);

  results.forEach(({ offset, data }, i) => {
    if (data.error) return;

    // If extra buses dispatched, spread passengers — reduce effective occupancy
    let adjOccupancy = data.occupancy;
    let adjOccPct    = data.occupancy_pct;
    let extraNote    = '';
    if (extraBuses > 0) {
      adjOccupancy = Math.round(data.occupancy / (1 + extraBuses));
      adjOccPct    = Math.round((adjOccupancy / BUS_CAPACITY) * 100);
      extraNote    = `+${extraBuses} extra bus${extraBuses > 1 ? 'es' : ''} dispatched`;
    }

    const depTime = new Date();
    depTime.setHours(currentHour, offset, 0, 0);
    const timeStr = depTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isBest  = i === bestIdx;
    const isFull  = adjOccPct >= 95;
    const seatChance = isFull ? 0 : Math.round(100 - adjOccPct);
    const chanceColor = seatChance >= 60 ? 'var(--success)' : seatChance >= 30 ? 'var(--warning)' : 'var(--danger)';
    const chanceText  = isFull ? '🚫 Full' : `${seatChance}% chance of a seat`;
    let badgeClass = isBest && !isFull ? 'success' : isFull ? 'danger' : adjOccPct >= 70 ? 'warning' : 'moderate';
    let badgeText  = isBest && !isFull ? 'Best option' : isFull ? 'Full' : (adjOccPct >= 70 ? 'Busy' : adjOccPct >= 40 ? 'Moderate' : 'Available');

    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;
      background:${isBest ? 'rgba(45,219,106,0.06)' : 'var(--surface-2)'};
      border:1px solid ${isBest ? 'var(--success)' : 'var(--border)'};
      border-radius:var(--radius);padding:0.75rem 0.9rem;cursor:pointer;`;

    const left = document.createElement('div');
    left.innerHTML = `
      <div style="font-family:var(--font-mono);font-size:1.1rem;font-weight:700;">${timeStr}</div>
      <div style="font-size:0.75rem;color:var(--text-dim);">~${data.travel_time_min} min journey</div>
      ${extraNote ? `<div style="font-size:0.7rem;color:var(--accent);margin-top:0.2rem;">🚌 ${extraNote}</div>` : ''}`;

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;';
    right.innerHTML = `
      <span style="font-size:0.82rem;font-weight:600;color:${chanceColor};">${chanceText}</span>
      <span class="crowd-badge ${badgeClass}">${badgeText}</span>`;

    row.append(left, right);
    row.addEventListener('click', () => renderSeatMap({ ...data, occupancy: adjOccupancy, occupancy_pct: adjOccPct }, activeRoute));
    container.appendChild(row);

    if (isBest) {
      $('hero-occ-pct').textContent = adjOccPct + '%';
      $('hero-seats').textContent   = BUS_CAPACITY - adjOccupancy;
      $('hero-eta').textContent     = data.travel_time_min;
    }
  });

  renderSeatMap({ ...results[bestIdx].data }, activeRoute);
  renderRecommendation(results, bestIdx, extraBuses);
}

// ── Optare Solo seat map ───────────────────────────────────────────────────────
// Layout based on actual floor plan:
// Front: wheelchair bay (left) + 2 seats (right, forward-facing) + door
// Row 1: 2 seats left only (over wheel arch) + 3 seats right
// Rows 2-7: 2 seats left + 2 seats right (standard 2+2)
// Rear row: 5 seats across back bench
//
// Total: 2 + 3 + (6×4) + 5 = 34 — trim to 27 for Solo SR

// Seat layout definition: each entry is a row
// 'L' = left seats count, 'R' = right seats count, 'type' = special
const SOLO_LAYOUT = [
  { type: 'driver' },                        // driver + wheelchair
  { L: 0, R: 2, note: 'door-side' },        // front right only (door left)
  { L: 2, R: 2 },
  { L: 2, R: 2 },
  { L: 2, R: 2 },
  { L: 2, R: 2 },
  { L: 2, R: 2 },
  { L: 0, R: 0, type: 'rear-bench', seats: 5 }, // rear bench
];

function renderSeatMap(data, route) {
  const busBody = $('bus-body');
  $('seatmap-route').textContent = route;
  busBody.innerHTML = '';

  const seated   = Math.min(Math.round(data.occupancy), BUS_CAPACITY);
  const standing = Math.max(0, Math.round(data.occupancy) - BUS_CAPACITY);

  let seatIndex = 0;

  const isTaken = () => { const t = seatIndex < seated; seatIndex++; return t; };

  const seatEl = (taken) => {
    const s = document.createElement('div');
    s.style.cssText = `width:28px;height:28px;border-radius:5px 5px 3px 3px;border:1px solid;flex-shrink:0;
      background:${taken ? 'rgba(240,82,82,0.3)' : 'rgba(45,219,106,0.2)'};
      border-color:${taken ? 'rgba(240,82,82,0.6)' : 'rgba(45,219,106,0.5)'};`;
    return s;
  };

  const gap = () => {
    const g = document.createElement('div');
    g.style.cssText = 'flex:1;min-width:8px;';
    return g;
  };

  const aisle = () => {
    const a = document.createElement('div');
    a.style.cssText = 'width:22px;flex-shrink:0;';
    return a;
  };

  // Bus outer shell styling
  busBody.style.cssText = 'background:#0d1117;border:2px solid #3a3f52;border-radius:20px 20px 12px 12px;padding:0.8rem;display:flex;flex-direction:column;gap:6px;position:relative;';

  // ── Driver / wheelchair row ──
  const driverRow = document.createElement('div');
  driverRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding-bottom:6px;border-bottom:1px dashed var(--border);margin-bottom:2px;';
  const wheelEl = document.createElement('div');
  wheelEl.style.cssText = 'width:36px;height:28px;border-radius:5px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:0.65rem;color:var(--text-dim);flex-shrink:0;';
  wheelEl.textContent = '♿';
  const driverLabel = document.createElement('div');
  driverLabel.style.cssText = 'font-size:0.65rem;color:var(--text-dim);flex:1;';
  driverLabel.textContent = 'Driver';
  const doorLabel = document.createElement('div');
  doorLabel.style.cssText = 'font-size:0.6rem;color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:0.1rem 0.4rem;opacity:0.7;';
  doorLabel.textContent = 'DOOR';
  driverRow.append(wheelEl, driverLabel, doorLabel);
  busBody.appendChild(driverRow);

  // ── Seat rows ──
  SOLO_LAYOUT.forEach(rowDef => {
    if (rowDef.type === 'driver') return;

    const rowEl = document.createElement('div');
    rowEl.style.cssText = 'display:flex;align-items:center;gap:5px;';

    if (rowDef.type === 'rear-bench') {
      // 5 seats across back
      rowEl.style.justifyContent = 'center';
      rowEl.style.marginTop = '4px';
      rowEl.style.paddingTop = '4px';
      rowEl.style.borderTop = '1px dashed var(--border)';
      for (let i = 0; i < rowDef.seats; i++) {
        rowEl.appendChild(seatEl(isTaken()));
        if (i < rowDef.seats - 1) {
          const sp = document.createElement('div');
          sp.style.width = '5px';
          rowEl.appendChild(sp);
        }
      }
    } else {
      // Left seats
      const leftWrap = document.createElement('div');
      leftWrap.style.cssText = 'display:flex;gap:4px;width:60px;justify-content:flex-end;';
      for (let i = 0; i < rowDef.L; i++) leftWrap.appendChild(seatEl(isTaken()));
      if (rowDef.L === 0) {
        // empty placeholder (door/arch side)
        const ph = document.createElement('div');
        ph.style.cssText = 'width:28px;height:28px;border-radius:5px;border:1px dashed rgba(255,255,255,0.08);';
        leftWrap.appendChild(ph);
      }

      rowEl.appendChild(leftWrap);
      rowEl.appendChild(aisle());

      // Right seats
      const rightWrap = document.createElement('div');
      rightWrap.style.cssText = 'display:flex;gap:4px;';
      for (let i = 0; i < rowDef.R; i++) rightWrap.appendChild(seatEl(isTaken()));
      rowEl.appendChild(rightWrap);
    }

    busBody.appendChild(rowEl);
  });

  // Standing
  if (standing > 0) {
    const s = document.createElement('div');
    s.style.cssText = 'margin-top:0.5rem;font-size:0.7rem;color:var(--warning);text-align:center;';
    s.textContent = `+${standing} standing`;
    busBody.appendChild(s);
  }

  // Summary
  const summary = document.createElement('div');
  summary.style.cssText = 'margin-top:0.4rem;font-size:0.72rem;color:var(--text-dim);text-align:center;border-top:1px dashed var(--border);padding-top:0.4rem;';
  summary.textContent = `${seated} seated · ${BUS_CAPACITY - seated} free · ${data.occupancy_pct}% full`;
  busBody.appendChild(summary);
}

// ── Recommendation ────────────────────────────────────────────────────────────
function renderRecommendation(results, bestIdx, extraBuses) {
  const best   = results[bestIdx].data;
  const offset = results[bestIdx].offset;
  const depTime = new Date();
  depTime.setHours(currentHour, offset, 0, 0);
  const timeStr = depTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const adjOcc  = extraBuses > 0 ? Math.round(best.occupancy / (1 + extraBuses)) : best.occupancy;

  if (adjOcc / BUS_CAPACITY >= 0.95) {
    $('rec-icon').textContent  = '⚠️';
    $('rec-title').textContent = 'All upcoming buses are busy';
    $('rec-sub').textContent   = 'Consider travelling outside peak hours';
  } else {
    $('rec-icon').textContent  = '✅';
    $('rec-title').textContent = `Take the ${timeStr} bus`;
    $('rec-sub').textContent   = `~${BUS_CAPACITY - adjOcc} seats free · ${best.travel_time_min} min journey · ${best.crowd_label}${extraBuses > 0 ? ` · +${extraBuses} extra bus dispatched` : ''}`;
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
    [
      { val: m.mae_rf_occupancy,     label: 'RF Occupancy MAE',   sub: 'passengers' },
      { val: m.mae_base_occupancy,   label: 'Baseline Occ MAE',   sub: 'hist. avg' },
      { val: m.mae_rf_travel_time,   label: 'RF Travel Time MAE', sub: 'minutes' },
      { val: m.mae_base_travel_time, label: 'Baseline ETA MAE',   sub: 'hist. avg' },
      { val: m.mae_rf_occ_peak,      label: 'Peak-hour MAE',      sub: 'peak only' },
      { val: m.mae_rf_occ_offpeak,   label: 'Off-peak MAE',       sub: 'off-peak' },
    ].forEach(c => {
      const card = document.createElement('div');
      card.className = 'metric-card';
      card.innerHTML = `<span class="mc-val">${c.val ?? '—'}</span><span class="mc-label">${c.label}</span><span class="mc-sub">${c.sub}</span>`;
      grid.appendChild(card);
    });
  } catch(e) {}
}
