/* ── State ───────────────────────────────────────────────────────────────── */
const state = {
  employeeId: null,
  employeeName: null,
  pin: null,
  isAdmin: false,
  customers: [],     // active customers, with the caller's hours (stats=1)
  invoices: [],      // active invoices across all customers
  tasks: [],
  entries: [],
  allowedTaskIds: null, // null = all tasks visible
};

function getVisibleTasks() {
  if (!state.allowedTaskIds) return state.tasks;
  return state.tasks.filter(t =>
    state.allowedTaskIds.includes(t.id) || t.name === 'Not Listed'
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function toLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const today = () => toLocalDate(new Date());

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: toLocalDate(monday), to: toLocalDate(sunday) };
}

function round2(n) { return Math.round(n * 100) / 100; }
function fmtHours(n) { return String(round2(n || 0)); }

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showOverlay(id) {
  document.querySelectorAll('.overlay').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
}
function hideOverlay(id) { $(id).classList.remove('active'); }

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** Credentials as a query string, for GET routes that need to know who's asking. */
function authQ() {
  return `employee_id=${state.employeeId}&pin=${encodeURIComponent(state.pin)}`;
}
/** Credentials as body fields, for POST/PUT/DELETE. */
function authBody(extra = {}) {
  return { employee_id: state.employeeId, pin: state.pin, ...extra };
}

function showMsg(el, msg, type = 'error') {
  el.textContent = msg;
  el.className = type === 'error' ? 'error-msg' : 'success-msg';
  el.classList.remove('hidden');
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 3500);
}

const QUICK = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8];

function buildQuickHours(containerId, inputId) {
  const wrap = $(containerId);
  wrap.innerHTML = '';
  QUICK.forEach(h => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = h % 1 === 0 ? `${h}h` : `${h}`;
    btn.addEventListener('click', () => { $(inputId).value = h; });
    wrap.appendChild(btn);
  });
}

function statusBadge(status) {
  return status === 'pending'
    ? '<span class="status-badge pending" title="Awaiting admin review">pending</span>'
    : '';
}

/* ── Change history rendering (shared by entry, customer and admin views) ── */
const ACTION_LABELS = {
  create: 'Created', update: 'Edited', delete: 'Deleted', verify: 'Verified',
  merge: 'Merged', activate: 'Activated', deactivate: 'Deactivated',
  import: 'Imported', migrate: 'Migrated',
};
const FIELD_LABELS = {
  invoice_number: 'invoice #', is_admin: 'admin', active: 'status',
  created_at: 'created', entries_moved: 'entries moved', invoices_moved: 'invoices moved',
  invoices_removed: 'invoices removed', merged_customer: 'merged customer',
  employees_unassigned: 'employees unassigned',
};

function fmtValue(key, v) {
  if (v === null || v === undefined || v === '') return '(none)';
  if (key === 'active') return v ? 'active' : 'inactive';
  if (key === 'is_admin') return v ? 'yes' : 'no';
  if (Array.isArray(v)) {
    if (!v.length) return '(none)';
    return v.slice(0, 12).join(', ') + (v.length > 12 ? ` …+${v.length - 12} more` : '');
  }
  if (typeof v === 'object') {
    return Object.entries(v).map(([k, x]) => `${FIELD_LABELS[k] || k}: ${fmtValue(k, x)}`).join(' · ');
  }
  return String(v);
}

function renderChanges(row) {
  if (row.changes) {
    return Object.entries(row.changes).map(([k, [a, b]]) =>
      `<span class="chg"><b>${escHtml(FIELD_LABELS[k] || k)}</b> ` +
      `<del>${escHtml(fmtValue(k, a))}</del> → <ins>${escHtml(fmtValue(k, b))}</ins></span>`
    ).join('');
  }
  if (row.snapshot) {
    return `<span class="chg snap">${Object.entries(row.snapshot)
      .filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `<b>${escHtml(FIELD_LABELS[k] || k)}</b> ${escHtml(fmtValue(k, v))}`)
      .join(' · ')}</span>`;
  }
  return '';
}

