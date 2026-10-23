/* ── Entry fields: one form definition used by both "Log Time" and "Edit" ── */
/**
 * Builds the date / customer / invoice / task / hours / notes fields inside
 * `mountId`, using `p` as an id prefix. Customer is required; invoices are
 * optional and may be typed in when they aren't in the system yet.
 *
 * `multi` lets the user attach several invoices (and split hours between them).
 */
function createEntryFields(p, mountId, { multi }) {
  const mount = $(mountId);
  mount.innerHTML = `
    <div class="field">
      <label for="${p}date">Date</label>
      <input type="date" id="${p}date" />
    </div>
    <div></div>

    <div class="field full-span">
      <label>Customer <span class="required">*</span></label>
      <div class="combo-wrap">
        <input type="text" id="${p}customer" placeholder="Search customers, or type a new one…" autocomplete="off" />
        <ul class="combo-list hidden" id="${p}customer-list"></ul>
      </div>
      <div class="cust-info hidden" id="${p}cust-info"></div>
    </div>

    <div class="field full-span">
      <label>Invoice # <span class="hint">(optional — type one that isn't in the system yet if needed)</span></label>
      <div class="combo-wrap">
        <div class="tag-field" id="${p}invoice-tags">
          <input type="text" id="${p}invoice" placeholder="Select a customer first" autocomplete="off" disabled />
        </div>
        <ul class="combo-list hidden" id="${p}invoice-list"></ul>
      </div>
      <div class="hint" id="${p}invoice-note"></div>
    </div>

    ${multi ? `
    <div class="field full-span" id="${p}split-wrap" style="display:none">
      <label class="checkbox-label">
        <input type="checkbox" id="${p}split" />
        <strong>Split hours</strong> — divide the hours equally between the selected invoices
      </label>
    </div>` : ''}

    <div class="field">
      <label for="${p}task">Task <span class="required">*</span>
        <span class="hint">— if not listed, select <strong>Not Listed</strong> and describe in Notes</span>
      </label>
      <div class="combo-wrap">
        <input type="text" id="${p}task" placeholder="Search task…" autocomplete="off" />
        <ul class="combo-list hidden" id="${p}task-list"></ul>
      </div>
    </div>

    <div class="field">
      <label for="${p}category">Category</label>
      <input type="text" id="${p}category" readonly placeholder="Auto-filled from task selection" />
    </div>

    <div class="field">
      <label for="${p}hours">Hours <span class="required">*</span></label>
      <div class="hours-wrap">
        <input type="number" id="${p}hours" min="0.25" max="24" step="0.25" placeholder="0.00" />
        <div class="quick-hours" id="${p}quick"></div>
      </div>
    </div>

    <div class="field full-span">
      <label id="${p}notes-label" for="${p}notes">Notes <span class="hint">(optional)</span></label>
      <textarea id="${p}notes" rows="2" placeholder="Any additional notes…"></textarea>
    </div>`;

  buildQuickHours(`${p}quick`, `${p}hours`);

  // Current selections
  let customer = null;   // {id, name, …} | {_new: 'typed name'} | null
  let invoices = [];     // [{id, invoice_number, …} | {_new: '1234'}]
  let task = null;

  const customerInput = $(`${p}customer`);
  const invoiceInput  = $(`${p}invoice`);

  /* ---- customer ---- */
  function customerInvoices() {
    return customer && customer.id
      ? state.invoices.filter(i => i.customer_id === customer.id)
      : [];
  }

  function setCustomer(c) {
    const changed = (customer && customer.id) !== (c && c.id) ||
                    (customer && customer._new) !== (c && c._new);
    customer = c;
    customerInput.value = c ? (c._new || c.name) : '';
    if (changed) invoices = [];
    renderCustomerInfo();
    renderInvoices();
  }

  function renderCustomerInfo() {
    const box = $(`${p}cust-info`);
    if (!customer) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (customer._new) {
      box.className = 'cust-info new';
      box.textContent = 'New customer — it will be added to the system and flagged for admin review.';
      return;
    }
    const full = state.customers.find(c => c.id === customer.id) || customer;
    const parts = [];
    if (full.is_system) parts.push('Internal shop work');
    if (full.status === 'pending') parts.push('Pending admin review');
    parts.push(`${full.invoice_count ?? customerInvoices().length} open invoice${(full.invoice_count ?? 0) === 1 ? '' : 's'}`);
    if (full.entry_count !== undefined) {
      parts.push(full.entry_count
        ? `${fmtHours(full.total_hours)} hrs logged${state.isAdmin ? '' : ' by you'} · last ${full.last_entry}`
        : 'no time logged yet');
    }
    box.className = 'cust-info';
    box.textContent = parts.join(' · ');
  }

  makeCombo({
    inputId: `${p}customer`, listId: `${p}customer-list`,
    items: () => state.customers,
    getLabel: c => c._new || c.name,
    getSub: c => c.is_system ? 'internal' : (c.status === 'pending' ? 'pending review'
              : (c.invoice_count ? `${c.invoice_count} invoice${c.invoice_count === 1 ? '' : 's'}` : '')),
    clearOnFocus: true, setInputOnSelect: false,
    extra: q => {
      const exact = state.customers.some(c => c.name.toLowerCase() === q.toLowerCase());
      return q.length >= 2 && !exact ? { _new: q.replace(/\s+/g, ' ') } : null;
    },
    extraLabel: x => `+ Add "${x._new}" as a new customer`,
    onSelect: setCustomer,
  });

  /* ---- invoices ---- */
  function renderInvoices() {
    const tagsBox = $(`${p}invoice-tags`);
    tagsBox.querySelectorAll('.job-tag').forEach(t => t.remove());
    invoices.forEach((inv, idx) => {
      const tag = document.createElement('span');
      tag.className = 'job-tag' + (inv._new || inv.status === 'pending' ? ' is-new' : '');
      tag.textContent = inv._new || inv.invoice_number;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '✕';
      rm.addEventListener('click', () => { invoices.splice(idx, 1); renderInvoices(); });
      tag.appendChild(rm);
      tagsBox.insertBefore(tag, invoiceInput);
    });
    invoiceInput.disabled = !customer;
    invoiceInput.placeholder = !customer ? 'Select a customer first'
      : (invoices.length && !multi ? '' : 'Search this customer’s invoices, or type a number…');
    invoiceInput.style.display = (!multi && invoices.length) ? 'none' : '';
    $(`${p}invoice-note`).textContent = invoices.some(i => i._new)
      ? 'Invoice numbers not in the system yet will be added and flagged for admin review.' : '';
    if (multi) $(`${p}split-wrap`).style.display = invoices.length >= 2 ? '' : 'none';
  }

  function addInvoice(inv) {
    const key = inv._new ? inv._new.toLowerCase() : null;
    const dupe = invoices.some(i => inv.id ? i.id === inv.id
                                           : (i._new && i._new.toLowerCase() === key));
    if (!dupe) invoices = multi ? [...invoices, inv] : [inv];
    renderInvoices();
    invoiceInput.value = '';
  }

  makeCombo({
    inputId: `${p}invoice`, listId: `${p}invoice-list`,
    items: () => customerInvoices().filter(i => !invoices.some(s => s.id === i.id)),
    getLabel: i => i._new || i.invoice_number,
    getSub: i => [i.title, i.status === 'pending' ? 'pending review' : ''].filter(Boolean).join(' — '),
    getSearch: i => `${i.invoice_number} ${i.title || ''}`,
    clearOnFocus: true, setInputOnSelect: false,
    extra: q => {
      const lower = q.toLowerCase();
      if (customerInvoices().some(i => i.invoice_number.toLowerCase() === lower)) return null;
      const elsewhere = state.invoices.find(i => i.invoice_number.toLowerCase() === lower);
      if (elsewhere) return { _switch: elsewhere };
      return { _new: q };
    },
    extraLabel: x => x._switch
      ? `Invoice ${x._switch.invoice_number} belongs to ${x._switch.customer_name} — switch customer`
      : `+ Use "${x._new}" (not in the system yet)`,
    onSelect: x => {
      if (x._switch) {
        const target = state.customers.find(c => c.id === x._switch.customer_id);
        if (target) { setCustomer(target); addInvoice(x._switch); }
        return;
      }
      addInvoice(x);
    },
  });

  /* ---- task ---- */
  function updateNotesLabel() {
    const el = $(`${p}notes-label`);
    el.innerHTML = task && task.name === 'Not Listed'
      ? 'Describe the task <span class="required">*</span>'
      : 'Notes <span class="hint">(optional)</span>';
  }

  function setTask(t) {
    task = t;
    $(`${p}task`).value = t ? t.name : '';
    $(`${p}category`).value = t ? t.category : '';
    updateNotesLabel();
  }

  makeCombo({
    inputId: `${p}task`, listId: `${p}task-list`,
    items: () => getVisibleTasks(),
    getLabel: t => t.name, getSub: t => t.category,
    clearOnFocus: true, setInputOnSelect: false,
    onSelect: setTask,
  });

  /* ---- public API ---- */
  return {
    setCustomer,
    setInvoices(list) { invoices = list; renderInvoices(); },
    setTaskByName(name, category) {
      setTask(state.tasks.find(t => t.name === name) || { name, category });
    },
    reset({ keepCustomer = false, keepDate = false } = {}) {
      if (!keepDate) $(`${p}date`).value = today();
      if (!keepCustomer) setCustomer(null); else { invoices = []; renderInvoices(); }
      setTask(null);
      $(`${p}hours`).value = '';
      $(`${p}notes`).value = '';
      if (multi) $(`${p}split`).checked = false;
    },
    set(entry) {
      $(`${p}date`).value = entry.entry_date;
      setCustomer({ id: entry.customer_id, name: entry.customer_name, status: entry.customer_status });
      invoices = entry.invoice_id
        ? [{ id: entry.invoice_id, invoice_number: entry.invoice_number,
             title: entry.invoice_title, status: entry.invoice_status }]
        : [];
      renderInvoices();
      this.setTaskByName(entry.task_name, entry.category);
      $(`${p}hours`).value = entry.hours;
      $(`${p}notes`).value = entry.notes || '';
    },
    /** Returns an error message, or null when the form is complete. */
    validate() {
      if (!customer) return 'Please select a customer.';
      if (!task) return 'Please select a task.';
      const hours = parseFloat($(`${p}hours`).value);
      if (!hours || hours <= 0) return 'Please enter a valid number of hours.';
      if (task.name === 'Not Listed' && !$(`${p}notes`).value.trim()) {
        return 'Please describe the task in the Notes field.';
      }
      return null;
    },
    values() {
      const specs = invoices.map(i => i.id ? { id: i.id } : { number: i._new });
      const v = {
        entry_date: $(`${p}date`).value,
        task_name: task && task.name,
        hours: parseFloat($(`${p}hours`).value),
        notes: $(`${p}notes`).value.trim(),
        invoices: specs,
      };
      if (customer && customer.id) v.customer_id = customer.id;
      else if (customer) v.new_customer = customer._new;
      if (multi) v.split = $(`${p}split`).checked;
      return v;
    },
    hasNewThings() {
      return !!(customer && customer._new) || invoices.some(i => i._new);
    },
  };
}

