/* ── Admin panel shell ───────────────────────────────────────────────────── */
$('admin-btn').addEventListener('click', async () => {
  const { from, to } = getWeekRange();
  $('export-from').value = from;
  $('export-to').value   = to;
  showOverlay('admin-overlay');
  await Promise.all([loadAdminCustomers(), loadAdminTasks(), loadAdminEmployees(), loadAdminRoles()]);
  refreshReviewBadge();
});

$('admin-close-btn').addEventListener('click', () => hideOverlay('admin-overlay'));

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'review') loadReview();
    if (tab.dataset.tab === 'history') loadHistory(true);
  });
});

/** Refresh every list a data change might touch (admin lists + the main app). */
async function refreshEverything() {
  await Promise.all([loadCustomers(), loadInvoices(), loadEntries()]);
  if (selectedCustomerId) loadCustomerDetail(selectedCustomerId);
}

/* ── Delete confirm (admin PIN) ──────────────────────────────────────────── */
let deleteTarget = null;

function openDeleteConfirm(path, label, note, onDone) {
  deleteTarget = { path, onDone };
  $('delete-confirm-label').textContent = `Delete "${label}"?`;
  $('delete-confirm-note').textContent = note;
  $('delete-admin-pin').value = '';
  $('delete-confirm-error').classList.add('hidden');
  showOverlay('delete-confirm-overlay');
}

$('delete-confirm-cancel').addEventListener('click', () => showOverlay('admin-overlay'));

$('delete-confirm-ok').addEventListener('click', async () => {
  const adminPin = $('delete-admin-pin').value;
  const errEl = $('delete-confirm-error');
  errEl.classList.add('hidden');
  if (!adminPin) { showMsg(errEl, 'Admin PIN is required.'); return; }
  try {
    await api('DELETE', deleteTarget.path, { employee_id: state.employeeId, pin: adminPin });
    showOverlay('admin-overlay');
    await deleteTarget.onDone();
  } catch (e) {
    showMsg(errEl, e.message);
  }
});

/* Wraps an admin action: runs it, alerts on failure, then refreshes. */
async function adminAction(fn, refresh) {
  try {
    await fn();
    if (refresh) await refresh();
  } catch (e) {
    alert(e.message);
  }
}

/* ── Admin: Customers & invoices ─────────────────────────────────────────── */
let adminCustomers = [];
const openInvoicePanels = new Set();

async function loadAdminCustomers() {
  adminCustomers = await api('GET', `/api/customers?all=1&stats=1&${authQ()}`);
  renderAdminCustomers();
}

function renderAdminCustomers() {
  const list = $('customers-list');
  const q = $('admin-customer-search').value.trim().toLowerCase();
  list.innerHTML = '';
  adminCustomers
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .forEach(c => {
      const div = document.createElement('div');
      div.className = `admin-item ${c.active ? '' : 'inactive'}`;
      div.dataset.id = c.id;
      const badges = (c.is_system ? ' <span class="system-badge">System</span>' : '') + statusBadge(c.status);
      const meta = `${c.invoice_count} open invoice${c.invoice_count === 1 ? '' : 's'} · ${fmtHours(c.total_hours)} hrs`;
      const actions = c.is_system ? '' : `
        <button class="toggle-btn ${c.active ? 'active' : 'inactive'}" data-act="toggle">${c.active ? 'Active' : 'Inactive'}</button>
        <button class="btn btn-sm btn-secondary" data-act="edit">Edit</button>
        <button class="btn btn-sm btn-secondary" data-act="merge">Merge</button>
        <button class="btn btn-sm btn-danger" data-act="delete">Delete</button>`;
      div.innerHTML = `
        <span class="item-name">${escHtml(c.name)}${badges}</span>
        <span class="item-meta">${meta}</span>
        <div class="item-actions">
          <button class="btn btn-sm btn-outline" data-act="invoices">${openInvoicePanels.has(c.id) ? 'Hide invoices' : 'Invoices'}</button>
          ${actions}
        </div>`;
      list.appendChild(div);

      const on = (act, fn) => {
        const b = div.querySelector(`[data-act="${act}"]`);
        if (b) b.addEventListener('click', fn);
      };
      on('invoices', () => {
        openInvoicePanels.has(c.id) ? openInvoicePanels.delete(c.id) : openInvoicePanels.add(c.id);
        renderAdminCustomers();
      });
      on('toggle', () => adminAction(
        () => api('PUT', `/api/customers/${c.id}`, authBody({ active: c.active ? 0 : 1 })),
        async () => { await Promise.all([loadAdminCustomers(), refreshEverything()]); }));
      on('edit', () => editCustomerInline(div, c));
      on('merge', () => openMergeModal(c));
      on('delete', () => openDeleteConfirm(
        `/api/customers/${c.id}`, c.name,
        'Only customers with no time entries can be deleted. Otherwise merge it into another customer or mark it inactive.',
        async () => { await Promise.all([loadAdminCustomers(), refreshEverything()]); refreshReviewBadge(); }));

      if (openInvoicePanels.has(c.id)) renderInvoicePanel(div, c);
    });
}