function renderHistory(rows, container, { showItem = false } = {}) {
  if (!rows.length) {
    container.innerHTML = '<p class="empty-row">Nothing recorded yet.</p>';
    return;
  }
  container.innerHTML = rows.map(r => `
    <div class="hist-row">
      <div class="hist-when">${escHtml((r.ts || '').slice(0, 16))}</div>
      <div class="hist-body">
        <div class="hist-head">
          <span class="hist-action act-${escHtml(r.action)}">${escHtml(ACTION_LABELS[r.action] || r.action)}</span>
          <span class="hist-who">by ${escHtml(r.actor_name)}</span>
          ${showItem ? `<span class="hist-type">${escHtml(r.entity_type)}</span>
                        <span class="hist-label">${escHtml(r.entity_label)}</span>` : ''}
        </div>
        ${renderChanges(r) ? `<div class="hist-changes">${renderChanges(r)}</div>` : ''}
        ${r.note ? `<div class="hist-note">${escHtml(r.note)}</div>` : ''}
      </div>
    </div>`).join('');
}

/* ── Combobox factory ────────────────────────────────────────────────────── */
/**
 * items:      () => array (read on every render, so lists never go stale)
 * extra:      optional (query) => item | null, appended as a highlighted
 *             "create / switch" row at the end of the list
 * extraLabel: text for that row
 */
function makeCombo({
  inputId, listId, items, getLabel, getSub, onSelect,
  getSearch = null, extra = null, extraLabel = null,
  clearOnFocus = false, setInputOnSelect = true,
}) {
  const input = $(inputId);
  const list  = $(listId);
  let active = -1;
  let suppressBlur = false;
  let savedValue = '';
  let didSelect = false;
  const searchFn = getSearch || (i => getLabel(i));

  function addRow(item, label, sub, cls) {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    const l = document.createElement('span');
    l.textContent = label;
    li.appendChild(l);
    if (sub) {
      const s = document.createElement('span');
      s.className = 'item-sub';
      s.textContent = sub;
      li.appendChild(s);
    }
    li.addEventListener('mousedown', () => { suppressBlur = true; });
    li.addEventListener('click', () => {
      didSelect = true;
      onSelect(item);
      if (setInputOnSelect) input.value = getLabel(item);
      list.classList.add('hidden');
      suppressBlur = false;
    });
    list.appendChild(li);
  }

  function render(filter) {
    const q = filter.trim().toLowerCase();
    const all = items();
    const filtered = q ? all.filter(i => searchFn(i).toLowerCase().includes(q)) : all;
    list.innerHTML = '';
    filtered.slice(0, 60).forEach(item => addRow(item, getLabel(item), getSub ? getSub(item) : ''));
    const ex = extra && q ? extra(filter.trim()) : null;
    if (ex) addRow(ex, extraLabel(ex), '', 'combo-extra');
    if (!list.children.length) { list.classList.add('hidden'); return; }
    active = -1;
    list.classList.remove('hidden');
  }

  input.addEventListener('input', () => render(input.value));

  if (clearOnFocus) {
    input.addEventListener('focus', () => {
      savedValue = input.value;
      didSelect = false;
      input.value = '';
      render('');
    });
  } else {
    input.addEventListener('focus', () => render(input.value));
  }

  input.addEventListener('blur', () => {
    if (suppressBlur) return;
    setTimeout(() => list.classList.add('hidden'), 150);
    if (clearOnFocus && !didSelect) input.value = savedValue;
  });

  input.addEventListener('keydown', e => {
    const lis = list.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
      active = Math.min(active + 1, lis.length - 1);
    } else if (e.key === 'ArrowUp') {
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter') {
      // Enter picks the highlighted row, or the first row if the user just typed.
      const pick = active >= 0 ? lis[active] : (input.value.trim() ? lis[0] : null);
      if (pick) { pick.click(); e.preventDefault(); }
      return;
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
    } else { return; }
    lis.forEach((li, i) => li.classList.toggle('active', i === active));
    if (lis[active]) lis[active].scrollIntoView({ block: 'nearest' });
  });
}
