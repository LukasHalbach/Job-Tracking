/* ── State ───────────────────────────────────────────────────────────────── */
const state = {
  employeeId: null,
  employeeName: null,
  pin: null,
  isAdmin: false,
  jobs: [],
  tasks: [],
  entries: [],
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);

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

/* ── Combobox factory ────────────────────────────────────────────────────── */
function makeCombo({ inputId, listId, items, getLabel, getSub, onSelect, allowFreeText = false }) {
  const input = $(inputId);
  const list  = $(listId);
  let active = -1;
  let suppressBlur = false;

  function render(filter) {
    const q = filter.toLowerCase();
    const filtered = q
      ? items.filter(i => getLabel(i).toLowerCase().includes(q))
      : items;
    list.innerHTML = '';
    if (!filtered.length) { list.classList.add('hidden'); return; }
    filtered.slice(0, 60).forEach((item, idx) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = getLabel(item);
      li.appendChild(label);
      if (getSub) {
        const sub = document.createElement('span');
        sub.className = 'item-sub';
        sub.textContent = getSub(item);
        li.appendChild(sub);
      }
      li.addEventListener('mousedown', () => { suppressBlur = true; });
      li.addEventListener('click', () => {
        onSelect(item);
        input.value = getLabel(item);
        list.classList.add('hidden');
        suppressBlur = false;
      });
      list.appendChild(li);
    });
    active = -1;
    list.classList.remove('hidden');
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('blur', () => {
    if (suppressBlur) return;
    setTimeout(() => list.classList.add('hidden'), 150);
    if (allowFreeText && input.value.trim()) {
      onSelect({ _free: input.value.trim() });
    }
  });
  input.addEventListener('keydown', e => {
    const lis = list.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
      active = Math.min(active + 1, lis.length - 1);
    } else if (e.key === 'ArrowUp') {
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter' && active >= 0) {
      lis[active].click();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      list.classList.add('hidden');
    } else { return; }
    lis.forEach((li, i) => li.classList.toggle('active', i === active));
    if (lis[active]) lis[active].scrollIntoView({ block: 'nearest' });
  });

  return { refresh: () => render(input.value) };
}

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
  try {
    const res = await api('POST', '/api/auth', { employee_id: empId, pin });
    state.employeeId   = empId;
    state.employeeName = res.name;
    state.pin          = pin;
    state.isAdmin      = res.is_admin;
    hideOverlay('pin-overlay');
    $('app').classList.remove('hidden');
    $('header-name').textContent = res.name;
    $('admin-btn').style.display = res.is_admin ? '' : 'none';
    $('login-pin').value = '';
    $('login-error').classList.add('hidden');
    await Promise.all([loadJobs(), loadTasks()]);
    await loadEntries();
  } catch {
    showMsg($('login-error'), 'Incorrect PIN. Please try again.');
  }
});

$('login-pin').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('login-btn').click();
});

/* ── Switch user ─────────────────────────────────────────────────────────── */
$('switch-user-btn').addEventListener('click', () => {
  state.employeeId = null;
  state.pin = null;
  $('app').classList.add('hidden');
  $('login-pin').value = '';
  showOverlay('pin-overlay');
  loadEmployeeList();
});

/* ── Load data ───────────────────────────────────────────────────────────── */
async function loadJobs() {
  state.jobs = await api('GET', '/api/jobs');
  jobCombo.refresh();
  editJobCombo.refresh();
}

async function loadTasks() {
  state.tasks = await api('GET', '/api/tasks');
  taskCombo.refresh();
  editTaskCombo.refresh();
}

async function loadEntries() {
  const dateFilter = $('filter-date').value;
  let url = `/api/entries?employee_id=${state.employeeId}`;
  if (dateFilter) url += `&date_from=${dateFilter}&date_to=${dateFilter}`;
  state.entries = await api('GET', url);
  renderEntries();
}

