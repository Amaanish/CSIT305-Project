/* employee.js — dispatch console */
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const pctColor = p => p >= 90 ? '#f05252' : p >= 70 ? '#f0b429' : p >= 40 ? '#60a5fa' : '#2ddb6a';
const hh = h => `${String(h).padStart(2, '0')}:00`;

function fillStops() {
  const stops = window.ROUTE_STOPS[$('d-route').value] || [];
  $('d-stop').innerHTML = '';
  stops.forEach(s => $('d-stop').appendChild(new Option(s, s)));
}

function showError(msg) {
  const e = $('d-error');
  e.textContent = msg || '';
  e.classList.toggle('hidden', !msg);
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) { location.href = '/employee/login'; throw new Error('auth'); }
  return { ok: res.ok, data: await res.json() };
}

async function loadOverview() {
  const { data } = await api('/api/employee/overview');
  if (data.error) return;

  $('st-alerts').textContent = data.stats.alerts;
  $('st-active').textContent = data.stats.active_dispatches;
  $('st-buses').textContent  = data.stats.buses_out;

  // Recommendations
  const box = $('recs');
  box.innerHTML = '';
  if (!data.recommendations.length) box.appendChild(el('div', 'loading-msg', 'No high-demand alerts right now.'));
  data.recommendations.forEach(r => {
    const row = el('div', 'rec-row');
    const info = el('div', 'rec-info');
    info.appendChild(el('strong', '', r.route));
    info.appendChild(el('span', 'rec-sub',
      `${hh(r.hour)} · ${r.occupancy_pct}% full${r.is_peak ? ' · peak' : ''}${r.already_covered ? ' · bus already sent' : ''}`));
    const btn = el('button', 'btn-small', `Send ${r.suggested_buses} bus${r.suggested_buses > 1 ? 'es' : ''}`);
    btn.onclick = () => {
      $('d-route').value = r.route; fillStops();
      $('d-buses').value = r.suggested_buses;
      $('d-reason').value = r.is_peak ? 'Peak hour' : 'High demand';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    row.append(info, btn);
    box.appendChild(row);
  });

  // Heatmap
  const t = $('heat');
  t.innerHTML = '';
  const head = el('tr');
  head.appendChild(el('th'));
  data.hours.forEach(h => head.appendChild(el('th', h === data.now_hour ? 'now' : '', String(h))));
  t.appendChild(head);
  Object.entries(data.heatmap).forEach(([route, vals]) => {
    const tr = el('tr');
    tr.appendChild(el('th', 'heat-route', route));
    vals.forEach((v, i) => {
      const td = el('td', data.hours[i] === data.now_hour ? 'now' : '', Math.round(v));
      td.style.background = pctColor(v) + '55';
      td.title = `${route} @ ${hh(data.hours[i])}: ${v}%`;
      tr.appendChild(td);
    });
    t.appendChild(tr);
  });
}

async function loadLog() {
  const { data } = await api('/api/employee/dispatches');
  const box = $('log');
  box.innerHTML = '';
  if (!data.length) { box.appendChild(el('div', 'loading-msg', 'No dispatches yet.')); return; }
  data.forEach(d => {
    const row = el('div', 'rec-row');
    const info = el('div', 'rec-info');
    info.appendChild(el('strong', '', `${d.buses}× bus → ${d.destination}`));
    info.appendChild(el('span', 'rec-sub',
      `${d.route} · ${d.when === 'now' ? 'sent ' + d.created_at.slice(11, 16) : 'departs ' + d.when} · ${d.reason}${d.note ? ' · ' + d.note : ''}`));
    const side = el('div', 'rec-side');
    side.appendChild(el('span', 'crowd-badge ' + (d.status === 'Cancelled' ? 'danger' : d.status === 'Scheduled' ? 'moderate' : 'success'), d.status));
    if (d.status !== 'Cancelled') {
      const c = el('button', 'btn-small ghost', 'Cancel');
      c.onclick = async () => { await api('/api/employee/dispatches/' + d.id, { method: 'DELETE' }); refresh(); };
      side.appendChild(c);
    }
    row.append(info, side);
    box.appendChild(row);
  });
}

async function sendDispatch() {
  showError('');
  const later = $('d-when').value === 'later';
  if (later && !$('d-time').value) return showError('Pick a departure time.');
  const body = {
    route: $('d-route').value, destination: $('d-stop').value,
    buses: $('d-buses').value, when: later ? $('d-time').value : 'now',
    reason: $('d-reason').value, note: $('d-note').value,
  };
  const { ok, data } = await api('/api/employee/dispatches', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!ok) return showError(data.error);
  $('d-note').value = '';
  refresh();
}

const refresh = () => { loadOverview(); loadLog(); };

window.addEventListener('DOMContentLoaded', () => {
  fillStops();
  $('d-route').addEventListener('change', fillStops);
  $('d-when').addEventListener('change', () => $('d-time-wrap').classList.toggle('hidden', $('d-when').value !== 'later'));
  $('btn-dispatch').addEventListener('click', sendDispatch);
  refresh();
  setInterval(refresh, 30000);
});
