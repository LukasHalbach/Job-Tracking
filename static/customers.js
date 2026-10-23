/* ── Customers view ──────────────────────────────────────────────────────── */
let selectedCustomerId = null;

function renderCustomerCards() {
  const wrap = $('customer-cards');
  if (!wrap) return;
  const q = $('customer-search').value.trim().toLowerCase();
  const list = state.customers.filter(c => !q || c.name.toLowerCase().includes(q));
  if (!list.length) {
    wrap.innerHTML = '<p class="empty-row">No customers found.</p>';
    return;
  }
  wrap.innerHTML = '';
  list.forEach(c => {
    const div = document.createElement('button');
    div.type = 'button';
    div.className = 'customer-card' + (c.id === selectedCustomerId ? ' selected' : '');
    div.innerHTML = `
      <span class="cc-name">${escHtml(c.name)}${statusBadge(c.status)}${c.is_system ? ' <span class="system-badge">Internal</span>' : ''}</span>
      <span class="cc-meta">
        ${c.invoice_count} invoice${c.invoice_count === 1 ? '' : 's'} ·
        ${fmtHours(c.total_hours)} hrs${c.last_entry ? ' · last ' + c.last_entry : ''}
      </span>`;
    div.addEventListener('click', () => loadCustomerDetail(c.id));
    wrap.appendChild(div);
  });
}

$('customer-search').addEventListener('input', renderCustomerCards);

/** Jump to the Customers view with a customer's profile open. */
function openCustomer(id) {
  setView('customers');
  loadCustomerDetail(id);
}

async function loadCustomerDetail(id) {
  selectedCustomerId = id;
  renderCustomerCards();
  const box = $('customer-detail');
  box.innerHTML = '<p class="empty-row">Loading…</p>';
  let d;
  try {
    d = await api('GET', `/api/customers/${id}/detail?${authQ()}`);
  } catch (e) {
    box.innerHTML = `<p class="empty-row">${escHtml(e.message)}</p>`;
    return;
  }
  const c = d.customer;
  const maxTask = Math.max(...d.by_task.map(t => t.hours), 1);
  const scopeLabel = state.isAdmin ? 'all employees' : 'your entries';

  const invoiceRows = d.invoices.map(i => `
    <tr class="${i.active ? '' : 'row-inactive'}">
      <td><strong>${escHtml(i.invoice_number)}</strong>${statusBadge(i.status)}${i.active ? '' : ' <span class="status-badge inactive">inactive</span>'}</td>
      <td>${escHtml(i.title) || '<span class="muted">—</span>'}</td>
      <td class="num">${fmtHours(i.hours)}</td>
      <td class="num">${i.entries}</td>
      <td>${i.last_entry || '<span class="muted">—</span>'}</td>
    </tr>`).join('');
  const noInvoiceRow = d.no_invoice.entries ? `
    <tr class="row-general">
      <td colspan="2"><em>No invoice (general customer time)</em></td>
      <td class="num">${fmtHours(d.no_invoice.hours)}</td>
      <td class="num">${d.no_invoice.entries}</td>
      <td></td>
    </tr>` : '';

  box.innerHTML = `
    <div class="cd-head">
      <div>
        <h3 class="card-title">${escHtml(c.name)}${statusBadge(c.status)}
          ${c.is_system ? '<span class="system-badge">Internal</span>' : ''}
          ${c.active ? '' : '<span class="status-badge inactive">inactive</span>'}</h3>
        ${c.notes ? `<div class="hint">${escHtml(c.notes)}</div>` : ''}
      </div>
      ${c.active ? '<button class="btn btn-primary btn-sm" id="cd-log-btn">Log time for this customer</button>' : ''}
    </div>

    <div class="stat-tiles">
      <div class="stat"><div class="stat-num">${fmtHours(d.totals.hours)}</div><div class="stat-label">hours (${scopeLabel})</div></div>
      <div class="stat"><div class="stat-num">${d.totals.entries}</div><div class="stat-label">entries</div></div>
      <div class="stat"><div class="stat-num">${d.invoices.filter(i => i.active).length}</div><div class="stat-label">open invoices</div></div>
      <div class="stat"><div class="stat-num stat-small">${d.totals.last_entry || '—'}</div><div class="stat-label">last entry</div></div>
    </div>

    <h4 class="cd-sub">Invoices</h4>
    ${d.invoices.length || noInvoiceRow ? `
    <div class="table-scroll"><table class="entries-table cd-table">
      <thead><tr><th>Invoice</th><th>Title</th><th class="num">Hrs</th><th class="num">Entries</th><th>Last</th></tr></thead>
      <tbody>${invoiceRows}${noInvoiceRow}</tbody>
    </table></div>` : '<p class="empty-row">No invoices on file for this customer.</p>'}

    <h4 class="cd-sub">Hours by task</h4>
    ${d.by_task.length ? d.by_task.map(t => `
      <div class="bar-row" title="${escHtml(t.category)}">
        <span class="bar-label">${escHtml(t.task_name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(t.hours / maxTask) * 100}%"></span></span>
        <span class="bar-val">${fmtHours(t.hours)}</span>
      </div>`).join('') : '<p class="empty-row">No time logged yet.</p>'}

    ${state.isAdmin && d.by_employee.length ? `
      <h4 class="cd-sub">Hours by employee</h4>
      ${d.by_employee.map(t => `
        <div class="bar-row">
          <span class="bar-label">${escHtml(t.employee_name)}</span>
          <span class="bar-track"><span class="bar-fill alt" style="width:${(t.hours / d.by_employee[0].hours) * 100}%"></span></span>
          <span class="bar-val">${fmtHours(t.hours)}</span>
        </div>`).join('')}` : ''}

    <h4 class="cd-sub">Recent entries</h4>
    ${d.recent_entries.length ? `
    <div class="table-scroll"><table class="entries-table cd-table">
      <thead><tr><th>Date</th>${state.isAdmin ? '<th>Employee</th>' : ''}<th>Invoice</th><th>Task</th><th class="num">Hrs</th><th>Notes</th></tr></thead>
      <tbody>${d.recent_entries.map(e => `
        <tr>
          <td>${e.entry_date}</td>
          ${state.isAdmin ? `<td>${escHtml(e.employee_name)}</td>` : ''}
          <td>${e.invoice_number ? escHtml(e.invoice_number) : '<span class="muted">—</span>'}</td>
          <td>${escHtml(e.task_name)}</td>
          <td class="num"><strong>${e.hours}</strong></td>
          <td title="${escHtml(e.notes)}">${escHtml(e.notes) || '—'}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : '<p class="empty-row">No entries yet.</p>'}

    ${state.isAdmin ? `
      <h4 class="cd-sub">Recent changes</h4>
      <div class="history-list" id="cd-history"></div>` : ''}`;

  if (state.isAdmin) renderHistory(d.history, $('cd-history'), { showItem: true });
  const logBtn = $('cd-log-btn');
  if (logBtn) {
    logBtn.addEventListener('click', () => {
      setView('log');
      const full = state.customers.find(x => x.id === c.id);
      if (full) logFields.setCustomer(full);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}