/* ── Entry form combos ───────────────────────────────────────────────────── */
let jobCombo, taskCombo, editJobCombo, editTaskCombo;

function initCombos() {
  jobCombo = makeCombo({
    inputId: 'job-input',
    listId:  'job-list',
    items:   state.jobs,
    getLabel: j => j.job_number,
    getSub:   j => j.description || '',
    allowFreeText: true,
    onSelect: j => { $('job-input').value = j._free ?? j.job_number; },
  });

  taskCombo = makeCombo({
    inputId: 'task-input',
    listId:  'task-list',
    items:   state.tasks,
    getLabel: t => t.name,
    getSub:   t => t.category,
    onSelect: t => {
      $('task-input').value = t.name;
      $('category').value   = t.category;
      $('notes-wrap').classList.toggle('hidden', t.name !== 'Not Listed');
    },
  });

  editJobCombo = makeCombo({
    inputId: 'edit-job-input',
    listId:  'edit-job-list',
    items:   state.jobs,
    getLabel: j => j.job_number,
    getSub:   j => j.description || '',
    allowFreeText: true,
    onSelect: j => { $('edit-job-input').value = j._free ?? j.job_number; },
  });

  editTaskCombo = makeCombo({
    inputId: 'edit-task-input',
    listId:  'edit-task-list',
    items:   state.tasks,
    getLabel: t => t.name,
    getSub:   t => t.category,
    onSelect: t => {
      $('edit-task-input').value = t.name;
      $('edit-category').value   = t.category;
      $('edit-notes-wrap').classList.toggle('hidden', t.name !== 'Not Listed');
    },
  });
}

// Rebuild combos when data loads (items array is live reference so just re-init)
async function loadJobs() {
  state.jobs = await api('GET', '/api/jobs');
  if (jobCombo) {
    jobCombo = makeCombo({
      inputId: 'job-input', listId: 'job-list',
      items: state.jobs, getLabel: j => j.job_number, getSub: j => j.description || '',
      allowFreeText: true, onSelect: j => { $('job-input').value = j._free ?? j.job_number; },
    });
    editJobCombo = makeCombo({
      inputId: 'edit-job-input', listId: 'edit-job-list',
      items: state.jobs, getLabel: j => j.job_number, getSub: j => j.description || '',
      allowFreeText: true, onSelect: j => { $('edit-job-input').value = j._free ?? j.job_number; },
    });
  }
}

async function loadTasks() {
  state.tasks = await api('GET', '/api/tasks');
  if (taskCombo) {
    taskCombo = makeCombo({
      inputId: 'task-input', listId: 'task-list',
      items: state.tasks, getLabel: t => t.name, getSub: t => t.category,
      onSelect: t => {
        $('task-input').value = t.name;
        $('category').value   = t.category;
        $('notes-wrap').classList.toggle('hidden', t.name !== 'Not Listed');
      },
    });
    editTaskCombo = makeCombo({
      inputId: 'edit-task-input', listId: 'edit-task-list',
      items: state.tasks, getLabel: t => t.name, getSub: t => t.category,
      onSelect: t => {
        $('edit-task-input').value = t.name;
        $('edit-category').value   = t.category;
        $('edit-notes-wrap').classList.toggle('hidden', t.name !== 'Not Listed');
      },
    });
  }
}

/* ── Entry form ──────────────────────────────────────────────────────────── */
function clearForm() {
  $('entry-date').value   = today();
  $('job-input').value    = '';
  $('task-input').value   = '';
  $('category').value     = '';
  $('hours').value        = '';
  $('description').value  = '';
  $('notes').value        = '';
  $('notes-wrap').classList.add('hidden');
  $('entry-error').classList.add('hidden');
  $('entry-success').classList.add('hidden');
}

$('clear-btn').addEventListener('click', clearForm);

