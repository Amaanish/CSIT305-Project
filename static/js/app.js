/* app.js — ShuttleIQ frontend */

const $ = id => document.getElementById(id);

// ── Helpers ──────────────────────────────────────────────────────────────────

function crowdColor(cls) {
  return { success: '#2ddb6a', moderate: '#60a5fa', warning: '#f0b429', danger: '#f05252' }[cls] || '#00c8ff';
}

function pctColor(pct) {
  if (pct >= 90) return '#f05252';
  if (pct >= 70) return '#f0b429';
  if (pct >= 40) return '#60a5fa';
  return '#2ddb6a';
}

// ── On load ───────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  loadMetrics();
  loadFleet();
  loadChart();

  // Pre-select current day
  const day = new Date().getDay();
  const dayMap = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };
  $('sel-day').value = dayMap[day] ?? 0;

  // Pre-select current hour (clamped to 6–22)
  const h = Math.min(22, Math.max(6, new Date().getHours()));
  $('sel-hour').value = h;

  $('btn-predict').addEventListener('click', runPrediction);
  $('sel-route').addEventListener('change', loadChart);

  // Refresh fleet every 30 s
  setInterval(loadFleet, 30_000);
});

// ── Prediction ────────────────────────────────────────────────────────────────

async function runPrediction() {
  const route  = $('sel-route').value;
  const hour   = $('sel-hour').value;
  const day    = $('sel-day').value;
  const gpsOk  = $('toggle-gps').checked ? '1' : '0';
  const btn    = $('btn-predict');

  btn.textContent = 'Loading…';
  btn.disabled = true;

  try {
    const params = new URLSearchParams({ route, hour, day, gps_ok: gpsOk });
    const res  = await fetch(`/api/predict?${params}`);
    const data = await res.json();

    if (data.error) { alert(data.error); return; }

    renderResult(data);
  } catch (e) {
    alert('Failed to fetch prediction. Is the server running?');
  } finally {
    btn.textContent = 'Get Prediction';
    btn.disabled = false;
  }
}

function renderResult(d) {
  const card = $('result-card');
  card.classList.remove('hidden');

  $('res-route').textContent   = d.route;
  $('res-occupancy').textContent = d.occupancy;
  $('res-seats').textContent   = d.available_seats;
  $('res-eta').textContent     = d.travel_time_min;

  const badge = $('res-crowd');
  badge.textContent  = d.crowd_label;
  badge.className    = `crowd-badge ${d.crowd_class}`;

  // Banners
  toggle('gps-warning', !d.gps_ok);
  toggle('peak-banner',  d.is_peak);
  toggle('extra-banner', d.recommend_extra);

  // Occupancy bar
  const fill = $('occ-bar');
  fill.style.width      = `${d.occupancy_pct}%`;
  fill.style.background = pctColor(d.occupancy_pct);
  $('occ-pct').textContent = `${d.occupancy_pct}%`;

  // Stops
  const stopsRow = $('stops-row');
  stopsRow.innerHTML = '';
  (d.stops || []).forEach((stop, i) => {
    const dot = el('span', 'stop-dot');
    const lbl = el('span', 'stop-label');
    lbl.textContent = stop;
    stopsRow.appendChild(dot);
    stopsRow.appendChild(lbl);
    if (i < d.stops.length - 1) stopsRow.appendChild(el('span', 'stop-line'));
  });

  // Comparison
  $('cmp-rf-occ').textContent   = d.occupancy;
  $('cmp-base-occ').textContent = d.baseline_occ;
  $('cmp-base-tt').textContent  = d.baseline_tt;
}

// ── Fleet overview ────────────────────────────────────────────────────────────

async function loadFleet() {
  try {
    const res  = await fetch('/api/all_routes');
    const data = await res.json();
    if (data.error) return;

    const grid = $('fleet-grid');
    grid.innerHTML = '';

    data.routes.forEach(r => {
      const card = el('div', 'fleet-card');

      const routeName = el('span', 'fleet-route');
      routeName.textContent = r.route;

      const barTrack = el('div', 'fleet-bar-track');
      const barFill  = el('div', 'fleet-bar-fill');
      barFill.style.width      = `${r.occupancy_pct}%`;
      barFill.style.background = pctColor(r.occupancy_pct);
      barTrack.appendChild(barFill);

      const meta = el('div', 'fleet-meta');
      meta.innerHTML = `<span>${r.occupancy}/${40} pax</span><span>${r.travel_time_min} min ETA</span>`;

      const badge = el('span', `fleet-badge crowd-badge ${r.crowd_class}`);
      badge.textContent = r.crowd_label;

      card.append(routeName, badge, barTrack, meta);
      if (r.recommend_extra) {
        const warn = el('div', '');
        warn.innerHTML = `<span style="font-size:0.7rem;color:var(--accent-2)">🚌 Extra bus recommended</span>`;
        card.appendChild(warn);
      }
      grid.appendChild(card);
    });
  } catch (e) {
    console.warn('Fleet load failed:', e);
  }
}