/* ── Log Time view ───────────────────────────────────────────────────────── */
let logFields, editFields;

function initEntryForms() {
  logFields  = createEntryFields('f-', 'entry-fields', { multi: true });
  editFields = createEntryFields('e-', 'edit-fields', { multi: false });
  logFields.reset();
}

$('clear-btn').addEventListener('click', () => {
  logFields.reset();
  $('entry-error').classList.add('hidden');
  $('entry-success').classList.add('hidden');
});

$('submit-btn').addEventListener('click', async () => {
  const err = $('entry-error');
  const btn = $('submit-btn');
  err.classList.add('hidden');
  const problem = logFields.validate();
  if (problem) { showMsg(err, problem); return; }

  const hadNew = logFields.hasNewThings();
  btn.disabled = true;
  try {
    const res = await api('POST', '/api/entries', authBody(logFields.values()));
    const n = res.ids.length;
    showMsg($('entry-success'),
      `Saved ${n} entr${n === 1 ? 'y' : 'ies'}.` +
      (hadNew ? ' New customer / invoice added and flagged for admin review.' : ''), 'success');
    // Keep the customer and date: people usually log several tasks in a row.
    logFields.reset({ keepCustomer: true, keepDate: true });
    await Promise.all([loadCustomers(), loadInvoices(), loadEntries(), loadRecentCustomers()]);
    if (hadNew && state.isAdmin) refreshReviewBadge();
  } catch (e) {
    showMsg(err, e.message);
  } finally {
    btn.disabled = false;
  }
});