$('submit-btn').addEventListener('click', async () => {
  const err = $('entry-error');
  err.classList.add('hidden');
  const jobNumber = $('job-input').value.trim();
  const taskName  = $('task-input').value.trim();
  const category  = $('category').value.trim();
  const hours     = parseFloat($('hours').value);
  const desc      = $('description').value.trim();
  const notes     = $('notes').value.trim();
  const entryDate = $('entry-date').value;

  if (!jobNumber) { showMsg(err, 'Please enter a Job / Invoice number.'); return; }
  if (!taskName)  { showMsg(err, 'Please select a task.'); return; }
  if (!category)  { showMsg(err, 'Category could not be determined. Please re-select the task.'); return; }
  if (!hours || hours <= 0) { showMsg(err, 'Please enter a valid number of hours.'); return; }
  if (taskName === 'Not Listed' && !notes) { showMsg(err, 'Please describe the task in the Notes field.'); return; }

  try {
    await api('POST', '/api/entries', {
      employee_id: state.employeeId,
      pin: state.pin,
      entry_date: entryDate,
      job_number: jobNumber,
      task_name:  taskName,
      category,
      hours,
      description: desc,
      notes,
    });
    showMsg($('entry-success'), 'Entry saved successfully!', 'success');
    clearForm();
    await loadEntries();
  } catch (e) {
    showMsg(err, e.message);
  }
});