$('admin-customer-search').addEventListener('input', renderAdminCustomers);

function editCustomerInline(div, c) {
  div.innerHTML = `
    <input class="edit-inline-input" value="${escHtml(c.name)}" placeholder="Customer name" style="flex:2" />
    <input class="edit-inline-input" value="${escHtml(c.notes || '')}" placeholder="Notes" style="flex:2" />
    <div class="item-actions">
      <button class="btn btn-sm btn-primary save-inline-btn">Save</button>
      <button class="btn btn-sm btn-secondary cancel-inline-btn">Cancel</button>
    </div>`;
  div.querySelector('.save-inline-btn').addEventListener('click', () => {
    const [name, notes] = [...div.querySelectorAll('.edit-inline-input')].map(i => i.value.trim());
    if (!name) { alert('Customer name is required.'); return; }
    adminAction(() => api('PUT', `/api/customers/${c.id}`, authBody({ name, notes })),
      async () => { await Promise.all([loadAdminCustomers(), refreshEverything()]); });
  });
  div.querySelector('.cancel-inline-btn').addEventListener('click', renderAdminCustomers);
}

async function renderInvoicePanel(afterDiv, customer) {
  const panel = document.createElement('div');
  panel.className = 'invoice-panel';
  panel.innerHTML = '<p class="hint">Loading invoices…</p>';
  afterDiv.insertAdjacentElement('afterend', panel);

  const invoices = await api('GET', `/api/invoices?all=1&customer_id=${customer.id}`);
  panel.innerHTML = `
    <div class="add-form">
      <input type="text" class="inv-new-number" placeholder="Invoice number" />
      <input type="text" class="inv-new-title" placeholder="Title / description (optional)" />
      <button class="btn btn-primary btn-sm inv-add-btn">Add Invoice</button>
    </div>
    <div class="inv-list"></div>`;

  const refresh = async () => { await Promise.all([loadAdminCustomers(), refreshEverything()]); refreshReviewBadge(); };

  panel.querySelector('.inv-add-btn').addEventListener('click', () => {
    const number = panel.querySelector('.inv-new-number').value.trim();
    const title  = panel.querySelector('.inv-new-title').value.trim();
    if (!number) { alert('Invoice number is required.'); return; }
    adminAction(() => api('POST', '/api/invoices', authBody({ customer_id: customer.id, invoice_number: number, title })), refresh);
  });

  const listEl = panel.querySelector('.inv-list');
  if (!invoices.length) listEl.innerHTML = '<p class="hint" style="padding:.4rem 0">No invoices yet.</p>';
  invoices.forEach(inv => {
    const row = document.createElement('div');
    row.className = `admin-item sub ${inv.active ? '' : 'inactive'}`;
    row.innerHTML = `
      <span class="item-name">${escHtml(inv.invoice_number)}${statusBadge(inv.status)}</span>
      <span class="item-meta">${escHtml(inv.title)}</span>
      <div class="item-actions">
        ${inv.status === 'pending' ? '<button class="btn btn-sm btn-primary" data-act="verify">Verify</button>' : ''}
        <button class="toggle-btn ${inv.active ? 'active' : 'inactive'}" data-act="toggle">${inv.active ? 'Active' : 'Inactive'}</button>
        <button class="btn btn-sm btn-secondary" data-act="edit">Edit</button>
        <button class="btn btn-sm btn-danger" data-act="delete">Delete</button>
      </div>`;
    listEl.appendChild(row);
    const on = (act, fn) => { const b = row.querySelector(`[data-act="${act}"]`); if (b) b.addEventListener('click', fn); };
    on('verify', () => adminAction(() => api('PUT', `/api/invoices/${inv.id}`, authBody({ status: 'verified' })), refresh));
    on('toggle', () => adminAction(() => api('PUT', `/api/invoices/${inv.id}`, authBody({ active: inv.active ? 0 : 1 })), refresh));
    on('edit', () => editInvoiceInline(row, inv, refresh));
    on('delete', () => openDeleteConfirm(`/api/invoices/${inv.id}`, `Invoice ${inv.invoice_number}`,
      'Only invoices with no time entries can be deleted. Otherwise mark it inactive.', refresh));
  });
}