/* Recent-customer chips */
async function loadRecentCustomers() {
  const box = $('recent-customers');
  try {
    const rows = await api('GET', `/api/me/recent-customers?${authQ()}`);
    $('recent-customers-chips').innerHTML = '';
    rows.forEach(r => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = r.name;
      b.addEventListener('click', () => {
        const c = state.customers.find(x => x.id === r.id);
        if (c) logFields.setCustomer(c);
      });
      $('recent-customers-chips').appendChild(b);
    });
    box.classList.toggle('hidden', !rows.length);
  } catch { box.classList.add('hidden'); }
}

/* ── Load data ───────────────────────────────────────────────────────────── */
async function loadCustomers() {
  state.customers = await api('GET', `/api/customers?stats=1&${authQ()}`);
  const sel = $('filter-customer');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All customers</option>' +
    state.customers.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  sel.value = state.customers.some(c => String(c.id) === prev) ? prev : '';
  renderCustomerCards();
}

async function loadInvoices() {
  state.invoices = await api('GET', '/api/invoices');
}

async function loadTasks() {
  state.tasks = await api('GET', '/api/tasks');
}

async function loadEntries() {
  const from = $('filter-from').value;
  const to   = $('filter-to').value;
  const cust = $('filter-customer').value;
  let url = `/api/entries?${authQ()}`;
  if (from) url += `&date_from=${from}`;
  if (to)   url += `&date_to=${to}`;
  if (cust) url += `&customer_id=${cust}`;
  state.entries = await api('GET', url);
  renderEntries();
}