/* ── Entries table ───────────────────────────────────────────────────────── */
function renderEntries() {
  const tbody = $('entries-body');
  tbody.innerHTML = '';

  if (!state.entries.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No entries found.</td></tr>';
    $('entries-total').textContent = '';
    return;
  }

  let total = 0;
  state.entries.forEach(e => {
    total += e.hours;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.entry_date}</td>
      <td title="${e.job_number}">${e.job_number}</td>
      <td title="${e.task_name}">${e.task_name}</td>
      <td title="${e.category}">${e.category}</td>
      <td><strong>${e.hours}</strong></td>
      <td title="${e.description || ''}">${e.description || '—'}</td>
      <td title="${e.notes || ''}">${e.notes || '—'}</td>
      <td><button class="edit-btn" data-id="${e.id}">Edit</button></td>
    `;
    tbody.appendChild(tr);
  });

  $('entries-total').textContent = `${state.entries.length} entries · ${round2(total)} hrs total`;

  tbody.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id)));
  });
}

function round2(n) { return Math.round(n * 100) / 100; }

$('filter-date').addEventListener('change', loadEntries);
$('refresh-btn').addEventListener('click', loadEntries);

/* ── Edit modal ──────────────────────────────────────────────────────────── */
function openEditModal(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!entry) return;
  $('edit-entry-id').value     = id;
  $('edit-date').value         = entry.entry_date;
  $('edit-job-input').value    = entry.job_number;
  $('edit-task-input').value   = entry.task_name;
  $('edit-category').value     = entry.category;
  $('edit-hours').value        = entry.hours;
  $('edit-description').value  = entry.description || '';
  $('edit-notes').value        = entry.notes || '';
  $('edit-notes-wrap').classList.toggle('hidden', entry.task_name !== 'Not Listed');
  $('edit-error').classList.add('hidden');
  showOverlay('edit-overlay');
}

$('edit-cancel-btn').addEventListener('click', () => hideOverlay('edit-overlay'));

$('edit-save-btn').addEventListener('click', async () => {
  const id       = parseInt($('edit-entry-id').value);
  const jobNumber = $('edit-job-input').value.trim();
  const taskName  = $('edit-task-input').value.trim();
  const category  = $('edit-category').value.trim();
  const hours     = parseFloat($('edit-hours').value);
  const desc      = $('edit-description').value.trim();
  const notes     = $('edit-notes').value.trim();
  const entryDate = $('edit-date').value;
  const err = $('edit-error');
  err.classList.add('hidden');

  if (!jobNumber) { showMsg(err, 'Job number required.'); return; }
  if (!taskName)  { showMsg(err, 'Task required.'); return; }
  if (!hours || hours <= 0) { showMsg(err, 'Valid hours required.'); return; }

  try {
    await api('PUT', `/api/entries/${id}`, {
      employee_id: state.employeeId,
      pin: state.pin,
      entry_date: entryDate,
      job_number: jobNumber,
      task_name: taskName,
      category,
      hours,
      description: desc,
      notes,
    });
    hideOverlay('edit-overlay');
    await loadEntries();
  } catch (e) {
    showMsg(err, e.message);
  }
});

$('edit-delete-btn').addEventListener('click', async () => {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  const id = parseInt($('edit-entry-id').value);
  try {
    await api('DELETE', `/api/entries/${id}`, {
      employee_id: state.employeeId,
      pin: state.pin,
    });
    hideOverlay('edit-overlay');
    await loadEntries();
  } catch (e) {
    showMsg($('edit-error'), e.message);
  }
});

/* ── Admin ───────────────────────────────────────────────────────────────── */
$('admin-btn').addEventListener('click', async () => {
  showOverlay('admin-overlay');
  await Promise.all([loadAdminJobs(), loadAdminTasks(), loadAdminEmployees()]);
});
$('admin-close-btn').addEventListener('click', () => hideOverlay('admin-overlay'));

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

/* ── Admin: Jobs ─────────────────────────────────────────────────────────── */
async function loadAdminJobs() {
  const jobs = await api('GET', '/api/jobs?all=1');
  const list = $('jobs-list');
  list.innerHTML = '';
  jobs.forEach(j => {
    const div = document.createElement('div');
    div.className = `admin-item ${j.active ? '' : 'inactive'}`;
    div.innerHTML = `
      <span class="item-name">${j.job_number}</span>
      <span class="item-meta">${j.description || ''}</span>
      <div class="item-actions">
        <button class="toggle-btn ${j.active ? 'active' : 'inactive'}"
                data-id="${j.id}" data-active="${j.active}">
          ${j.active ? 'Active' : 'Inactive'}
        </button>
      </div>`;
    list.appendChild(div);
  });
  list.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const job = jobs.find(j => j.id === parseInt(btn.dataset.id));
      await api('PUT', `/api/jobs/${job.id}`, {
        employee_id: state.employeeId, pin: state.pin,
        job_number: job.job_number,
        description: job.description,
        active: job.active ? 0 : 1,
      });
      await Promise.all([loadAdminJobs(), loadJobs()]);
    });
  });
}

$('add-job-btn').addEventListener('click', async () => {
  const num  = $('new-job-number').value.trim();
  const desc = $('new-job-desc').value.trim();
  if (!num) { alert('Job number is required.'); return; }
  await api('POST', '/api/jobs', {
    employee_id: state.employeeId, pin: state.pin,
    job_number: num, description: desc,
  });
  $('new-job-number').value = '';
  $('new-job-desc').value = '';
  await Promise.all([loadAdminJobs(), loadJobs()]);
});

/* ── Admin: Tasks ────────────────────────────────────────────────────────── */
async function loadAdminTasks() {
  const tasks = await api('GET', '/api/tasks?all=1');
  const list = $('tasks-list');
  list.innerHTML = '';
  tasks.forEach(t => {
    const div = document.createElement('div');
    div.className = `admin-item ${t.active ? '' : 'inactive'}`;
    div.innerHTML = `
      <span class="item-name">${t.name}</span>
      <span class="item-meta">${t.category}</span>
      <div class="item-actions">
        <button class="toggle-btn ${t.active ? 'active' : 'inactive'}"
                data-id="${t.id}" data-active="${t.active}">
          ${t.active ? 'Active' : 'Inactive'}
        </button>
      </div>`;
    list.appendChild(div);
  });
  list.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const task = tasks.find(t => t.id === parseInt(btn.dataset.id));
      await api('PUT', `/api/tasks/${task.id}`, {
        employee_id: state.employeeId, pin: state.pin,
        name: task.name, category: task.category,
        active: task.active ? 0 : 1,
      });
      await Promise.all([loadAdminTasks(), loadTasks()]);
    });
  });
}

$('add-task-btn').addEventListener('click', async () => {
  const name = $('new-task-name').value.trim();
  const cat  = $('new-task-category').value.trim();
  if (!name || !cat) { alert('Task name and category are required.'); return; }
  await api('POST', '/api/tasks', {
    employee_id: state.employeeId, pin: state.pin,
    name, category: cat,
  });
  $('new-task-name').value = '';
  $('new-task-category').value = '';
  await Promise.all([loadAdminTasks(), loadTasks()]);
});

/* ── Admin: Employees ────────────────────────────────────────────────────── */
async function loadAdminEmployees() {
  const emps = await api(
    'GET',
    `/api/admin/employees?employee_id=${state.employeeId}&pin=${encodeURIComponent(state.pin)}`
  );
  const list = $('employees-list');
  list.innerHTML = '';
  emps.forEach(e => {
    const div = document.createElement('div');
    div.className = `admin-item ${e.active ? '' : 'inactive'}`;
    div.innerHTML = `
      <span class="item-name">${e.name}</span>
      <span class="item-meta">${e.is_admin ? 'Admin' : 'Employee'}</span>
      <div class="item-actions">
        <button class="reset-pin-btn btn btn-sm btn-secondary" data-id="${e.id}" data-name="${e.name}">
          Reset PIN
        </button>
        <button class="toggle-btn ${e.active ? 'active' : 'inactive'}"
                data-id="${e.id}">
          ${e.active ? 'Active' : 'Inactive'}
        </button>
      </div>`;
    list.appendChild(div);
  });

  list.querySelectorAll('.reset-pin-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newPin = prompt(`Enter new PIN for ${btn.dataset.name}:`);
      if (!newPin) return;
      const emp = emps.find(e => e.id === parseInt(btn.dataset.id));
      await api('PUT', `/api/admin/employees/${emp.id}`, {
        employee_id: state.employeeId, pin: state.pin,
        name: emp.name, is_admin: emp.is_admin,
        active: emp.active, new_pin: newPin,
      });
      alert('PIN updated.');
    });
  });

  list.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emp = emps.find(e => e.id === parseInt(btn.dataset.id));
      await api('PUT', `/api/admin/employees/${emp.id}`, {
        employee_id: state.employeeId, pin: state.pin,
        name: emp.name, is_admin: emp.is_admin,
        active: emp.active ? 0 : 1,
      });
      await loadAdminEmployees();
    });
  });
}

$('add-emp-btn').addEventListener('click', async () => {
  const name  = $('new-emp-name').value.trim();
  const pin   = $('new-emp-pin').value.trim();
  const admin = $('new-emp-admin').checked ? 1 : 0;
  if (!name || !pin) { alert('Name and PIN are required.'); return; }
  await api('POST', '/api/admin/employees', {
    employee_id: state.employeeId, pin: state.pin,
    name, new_pin: pin, is_admin: admin,
  });
  $('new-emp-name').value = '';
  $('new-emp-pin').value = '';
  $('new-emp-admin').checked = false;
  await Promise.all([loadAdminEmployees(), loadEmployeeList()]);
});

/* ── Export ──────────────────────────────────────────────────────────────── */
$('export-btn').addEventListener('click', () => {
  const from = $('export-from').value;
  const to   = $('export-to').value;
  const url  = `/api/export?employee_id=${state.employeeId}&pin=${encodeURIComponent(state.pin)}`
             + (from ? `&date_from=${from}` : '')
             + (to   ? `&date_to=${to}`     : '');
  window.location.href = url;
});

/* ── Init ────────────────────────────────────────────────────────────────── */
async function init() {
  await loadEmployeeList();
  showOverlay('pin-overlay');
  $('entry-date').value = today();
  buildQuickHours('quick-hours', 'hours');
  buildQuickHours('edit-quick-hours', 'edit-hours');
  initCombos();
}

init();