// ── Demand chart ──────────────────────────────────────────────────────────────

let chartInstance = null;

async function loadChart() {
  const route = $('sel-route').value;
  const day   = $('sel-day').value;

  try {
    const res  = await fetch(`/api/schedule?route=${encodeURIComponent(route)}&day=${day}`);
    const data = await res.json();
    if (data.error) return;

    const labels  = data.forecast.map(f => f.label);
    const occ     = data.forecast.map(f => f.occupancy);
    const tt      = data.forecast.map(f => f.travel_time);
    const bgColors = data.forecast.map(f => f.is_peak
      ? 'rgba(240, 180, 41, 0.7)'
      : 'rgba(0, 200, 255, 0.5)');

    if (chartInstance) chartInstance.destroy();

    const ctx = document.getElementById('demand-chart').getContext('2d');
    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Predicted Passengers',
            data: occ,
            backgroundColor: bgColors,
            borderColor: bgColors.map(c => c.replace('0.7', '1').replace('0.5', '1')),
            borderWidth: 1,
            yAxisID: 'y',
          },
          {
            label: 'ETA (min)',
            data: tt,
            type: 'line',
            borderColor: '#7c6ff7',
            backgroundColor: 'rgba(124, 111, 247, 0.1)',
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.4,
            yAxisID: 'y1',
            fill: true,
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#7d8fa8', font: { family: 'Space Grotesk', size: 11 } } },
          tooltip: { backgroundColor: '#1e2530', borderColor: '#2a3240', borderWidth: 1 },
        },
        scales: {
          x: { ticks: { color: '#7d8fa8', font: { size: 10 } }, grid: { color: '#2a3240' } },
          y: {
            position: 'left',
            ticks: { color: '#7d8fa8', font: { size: 10 } },
            grid: { color: '#2a3240' },
            title: { display: true, text: 'Passengers', color: '#7d8fa8', font: { size: 10 } },
          },
          y1: {
            position: 'right',
            ticks: { color: '#7c6ff7', font: { size: 10 } },
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'ETA (min)', color: '#7c6ff7', font: { size: 10 } },
          }
        }
      }
    });
  } catch (e) {
    console.warn('Chart load failed:', e);
  }
}

// ── Model metrics ─────────────────────────────────────────────────────────────

async function loadMetrics() {
  try {
    const res  = await fetch('/api/metrics');
    const m    = await res.json();

    // Hero strip
    $('hero-model-occ').textContent = m.mae_rf_occupancy ?? '—';
    $('hero-model-tt').textContent  = m.mae_rf_travel_time ?? '—';

    // Metrics grid
    const grid = $('metrics-grid');
    grid.innerHTML = '';

    const cards = [
      { val: m.mae_rf_occupancy,    label: 'RF Occupancy MAE',    sub: 'passengers (RF model)' },
      { val: m.mae_base_occupancy,  label: 'Baseline Occ MAE',    sub: 'passengers (hist. avg)' },
      { val: m.mae_rf_travel_time,  label: 'RF Travel Time MAE',  sub: 'minutes (RF model)' },
      { val: m.mae_base_travel_time,label: 'Baseline ETA MAE',    sub: 'minutes (hist. avg)' },
      { val: m.mae_rf_occ_peak,     label: 'Peak-hour Occ MAE',   sub: 'RF model, peak only' },
      { val: m.mae_rf_occ_offpeak,  label: 'Off-peak Occ MAE',    sub: 'RF model, off-peak' },
    ];

    cards.forEach(c => {
      const card = el('div', 'metric-card');
      card.innerHTML = `
        <span class="mc-val">${c.val ?? '—'}</span>
        <span class="mc-label">${c.label}</span>
        <span class="mc-sub">${c.sub}</span>`;
      grid.appendChild(card);
    });
  } catch (e) {
    console.warn('Metrics load failed:', e);
  }
}

// ── DOM utils ─────────────────────────────────────────────────────────────────

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function toggle(id, show) {
  const e = $(id);
  if (show) e.classList.remove('hidden');
  else      e.classList.add('hidden');
}