/* ── Entries table ───────────────────────────────────────────────────────── */
function renderEntries() {
  const tbody   = $('entries-body');
  const colSpan = state.isAdmin ? 8 : 7;
  tbody.innerHTML = '';
  $('col-employee').classList.toggle('hidden', !state.isAdmin);

  if (!state.entries.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="empty-row">No entries found.</td></tr>`;
    $('entries-total').textContent = '';
    return;
  }

  let total = 0;
  state.entries.forEach(e => {
    total += e.hours;
    const invoiceCell = e.invoice_number
      ? `<span title="${escHtml(e.invoice_title)}">${escHtml(e.invoice_number)}</span>${statusBadge(e.invoice_status)}`
      : '<span class="muted">—</span>';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.entry_date}</td>
      ${state.isAdmin ? `<td class="entry-employee">${escHtml(e.employee_name)}</td>` : ''}
      <td><button class="link-btn" data-customer="${e.customer_id}">${escHtml(e.customer_name)}</button>${statusBadge(e.customer_status)}</td>
      <td>${invoiceCell}</td>
      <td title="${escHtml(e.category)}">${escHtml(e.task_name)}</td>
      <td><strong>${e.hours}</strong></td>
      <td class="col-notes" title="${escHtml(e.notes)}">${escHtml(e.notes) || '—'}</td>
      <td class="row-actions">
        <button class="edit-btn" data-id="${e.id}">Edit</button>
        ${e.edit_count ? `<span class="edited-tag" title="Edited ${e.edit_count}×">edited${e.edit_count > 1 ? ' ×' + e.edit_count : ''}</span>` : ''}
      </td>`;
    tbody.appendChild(tr);
  });

  $('entries-total').textContent = `${state.entries.length} entries · ${round2(total)} hrs total`;

  tbody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id)));
  });
  tbody.querySelectorAll('.link-btn').forEach(btn => {
    btn.addEventListener('click', () => openCustomer(parseInt(btn.dataset.customer)));
  });
}

$('this-week-btn').addEventListener('click', () => {
  const { from, to } = getWeekRange();
  $('filter-from').value = from;
  $('filter-to').value   = to;
  loadEntries();
});
$('refresh-btn').addEventListener('click', loadEntries);
$('filter-customer').addEventListener('change', loadEntries);
$('filter-from').addEventListener('change', loadEntries);
$('filter-to').addEventListener('change', loadEntries);

/* ── Edit modal ──────────────────────────────────────────────────────────── */
async function openEditModal(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  $('edit-entry-id').value = id;
  editFields.set(entry);
  $('edit-error').classList.add('hidden');
  $('edit-history').innerHTML = '<p class="empty-row">Loading…</p>';
  showOverlay('edit-overlay');
  try {
    const rows = await api('GET', `/api/entries/${id}/history?${authQ()}`);
    renderHistory(rows.slice().reverse(), $('edit-history'));
  } catch (e) {
    $('edit-history').innerHTML = `<p class="empty-row">${escHtml(e.message)}</p>`;
  }
}

$('edit-cancel-btn').addEventListener('click', () => hideOverlay('edit-overlay'));

$('edit-save-btn').addEventListener('click', async () => {
  const err = $('edit-error');
  err.classList.add('hidden');
  const problem = editFields.validate();
  if (problem) { showMsg(err, problem); return; }
  const id = parseInt($('edit-entry-id').value);
  const { invoices, split, ...v } = editFields.values();
  try {
    await api('PUT', `/api/entries/${id}`, authBody({ ...v, invoice: invoices[0] || null }));
    hideOverlay('edit-overlay');
    await Promise.all([loadCustomers(), loadInvoices(), loadEntries()]);
    if (state.isAdmin) refreshReviewBadge();
  } catch (e) {
    showMsg(err, e.message);
  }
});

$('edit-delete-btn').addEventListener('click', async () => {
  if (!confirm('Delete this entry? The deletion is recorded in the change history.')) return;
  const id = parseInt($('edit-entry-id').value);
  try {
    await api('DELETE', `/api/entries/${id}`, authBody());
    hideOverlay('edit-overlay');
    await Promise.all([loadCustomers(), loadEntries()]);
  } catch (e) {
    showMsg($('edit-error'), e.message);
  }
});