function editInvoiceInline(row, inv, refresh, { verify = false } = {}) {
  const options = adminCustomers.filter(c => !c.is_system)
    .map(c => `<option value="${c.id}" ${c.id === inv.customer_id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('');
  row.innerHTML = `
    <input class="edit-inline-input" value="${escHtml(inv.invoice_number)}" placeholder="Invoice #" style="min-width:90px;flex:1" />
    <input class="edit-inline-input" value="${escHtml(inv.title || '')}" placeholder="Title" style="flex:2" />
    <select class="edit-inline-input" style="flex:2" title="Customer (change to move this invoice)">${options}</select>
    <div class="item-actions">
      <button class="btn btn-sm btn-primary save-inline-btn">${verify ? 'Save &amp; verify' : 'Save'}</button>
      <button class="btn btn-sm btn-secondary cancel-inline-btn">Cancel</button>
    </div>`;
  row.querySelector('.save-inline-btn').addEventListener('click', () => {
    const [num, title, cust] = [...row.querySelectorAll('.edit-inline-input')].map(i => i.value.trim());
    if (!num) { alert('Invoice number is required.'); return; }
    adminAction(() => api('PUT', `/api/invoices/${inv.id}`,
      authBody({ invoice_number: num, title, customer_id: parseInt(cust),
                 ...(verify ? { status: 'verified' } : {}) })), refresh);
  });
  row.querySelector('.cancel-inline-btn').addEventListener('click', refresh);
}

$('add-customer-btn').addEventListener('click', () => {
  const name = $('new-customer-name').value.trim();
  const notes = $('new-customer-notes').value.trim();
  if (!name) { alert('Customer name is required.'); return; }
  adminAction(() => api('POST', '/api/customers', authBody({ name, notes })), async () => {
    $('new-customer-name').value = '';
    $('new-customer-notes').value = '';
    await Promise.all([loadAdminCustomers(), refreshEverything()]);
  });
});

/* Merge */
let mergeSource = null;

function openMergeModal(c) {
  mergeSource = c;
  $('merge-label').textContent = `Merge "${c.name}" into…`;
  $('merge-target').innerHTML = adminCustomers
    .filter(x => x.id !== c.id && !x.is_system)
    .map(x => `<option value="${x.id}">${escHtml(x.name)}</option>`).join('');
  $('merge-error').classList.add('hidden');
  showOverlay('merge-overlay');
}

$('merge-cancel').addEventListener('click', () => showOverlay('admin-overlay'));
$('merge-ok').addEventListener('click', async () => {
  const into = parseInt($('merge-target').value);
  if (!into) { showMsg($('merge-error'), 'Pick a customer to merge into.'); return; }
  try {
    const res = await api('POST', `/api/customers/${mergeSource.id}/merge`, authBody({ into_id: into }));
    showOverlay('admin-overlay');
    alert(`Merged. ${res.entries_moved} entries and ${res.invoices_moved} invoices moved.`);
    await Promise.all([loadAdminCustomers(), refreshEverything(), loadReviewIfOpen()]);
    refreshReviewBadge();
  } catch (e) {
    showMsg($('merge-error'), e.message);
  }
});

/* CSV import */
$('csv-file-input').addEventListener('change', () => {
  const file = $('csv-file-input').files[0];
  $('csv-file-name').textContent = file ? file.name : 'Choose file…';
  $('import-csv-btn').disabled = !file;
  $('csv-result').className = 'hidden';
  $('csv-result').textContent = '';
});

$('import-csv-btn').addEventListener('click', async () => {
  const file = $('csv-file-input').files[0];
  if (!file) return;
  const result = $('csv-result');
  result.className = 'hidden';

  const form = new FormData();
  form.append('file', file);
  form.append('employee_id', state.employeeId);
  form.append('pin', state.pin);
  if ($('csv-deactivate-missing').checked) form.append('deactivate_missing', '1');

  try {
    const res = await fetch('/api/customers/import', { method: 'POST', body: form });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    const parts = [];
    const add = (n, label) => { if (n) parts.push(`${n} ${label}`); };
    add(d.customers_added, 'customers added');
    add(d.customers_updated, 'customers updated');
    add(d.invoices_added, 'invoices added');
    add(d.invoices_updated, 'invoices updated / verified');
    add(d.deactivated, 'invoices deactivated');
    add(d.unchanged, 'unchanged');
    add(d.conflicts, 'skipped (invoice number already under another customer)');
    add(d.skipped, 'rows skipped');
    result.textContent = `Done — ${parts.join(', ') || 'nothing to change'}.`;
    result.className = 'ok';
    $('csv-file-input').value = '';
    $('csv-file-name').textContent = 'Choose file…';
    $('import-csv-btn').disabled = true;
    $('csv-deactivate-missing').checked = false;
    await Promise.all([loadAdminCustomers(), refreshEverything()]);
    refreshReviewBadge();
  } catch (e) {
    result.textContent = e.message;
    result.className = 'err';
  }
});

/* ── Admin: Needs Review ─────────────────────────────────────────────────── */
async function refreshReviewBadge() {
  try {
    const d = await api('GET', `/api/admin/review?${authQ()}`);
    const n = d.customers.length + d.invoices.length + d.not_listed_entries.length;
    for (const id of ['review-badge', 'admin-badge']) {
      $(id).textContent = n;
      $(id).classList.toggle('hidden', !n);
    }
  } catch { /* badge is best-effort */ }
}

function loadReviewIfOpen() {
  return $('tab-review').classList.contains('active') ? loadReview() : Promise.resolve();
}

async function loadReview() {
  const body = $('review-body');
  body.innerHTML = '<p class="hint">Loading…</p>';
  let d;
  try {
    d = await api('GET', `/api/admin/review?${authQ()}`);
  } catch (e) {
    body.innerHTML = `<p class="error-msg">${escHtml(e.message)}</p>`;
    return;
  }
  const n = d.customers.length + d.invoices.length + d.not_listed_entries.length;
  for (const id of ['review-badge', 'admin-badge']) {
    $(id).textContent = n;
    $(id).classList.toggle('hidden', !n);
  }
  const refresh = async () => { await Promise.all([loadReview(), loadAdminCustomers(), refreshEverything()]); };

  body.innerHTML = '';
  if (!n) { body.innerHTML = '<p class="empty-row">Nothing needs review — everything looks good.</p>'; return; }

  /* Pending customers */
  if (d.customers.length) {
    body.insertAdjacentHTML('beforeend', `<h4 class="cd-sub">Customer requests (${d.customers.length})</h4>`);
    d.customers.forEach(c => {
      const div = document.createElement('div');
      div.className = 'admin-item review-item';
      div.innerHTML = `
        <span class="item-name">${escHtml(c.name)}</span>
        <span class="item-meta">requested by ${escHtml(c.created_by_name || '?')} on ${escHtml((c.created_at || '').slice(0, 10))}
          · ${c.entry_count} entr${c.entry_count === 1 ? 'y' : 'ies'} (${fmtHours(c.hours)} hrs) · ${c.invoice_count} invoice${c.invoice_count === 1 ? '' : 's'}</span>
        <div class="item-actions">
          <button class="btn btn-sm btn-primary" data-act="verify">Approve</button>
          <button class="btn btn-sm btn-secondary" data-act="rename">Rename &amp; approve</button>
          <button class="btn btn-sm btn-secondary" data-act="merge">Merge into existing…</button>
          ${c.entry_count ? '' : '<button class="btn btn-sm btn-danger" data-act="decline">Decline</button>'}
        </div>`;
      body.appendChild(div);
      const decline = div.querySelector('[data-act="decline"]');
      if (decline) decline.addEventListener('click', () => {
        if (!confirm(`Decline the request for "${c.name}"?`)) return;
        adminAction(() => api('DELETE', `/api/customers/${c.id}`, authBody()), refresh);
      });
      div.querySelector('[data-act="verify"]').addEventListener('click', () =>
        adminAction(() => api('PUT', `/api/customers/${c.id}`, authBody({ status: 'verified' })), refresh));
      div.querySelector('[data-act="rename"]').addEventListener('click', () => {
        const name = prompt('Customer name to approve:', c.name);
        if (!name || !name.trim()) return;
        adminAction(() => api('PUT', `/api/customers/${c.id}`, authBody({ name: name.trim(), status: 'verified' })), refresh);
      });
      div.querySelector('[data-act="merge"]').addEventListener('click', () => {
        const full = adminCustomers.find(x => x.id === c.id) || c;
        openMergeModal(full);
      });
    });
  }

  /* Pending invoices */
  if (d.invoices.length) {
    body.insertAdjacentHTML('beforeend', `<h4 class="cd-sub">New invoices (${d.invoices.length})</h4>`);
    d.invoices.forEach(i => {
      const div = document.createElement('div');
      div.className = 'admin-item review-item';
      div.innerHTML = `
        <span class="item-name">${escHtml(i.invoice_number)}</span>
        <span class="item-meta">${escHtml(i.customer_name)} · added by ${escHtml(i.created_by_name || '?')} on ${escHtml((i.created_at || '').slice(0, 10))}
          · ${i.entry_count} entr${i.entry_count === 1 ? 'y' : 'ies'} (${fmtHours(i.hours)} hrs)</span>
        <div class="item-actions">
          <button class="btn btn-sm btn-primary" data-act="verify">Verify</button>
          <button class="btn btn-sm btn-secondary" data-act="edit">Fix…</button>
        </div>`;
      body.appendChild(div);
      div.querySelector('[data-act="verify"]').addEventListener('click', () =>
        adminAction(() => api('PUT', `/api/invoices/${i.id}`, authBody({ status: 'verified' })), refresh));
      div.querySelector('[data-act="edit"]').addEventListener('click', () => {
        const inv = { id: i.id, invoice_number: i.invoice_number, title: i.title, customer_id: i.customer_id };
        editInvoiceInline(div, inv, refresh, { verify: true });
      });
    });
  }

  /* Not Listed entries */
  if (d.not_listed_entries.length) {
    body.insertAdjacentHTML('beforeend',
      `<h4 class="cd-sub">Time logged as “Not Listed” (${d.not_listed_entries.length})</h4>`);
    d.not_listed_entries.forEach(e => {
      const div = document.createElement('div');
      div.className = 'admin-item flagged-entry-item';
      div.innerHTML = `
        <div class="flagged-meta">
          <span class="flagged-date">${e.entry_date}</span>
          <span class="flagged-employee">${escHtml(e.employee_name)}</span>
          <span class="flagged-hours">${e.hours}h</span>
          <span>${escHtml(e.customer_name)}${e.invoice_number ? ' · ' + escHtml(e.invoice_number) : ''}</span>
        </div>
        <div class="flagged-original">
          <span class="flagged-original-label">Employee noted:</span>
          <span class="flagged-original-value">${escHtml(e.notes)}</span>
        </div>
        <div class="flagged-fields">
          <label class="flagged-label">Correct task
            <select class="flagged-task-select">
              <option value="">— choose a task —</option>
              ${d.active_tasks.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="item-actions"><button class="btn btn-sm btn-primary save-flagged-btn">Save</button></div>
        <div class="flagged-msg hidden"></div>`;
      body.appendChild(div);
      const msg = div.querySelector('.flagged-msg');
      div.querySelector('.save-flagged-btn').addEventListener('click', async () => {
        const task = div.querySelector('.flagged-task-select').value;
        if (!task) { msg.textContent = 'Choose the correct task.'; msg.className = 'flagged-msg err'; return; }
        try {
          await api('PUT', `/api/entries/${e.id}`, authBody({ task_name: task }));
          await refresh();
        } catch (err) {
          msg.textContent = err.message;
          msg.className = 'flagged-msg err';
        }
      });
    });
  }
}

$('refresh-review-btn').addEventListener('click', loadReview);

/* ── Admin: History (audit log) ──────────────────────────────────────────── */
const HIST_PAGE = 100;
let histOffset = 0;
let histDebounce = null;

function histQuery(offset) {
  const p = new URLSearchParams();
  p.set('employee_id', state.employeeId);
  p.set('pin', state.pin);
  p.set('limit', HIST_PAGE);
  p.set('offset', offset);
  const map = { q: 'hist-q', entity_type: 'hist-type', action: 'hist-action',
                actor_id: 'hist-actor', date_from: 'hist-from', date_to: 'hist-to' };
  for (const [k, id] of Object.entries(map)) if ($(id).value) p.set(k, $(id).value);
  return p.toString();
}

async function loadHistory(reset) {
  const list = $('hist-list');
  if (reset) {
    histOffset = 0;
    list.innerHTML = '<p class="hint">Loading…</p>';
    const sel = $('hist-actor');
    if (sel.options.length <= 1) {
      try {
        const emps = await api('GET', `/api/admin/employees?${authQ()}`);
        emps.forEach(e => sel.insertAdjacentHTML('beforeend', `<option value="${e.id}">${escHtml(e.name)}</option>`));
      } catch { /* filter stays "Anyone" */ }
    }
  }
  let data;
  try {
    data = await api('GET', `/api/admin/audit?${histQuery(histOffset)}`);
  } catch (e) {
    list.innerHTML = `<p class="error-msg">${escHtml(e.message)}</p>`;
    return;
  }
  if (reset) list.innerHTML = '';
  if (reset && !data.rows.length) {
    list.innerHTML = '<p class="empty-row">No history matches these filters.</p>';
  } else {
    const holder = document.createElement('div');
    renderHistory(data.rows, holder, { showItem: true });
    while (holder.firstChild) list.appendChild(holder.firstChild);
  }
  histOffset += data.rows.length;
  $('hist-count').textContent = `Showing ${Math.min(histOffset, data.total)} of ${data.total} changes`;
  $('hist-more').classList.toggle('hidden', histOffset >= data.total);
}

['hist-type', 'hist-action', 'hist-actor', 'hist-from', 'hist-to'].forEach(id =>
  $(id).addEventListener('change', () => loadHistory(true)));
$('hist-q').addEventListener('input', () => {
  clearTimeout(histDebounce);
  histDebounce = setTimeout(() => loadHistory(true), 300);
});
$('hist-refresh').addEventListener('click', () => loadHistory(true));
$('hist-more').addEventListener('click', () => loadHistory(false));

/* ── Admin: Tasks ────────────────────────────────────────────────────────── */
async function loadAdminTasks() {
  const tasks = await api('GET', '/api/tasks?all=1');
  const list = $('tasks-list');
  list.innerHTML = '';
  const reload = async () => { await Promise.all([loadAdminTasks(), loadTasks()]); };
  tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = `admin-item ${t.active ? '' : 'inactive'}`;
    const isSystem = t.name === 'Not Listed';
    div.innerHTML = `
      <span class="item-name">${escHtml(t.name)}${isSystem ? ' <span class="system-badge">System</span>' : ''}</span>
      <span class="item-meta">${escHtml(t.category)}</span>
      <div class="item-actions">
        <button class="toggle-btn ${t.active ? 'active' : 'inactive'}" data-act="toggle">${t.active ? 'Active' : 'Inactive'}</button>
        ${isSystem ? '' : `<button class="btn btn-sm btn-secondary" data-act="edit">Edit</button>
        <button class="btn btn-sm btn-danger" data-act="delete">Delete</button>`}
      </div>`;
    list.appendChild(div);
    const on = (act, fn) => { const b = div.querySelector(`[data-act="${act}"]`); if (b) b.addEventListener('click', fn); };
    on('toggle', () => adminAction(() => api('PUT', `/api/tasks/${t.id}`,
      authBody({ name: t.name, category: t.category, active: t.active ? 0 : 1 })), reload));
    on('edit', () => {
      div.innerHTML = `
        <input class="edit-inline-input" value="${escHtml(t.name)}" placeholder="Task name" style="flex:2" />
        <input class="edit-inline-input" value="${escHtml(t.category)}" placeholder="Category" style="flex:1" />
        <div class="item-actions">
          <button class="btn btn-sm btn-primary save-inline-btn">Save</button>
          <button class="btn btn-sm btn-secondary cancel-inline-btn">Cancel</button>
        </div>`;
      div.querySelector('.save-inline-btn').addEventListener('click', () => {
        const [name, category] = [...div.querySelectorAll('.edit-inline-input')].map(i => i.value.trim());
        if (!name || !category) { alert('Task name and category are required.'); return; }
        adminAction(() => api('PUT', `/api/tasks/${t.id}`, authBody({ name, category, active: t.active })), reload);
      });
      div.querySelector('.cancel-inline-btn').addEventListener('click', loadAdminTasks);
    });
    on('delete', () => openDeleteConfirm(`/api/tasks/${t.id}`, t.name,
      'Existing time entries keep their recorded task name, category, and hours. The task is removed and cannot be restored.',
      reload));
  });
}

$('add-task-btn').addEventListener('click', () => {
  const name = $('new-task-name').value.trim();
  const category = $('new-task-category').value.trim();
  if (!name || !category) { alert('Task name and category are required.'); return; }
  adminAction(() => api('POST', '/api/tasks', authBody({ name, category })), async () => {
    $('new-task-name').value = '';
    $('new-task-category').value = '';
    await Promise.all([loadAdminTasks(), loadTasks()]);
  });
});

/* ── Admin: Employees ────────────────────────────────────────────────────── */
async function loadAdminEmployees() {
  const [emps, roles] = await Promise.all([
    api('GET', `/api/admin/employees?${authQ()}`),
    api('GET', '/api/roles'),
  ]);

  const newEmpRole = $('new-emp-role');
  const prevNewRole = newEmpRole.value;
  newEmpRole.innerHTML = '<option value="">— No role (all tasks) —</option>' +
    roles.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');
  newEmpRole.value = prevNewRole;

  const list = $('employees-list');
  list.innerHTML = '';
  emps.forEach(e => {
    const div = document.createElement('div');
    div.className = `admin-item ${e.active ? '' : 'inactive'}`;
    div.innerHTML = `
      <span class="item-name">${escHtml(e.name)}</span>
      <span class="item-meta">${e.is_admin ? 'Admin' : 'Employee'}</span>
      <select class="role-select emp-role-select">
        <option value="" ${!e.role_id ? 'selected' : ''}>No role</option>
        ${roles.map(r => `<option value="${r.id}" ${e.role_id === r.id ? 'selected' : ''}>${escHtml(r.name)}</option>`).join('')}
      </select>
      <div class="item-actions">
        <button class="btn btn-sm btn-secondary" data-act="pin">Reset PIN</button>
        <button class="toggle-btn ${e.active ? 'active' : 'inactive'}" data-act="toggle">${e.active ? 'Active' : 'Inactive'}</button>
      </div>`;
    list.appendChild(div);
    const update = extra => api('PUT', `/api/admin/employees/${e.id}`, authBody({
      name: e.name, is_admin: e.is_admin, active: e.active, role_id: e.role_id || null, ...extra }));
    div.querySelector('.emp-role-select').addEventListener('change', ev =>
      adminAction(() => update({ role_id: ev.target.value || null })));
    div.querySelector('[data-act="pin"]').addEventListener('click', () => {
      const newPin = prompt(`Enter new PIN for ${e.name}:`);
      if (!newPin) return;
      adminAction(() => update({ new_pin: newPin }).then(() => alert('PIN updated.')));
    });
    div.querySelector('[data-act="toggle"]').addEventListener('click', () =>
      adminAction(() => update({ active: e.active ? 0 : 1 }), loadAdminEmployees));
  });
}

$('add-emp-btn').addEventListener('click', () => {
  const name    = $('new-emp-name').value.trim();
  const pin     = $('new-emp-pin').value.trim();
  const admin   = $('new-emp-admin').checked ? 1 : 0;
  const role_id = $('new-emp-role').value || null;
  if (!name || !pin) { alert('Name and PIN are required.'); return; }
  adminAction(() => api('POST', '/api/admin/employees', authBody({ name, new_pin: pin, is_admin: admin, role_id })),
    async () => {
      $('new-emp-name').value = '';
      $('new-emp-pin').value = '';
      $('new-emp-admin').checked = false;
      $('new-emp-role').value = '';
      await Promise.all([loadAdminEmployees(), loadEmployeeList()]);
    });
});

/* ── Admin: Roles ────────────────────────────────────────────────────────── */
async function loadAdminRoles() {
  const roles = await api('GET', '/api/roles');
  const list = $('roles-list');
  list.innerHTML = roles.length ? '' :
    '<p style="color:var(--gray-400);font-size:.85rem;padding:.5rem 0">No roles yet. Add one above.</p>';

  roles.forEach(role => {
    const div = document.createElement('div');
    div.className = 'admin-item';
    div.innerHTML = `
      <span class="item-name">${escHtml(role.name)}</span>
      <div class="item-actions">
        <button class="btn btn-sm btn-outline" data-act="tasks">Edit Tasks</button>
        <button class="btn btn-sm btn-secondary" data-act="rename">Rename</button>
        <button class="btn btn-sm btn-danger" data-act="delete">Delete</button>
      </div>`;
    list.appendChild(div);
    const on = (act, fn) => div.querySelector(`[data-act="${act}"]`).addEventListener('click', fn);
    on('tasks', ev => openRoleTasksPanel(role.id, role.name, ev.currentTarget));
    on('rename', () => {
      div.innerHTML = `
        <input class="edit-inline-input" value="${escHtml(role.name)}" placeholder="Role name" style="flex:1" />
        <div class="item-actions">
          <button class="btn btn-sm btn-primary save-inline-btn">Save</button>
          <button class="btn btn-sm btn-secondary cancel-inline-btn">Cancel</button>
        </div>`;
      div.querySelector('.save-inline-btn').addEventListener('click', () => {
        const name = div.querySelector('.edit-inline-input').value.trim();
        if (!name) { alert('Role name is required.'); return; }
        adminAction(() => api('PUT', `/api/roles/${role.id}`, authBody({ name })), loadAdminRoles);
      });
      div.querySelector('.cancel-inline-btn').addEventListener('click', loadAdminRoles);
    });
    on('delete', () => openDeleteConfirm(`/api/roles/${role.id}`, role.name,
      'Employees assigned this role will lose their task restriction and see all tasks.',
      async () => { await Promise.all([loadAdminRoles(), loadAdminEmployees()]); }));
  });
}

async function openRoleTasksPanel(roleId, roleName, triggerBtn) {
  document.querySelectorAll('.role-tasks-panel').forEach(p => p.remove());

  const [assignedIds, allTasks] = await Promise.all([
    api('GET', `/api/roles/${roleId}/tasks`),
    api('GET', '/api/tasks'),
  ]);
  const byCategory = {};
  allTasks.filter(t => t.active && t.name !== 'Not Listed').forEach(t => {
    (byCategory[t.category] = byCategory[t.category] || []).push(t);
  });

  const panel = document.createElement('div');
  panel.className = 'role-tasks-panel';
  panel.innerHTML = `
    <div style="font-size:.85rem;font-weight:600;color:var(--gray-700)">
      Tasks allowed for <strong>${escHtml(roleName)}</strong>
      <span class="hint"> — "Not Listed" is always visible to all roles</span>
    </div>
    <div class="task-checklist"></div>
    <div class="role-tasks-actions">
      <button class="btn btn-sm btn-secondary" data-act="all">Select All</button>
      <button class="btn btn-sm btn-secondary" data-act="none">Clear All</button>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-primary" data-act="save">Save</button>
      <button class="btn btn-sm btn-secondary" data-act="cancel">Cancel</button>
    </div>`;

  const checklist = panel.querySelector('.task-checklist');
  Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b)).forEach(([cat, tasks]) => {
    const group = document.createElement('div');
    group.className = 'task-category-group';
    group.innerHTML = `<div class="task-category-label">${escHtml(cat)}</div>`;
    tasks.forEach(t => {
      const label = document.createElement('label');
      label.className = 'task-check-label';
      label.innerHTML = `<input type="checkbox" value="${t.id}" ${assignedIds.includes(t.id) ? 'checked' : ''} /> ${escHtml(t.name)}`;
      group.appendChild(label);
    });
    checklist.appendChild(group);
  });

  const close = () => { panel.remove(); triggerBtn.textContent = 'Edit Tasks'; };
  const act = (name, fn) => panel.querySelector(`[data-act="${name}"]`).addEventListener('click', fn);
  act('all',  () => panel.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; }));
  act('none', () => panel.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; }));
  act('save', () => {
    const task_ids = [...panel.querySelectorAll('input[type=checkbox]:checked')].map(cb => parseInt(cb.value));
    adminAction(() => api('PUT', `/api/roles/${roleId}/tasks`, authBody({ task_ids })), close);
  });
  act('cancel', close);

  triggerBtn.textContent = 'Close';
  triggerBtn.closest('.admin-item').insertAdjacentElement('afterend', panel);
}

$('add-role-btn').addEventListener('click', () => {
  const name = $('new-role-name').value.trim();
  if (!name) { alert('Role name is required.'); return; }
  adminAction(() => api('POST', '/api/roles', authBody({ name })), async () => {
    $('new-role-name').value = '';
    await Promise.all([loadAdminRoles(), loadAdminEmployees()]);
  });
});

/* ── Export ──────────────────────────────────────────────────────────────── */
$('export-this-week-btn').addEventListener('click', () => {
  const { from, to } = getWeekRange();
  $('export-from').value = from;
  $('export-to').value   = to;
});

$('export-btn').addEventListener('click', () => {
  const from = $('export-from').value;
  const to   = $('export-to').value;
  window.location.href = `/api/export?${authQ()}`
    + (from ? `&date_from=${from}` : '')
    + (to   ? `&date_to=${to}`     : '')
    + ($('export-include-log').checked ? '&include_log=1' : '');
});
