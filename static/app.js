/* ── Login ───────────────────────────────────────────────────────────────── */
async function loadEmployeeList() {
  const list = await api('GET', '/api/employees');
  const sel = $('login-employee');
  sel.innerHTML = '<option value="">— Select employee —</option>';
  list.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.name;
    sel.appendChild(opt);
  });
}

$('pin-toggle').addEventListener('click', () => {
  const inp = $('login-pin');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('login-btn').addEventListener('click', async () => {
  const empId = parseInt($('login-employee').value);
  const pin   = $('login-pin').value;
  if (!empId) { showMsg($('login-error'), 'Please select your name.'); return; }
  if (!pin)   { showMsg($('login-error'), 'Please enter your PIN.'); return; }
  let res;
  try {
    res = await api('POST', '/api/auth', { employee_id: empId, pin });
  } catch {
    showMsg($('login-error'), 'Incorrect PIN. Please try again.');
    return;
  }
  state.employeeId     = empId;
  state.employeeName   = res.name;
  state.pin            = pin;
  state.isAdmin        = res.is_admin;
  state.allowedTaskIds = res.allowed_task_ids || null;
  hideOverlay('pin-overlay');
  $('app').classList.remove('hidden');
  $('header-name').textContent = res.name;
  $('admin-btn').style.display = res.is_admin ? '' : 'none';
  $('login-pin').value = '';
  $('login-error').classList.add('hidden');
  setView('log');
  logFields.reset();
  try {
    await Promise.all([loadCustomers(), loadInvoices(), loadTasks()]);
    await Promise.all([loadEntries(), loadRecentCustomers()]);
    if (state.isAdmin) refreshReviewBadge();
  } catch (e) {
    showMsg($('entry-error'), `Could not load data: ${e.message}`);
  }
});

$('login-pin').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('login-btn').click();
});

/* ── Switch user ─────────────────────────────────────────────────────────── */
$('switch-user-btn').addEventListener('click', () => {
  Object.assign(state, { employeeId: null, pin: null, isAdmin: false, customers: [],
                         invoices: [], entries: [], allowedTaskIds: null });
  selectedCustomerId = null;
  $('customer-detail').innerHTML = '<p class="empty-row">Select a customer to see their invoices, hours and activity.</p>';
  $('app').classList.add('hidden');
  $('login-pin').value = '';
  showOverlay('pin-overlay');
  loadEmployeeList();
});

/* ── Change PIN ──────────────────────────────────────────────────────────── */
$('change-pin-btn').addEventListener('click', () => {
  $('change-old-pin').value = '';
  $('change-new-pin').value = '';
  $('change-confirm-pin').value = '';
  $('change-pin-error').classList.add('hidden');
  $('change-pin-success').classList.add('hidden');
  showOverlay('change-pin-overlay');
});

$('change-pin-cancel-btn').addEventListener('click', () => hideOverlay('change-pin-overlay'));

$('change-pin-save-btn').addEventListener('click', async () => {
  const oldPin     = $('change-old-pin').value;
  const newPin     = $('change-new-pin').value;
  const confirmPin = $('change-confirm-pin').value;
  const errEl = $('change-pin-error');
  const okEl  = $('change-pin-success');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');

  if (!oldPin) { showMsg(errEl, 'Please enter your current PIN.'); return; }
  if (!newPin) { showMsg(errEl, 'Please enter a new PIN.'); return; }
  if (newPin !== confirmPin) { showMsg(errEl, 'New PINs do not match.'); return; }

  try {
    await api('POST', `/api/employees/${state.employeeId}/change-pin`, {
      old_pin: oldPin,
      new_pin: newPin,
    });
    state.pin = newPin;
    showMsg(okEl, 'PIN changed successfully!', 'success');
    setTimeout(() => hideOverlay('change-pin-overlay'), 1500);
  } catch (e) {
    showMsg(errEl, e.message);
  }
});

/* ── Views (Log Time / Customers) ────────────────────────────────────────── */
function setView(name) {
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  $('view-log').classList.toggle('hidden', name !== 'log');
  $('view-customers').classList.toggle('hidden', name !== 'customers');
  if (name === 'customers') renderCustomerCards();
}

document.querySelectorAll('.nav-btn').forEach(b =>
  b.addEventListener('click', () => setView(b.dataset.view)));

/* ── Init ────────────────────────────────────────────────────────────────── */
async function init() {
  await loadEmployeeList();
  showOverlay('pin-overlay');
  $('filter-from').value = today();
  $('filter-to').value   = today();
  initEntryForms();
}

init();
