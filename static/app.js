/* ── State ───────────────────────────────────────────────────────────────── */
const state = {
  employeeId: null,
  employeeName: null,
  pin: null,
  isAdmin: false,
  jobs: [],
  tasks: [],
  entries: [],
  selectedJobs: [],
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

/* ── Job tags ────────────────────────────────────────────────────────────── */
function renderJobTags() {
  const field = $('job-tag-field');
  field.querySelectorAll('.job-tag').forEach(t => t.remove());
  const input = $('job-input');
  state.selectedJobs.forEach((j, idx) => {
    const tag = document.createElement('span');
    tag.className = 'job-tag';
    tag.textContent = j.job_number;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '✕';
    rm.addEventListener('click', () => {
      state.selectedJobs.splice(idx, 1);
      renderJobTags();
    });
    tag.appendChild(rm);
    field.insertBefore(tag, input);
  });
  const hasShop = state.selectedJobs.some(j => j.job_number === 'Shop');
  input.style.display = hasShop ? 'none' : '';
  $('split-job-wrap').style.display = state.selectedJobs.length >= 2 ? '' : 'none';

  // Require description when "Not Listed" job is selected
  const hasNotListed = state.selectedJobs.some(j => j.job_number === 'Not Listed');
  const descLabel = document.querySelector('label[for="description"]');
  if (descLabel) {
    descLabel.innerHTML = hasNotListed
      ? 'Description <span class="required">*</span> <span class="hint">(required — note the actual invoice/job name)</span>'
      : 'Description <span class="hint">(optional)</span>';
  }
}

/* ── Combobox factory ────────────────────────────────────────────────────── */
function makeCombo({
  inputId, listId, items, getLabel, getSub, onSelect,
  allowFreeText = false, getSearch = null,
  clearOnFocus = false, setInputOnSelect = true,
}) {
  const input = $(inputId);
  const list  = $(listId);
  let active = -1;
  let suppressBlur = false;
  let savedValue = '';
  let didSelect = false;
  const searchFn = getSearch || (i => getLabel(i));
  const controller = new AbortController();
  const sig = { signal: controller.signal };

  function render(filter) {
    const q = filter.toLowerCase();
    const filtered = q
      ? items.filter(i => searchFn(i).toLowerCase().includes(q))
      : items;
    list.innerHTML = '';
    if (!filtered.length) { list.classList.add('hidden'); return; }
    filtered.slice(0, 60).forEach(item => {
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
        didSelect = true;
        onSelect(item);
        if (setInputOnSelect) input.value = getLabel(item);
        list.classList.add('hidden');
        suppressBlur = false;
      });
      list.appendChild(li);
    });
    active = -1;
    list.classList.remove('hidden');
  }

  input.addEventListener('input', () => render(input.value), sig);

  if (clearOnFocus) {
    input.addEventListener('focus', () => {
      savedValue = input.value;
      didSelect = false;
      input.value = '';
      render('');
    }, sig);
  } else {
    input.addEventListener('focus', () => render(input.value), sig);
  }

  input.addEventListener('blur', () => {
    if (suppressBlur) return;
    setTimeout(() => list.classList.add('hidden'), 150);
    if (clearOnFocus && !didSelect) {
      input.value = savedValue;
    }
    if (allowFreeText && input.value.trim()) {
      onSelect({ _free: input.value.trim() });
    }
  }, sig);

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
  }, sig);

  return {
    refresh: () => render(input.value),
    destroy: () => controller.abort(),
  };
}

/* ── Combo instances ─────────────────────────────────────────────────────── */
let jobCombo, taskCombo, editJobCombo, editTaskCombo;

function initCombos() {
  jobCombo = makeCombo({
    inputId: 'job-input',
    listId:  'job-list',
    items:   state.jobs,
    getLabel: j => j.job_number,
    getSub:   j => j.description || '',
    getSearch: j => `${j.job_number} ${j.description || ''}`,
    clearOnFocus: true,
    setInputOnSelect: false,
    onSelect: j => {
      if (j.job_number === 'Shop') {
        if (state.selectedJobs.length > 0) return;
        state.selectedJobs = [j];
      } else {
        if (state.selectedJobs.some(s => s.job_number === 'Shop')) return;
        if (!state.selectedJobs.find(s => s.job_number === j.job_number)) {
          state.selectedJobs.push(j);
        }
      }
      renderJobTags();
      $('job-input').value = '';
    },
  });

  taskCombo = makeCombo({
    inputId: 'task-input',
    listId:  'task-list',
    items:   getVisibleTasks(),
    getLabel: t => t.name,
    getSub:   t => t.category,
    clearOnFocus: true,
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
    getSearch: j => `${j.job_number} ${j.description || ''}`,
    onSelect: j => { $('edit-job-input').value = j.job_number; },
  });

  editTaskCombo = makeCombo({
    inputId: 'edit-task-input',
    listId:  'edit-task-list',
    items:   getVisibleTasks(),
    getLabel: t => t.name,
    getSub:   t => t.category,
    clearOnFocus: true,
    onSelect: t => {
      $('edit-task-input').value = t.name;
      $('edit-category').value   = t.category;
      $('edit-notes-wrap').classList.toggle('hidden', t.name !== 'Not Listed');
    },
  });
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
    state.employeeId    = empId;
    state.employeeName  = res.name;
    state.pin           = pin;
    state.isAdmin       = res.is_admin;
    state.allowedTaskIds = res.allowed_task_ids || null;
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

/* ── Load data ───────────────────────────────────────────────────────────── */
async function loadJobs() {
  state.jobs = await api('GET', '/api/jobs');
  if (jobCombo) {
    jobCombo.destroy();
    editJobCombo.destroy();
    jobCombo = makeCombo({
      inputId: 'job-input', listId: 'job-list',
      items: state.jobs, getLabel: j => j.job_number, getSub: j => j.description || '',
      getSearch: j => `${j.job_number} ${j.description || ''}`,
      clearOnFocus: true, setInputOnSelect: false,
      onSelect: j => {
        if (j.job_number === 'Shop') {
          if (state.selectedJobs.length > 0) return;
          state.selectedJobs = [j];
        } else {
          if (state.selectedJobs.some(s => s.job_number === 'Shop')) return;
          if (!state.selectedJobs.find(s => s.job_number === j.job_number)) {
            state.selectedJobs.push(j);
          }
        }
        renderJobTags();
        $('job-input').value = '';
      },
    });
    editJobCombo = makeCombo({
      inputId: 'edit-job-input', listId: 'edit-job-list',
      items: state.jobs, getLabel: j => j.job_number, getSub: j => j.description || '',
      getSearch: j => `${j.job_number} ${j.description || ''}`,
      onSelect: j => { $('edit-job-input').value = j.job_number; },
    });
  }
}

async function loadTasks() {
  state.tasks = await api('GET', '/api/tasks');
  if (taskCombo) {
    taskCombo.destroy();
    editTaskCombo.destroy();
    taskCombo = makeCombo({
      inputId: 'task-input', listId: 'task-list',
      items: getVisibleTasks(), getLabel: t => t.name, getSub: t => t.category,
      clearOnFocus: true,
      onSelect: t => {
        $('task-input').value = t.name;
        $('category').value   = t.category;
        $('notes-wrap').classList.toggle('hidden', t.name !== 'Not Listed');
      },
    });
    editTaskCombo = makeCombo({
      inputId: 'edit-task-input', listId: 'edit-task-list',
      items: getVisibleTasks(), getLabel: t => t.name, getSub: t => t.category,
      clearOnFocus: true,
      onSelect: t => {
        $('edit-task-input').value = t.name;
        $('edit-category').value   = t.category;
        $('edit-notes-wrap').classList.toggle('hidden', t.name !== 'Not Listed');
      },
    });
  }
}

async function loadEntries() {
  const from = $('filter-from').value;
  const to   = $('filter-to').value;
  let url = `/api/entries?employee_id=${state.employeeId}`;
  if (from) url += `&date_from=${from}`;
  if (to)   url += `&date_to=${to}`;
  state.entries = await api('GET', url);
  renderEntries();
}

/* ── Entry form ──────────────────────────────────────────────────────────── */
function clearForm() {
  $('entry-date').value   = today();
  state.selectedJobs = [];
  renderJobTags();
  $('job-input').value    = '';
  $('task-input').value   = '';
  $('category').value     = '';
  $('hours').value        = '';
  $('description').value  = '';
  $('notes').value        = '';
  $('notes-wrap').classList.add('hidden');
  $('split-job').checked  = false;
  $('entry-error').classList.add('hidden');
  $('entry-success').classList.add('hidden');
}

$('clear-btn').addEventListener('click', clearForm);

$('submit-btn').addEventListener('click', async () => {
  const err = $('entry-error');
  err.classList.add('hidden');
  const taskName  = $('task-input').value.trim();
  const category  = $('category').value.trim();
  const hours     = parseFloat($('hours').value);
  const desc      = $('description').value.trim();
  const notes     = $('notes').value.trim();
  const entryDate = $('entry-date').value;
  const split     = $('split-job').checked;

  if (!state.selectedJobs.length) { showMsg(err, 'Please select a Job / Invoice from the list.'); return; }
  if (!taskName)  { showMsg(err, 'Please select a task.'); return; }
  if (!category)  { showMsg(err, 'Category could not be determined. Please re-select the task.'); return; }
  if (!hours || hours <= 0) { showMsg(err, 'Please enter a valid number of hours.'); return; }
  if (taskName === 'Not Listed' && !notes) { showMsg(err, 'Please describe the task in the Notes field.'); return; }
  const hasNotListedJob = state.selectedJobs.some(j => j.job_number === 'Not Listed');
  if (hasNotListedJob && !desc) { showMsg(err, 'Please enter a description to identify the actual invoice/job.'); return; }

  const jobHours = split ? round2(hours / state.selectedJobs.length) : hours;

  try {
    await Promise.all(state.selectedJobs.map(j =>
      api('POST', '/api/entries', {
        employee_id: state.employeeId,
        pin: state.pin,
        entry_date: entryDate,
        job_number: j.job_number,
        task_name:  taskName,
        category,
        hours: jobHours,
        description: desc,
        notes,
      })
    ));
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
    const jobDisplay = e.job_description
      ? `${e.job_number} — ${e.job_description}`
      : e.job_number;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.entry_date}</td>
      <td title="${jobDisplay}">${jobDisplay}</td>
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

$('this-week-btn').addEventListener('click', () => {
  const { from, to } = getWeekRange();
  $('filter-from').value = from;
  $('filter-to').value   = to;
});
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
  const id        = parseInt($('edit-entry-id').value);
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
  const { from, to } = getWeekRange();
  $('export-from').value = from;
  $('export-to').value   = to;
  showOverlay('admin-overlay');
  await Promise.all([loadAdminJobs(), loadAdminTasks(), loadAdminEmployees(), loadAdminRoles()]);
});

$('export-this-week-btn').addEventListener('click', () => {
  const { from, to } = getWeekRange();
  $('export-from').value = from;
  $('export-to').value   = to;
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

/* ── Delete confirm modal ────────────────────────────────────────────────── */
let deleteTarget = null;

function openDeleteConfirm(type, id, label, note) {
  deleteTarget = { type, id };
  $('delete-confirm-label').textContent = `Delete "${label}"?`;
  $('delete-confirm-note').textContent = note;
  $('delete-admin-pin').value = '';
  $('delete-confirm-error').classList.add('hidden');
  showOverlay('delete-confirm-overlay');
}

$('delete-confirm-cancel').addEventListener('click', () => hideOverlay('delete-confirm-overlay'));

$('delete-confirm-ok').addEventListener('click', async () => {
  const adminPin = $('delete-admin-pin').value;
  const errEl = $('delete-confirm-error');
  errEl.classList.add('hidden');
  if (!adminPin) { showMsg(errEl, 'Admin PIN is required.'); return; }

  try {
    await api('DELETE', `/api/${deleteTarget.type}s/${deleteTarget.id}`, {
      employee_id: state.employeeId,
      pin: adminPin,
    });
    hideOverlay('delete-confirm-overlay');
    if (deleteTarget.type === 'job') {
      await Promise.all([loadAdminJobs(), loadJobs()]);
    } else if (deleteTarget.type === 'role') {
      await Promise.all([loadAdminRoles(), loadAdminEmployees()]);
    } else {
      await Promise.all([loadAdminTasks(), loadTasks()]);
    }
  } catch (e) {
    showMsg(errEl, e.message);
  }
});

/* ── Admin: Jobs ─────────────────────────────────────────────────────────── */
async function loadAdminJobs() {
  const jobs = await api('GET', '/api/jobs?all=1');
  const list = $('jobs-list');
  list.innerHTML = '';
  jobs.forEach(j => {
    const div = document.createElement('div');
    div.className = `admin-item ${j.active ? '' : 'inactive'}`;
    const nameHtml = j.is_system
      ? `${j.job_number} <span class="system-badge">System</span>`
      : j.job_number;
    const editBtn = !j.is_system
      ? `<button class="edit-item-btn btn btn-sm btn-secondary" data-id="${j.id}">Edit</button>`
      : '';
    const deleteBtn = !j.is_system
      ? `<button class="delete-perm-btn btn btn-sm btn-danger"
           data-id="${j.id}"
           data-label="${j.job_number}${j.description ? ' — ' + j.description : ''}">
           Delete
         </button>`
      : '';
    div.innerHTML = `
      <span class="item-name">${nameHtml}</span>
      <span class="item-meta">${j.description || ''}</span>
      <div class="item-actions">
        <button class="toggle-btn ${j.active ? 'active' : 'inactive'}"
                data-id="${j.id}" data-active="${j.active}">
          ${j.active ? 'Active' : 'Inactive'}
        </button>
        ${editBtn}
        ${deleteBtn}
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
  list.querySelectorAll('.edit-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const job = jobs.find(j => j.id === parseInt(btn.dataset.id));
      const div = btn.closest('.admin-item');
      div.innerHTML = `
        <input class="edit-inline-input" value="${job.job_number}" placeholder="Invoice #" style="min-width:90px;flex:1" />
        <input class="edit-inline-input" value="${job.description || ''}" placeholder="Description" style="flex:2" />
        <div class="item-actions">
          <button class="btn btn-sm btn-primary save-inline-btn">Save</button>
          <button class="btn btn-sm btn-secondary cancel-inline-btn">Cancel</button>
        </div>`;
      div.querySelector('.save-inline-btn').addEventListener('click', async () => {
        const inputs = div.querySelectorAll('.edit-inline-input');
        const newNum = inputs[0].value.trim();
        const newDesc = inputs[1].value.trim();
        if (!newNum) { alert('Invoice number is required.'); return; }
        await api('PUT', `/api/jobs/${job.id}`, {
          employee_id: state.employeeId, pin: state.pin,
          job_number: newNum, description: newDesc, active: job.active,
        });
        await Promise.all([loadAdminJobs(), loadJobs()]);
      });
      div.querySelector('.cancel-inline-btn').addEventListener('click', loadAdminJobs);
    });
  });
  list.querySelectorAll('.delete-perm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteConfirm(
        'job', parseInt(btn.dataset.id), btn.dataset.label,
        'Existing time entries that used this job will keep their recorded job number and hours — nothing in past entries is lost. The job will no longer appear in the dropdown.'
      );
    });
  });
}

$('csv-file-input').addEventListener('change', () => {
  const file = $('csv-file-input').files[0];
  $('csv-file-name').textContent = file ? file.name : 'Choose CSV file…';
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

  try {
    const res = await fetch('/api/jobs/import', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    result.textContent = `Done — ${data.added} job${data.added !== 1 ? 's' : ''} added, ${data.skipped} skipped (already exist or blank).`;
    result.className = 'ok';
    $('csv-file-input').value = '';
    $('csv-file-name').textContent = 'Choose CSV file…';
    $('import-csv-btn').disabled = true;
    await Promise.all([loadAdminJobs(), loadJobs()]);
  } catch (e) {
    result.textContent = e.message;
    result.className = 'err';
  }
});

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
    const isSystem = t.name === 'Not Listed';
    const nameHtml = isSystem
      ? `${t.name} <span class="system-badge">System</span>`
      : t.name;
    const editBtn = !isSystem
      ? `<button class="edit-item-btn btn btn-sm btn-secondary" data-id="${t.id}">Edit</button>`
      : '';
    const deleteBtn = !isSystem
      ? `<button class="delete-perm-btn btn btn-sm btn-danger"
           data-id="${t.id}" data-label="${t.name}">
           Delete
         </button>`
      : '';
    div.innerHTML = `
      <span class="item-name">${nameHtml}</span>
      <span class="item-meta">${t.category}</span>
      <div class="item-actions">
        <button class="toggle-btn ${t.active ? 'active' : 'inactive'}"
                data-id="${t.id}" data-active="${t.active}">
          ${t.active ? 'Active' : 'Inactive'}
        </button>
        ${editBtn}
        ${deleteBtn}
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
  list.querySelectorAll('.edit-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const task = tasks.find(t => t.id === parseInt(btn.dataset.id));
      const div = btn.closest('.admin-item');
      div.innerHTML = `
        <input class="edit-inline-input" value="${task.name}" placeholder="Task name" style="flex:2" />
        <input class="edit-inline-input" value="${task.category}" placeholder="Category" style="flex:1" />
        <div class="item-actions">
          <button class="btn btn-sm btn-primary save-inline-btn">Save</button>
          <button class="btn btn-sm btn-secondary cancel-inline-btn">Cancel</button>
        </div>`;
      div.querySelector('.save-inline-btn').addEventListener('click', async () => {
        const inputs = div.querySelectorAll('.edit-inline-input');
        const newName = inputs[0].value.trim();
        const newCat  = inputs[1].value.trim();
        if (!newName || !newCat) { alert('Task name and category are required.'); return; }
        await api('PUT', `/api/tasks/${task.id}`, {
          employee_id: state.employeeId, pin: state.pin,
          name: newName, category: newCat, active: task.active,
        });
        await Promise.all([loadAdminTasks(), loadTasks()]);
      });
      div.querySelector('.cancel-inline-btn').addEventListener('click', loadAdminTasks);
    });
  });
  list.querySelectorAll('.delete-perm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteConfirm(
        'task', parseInt(btn.dataset.id), btn.dataset.label,
        'Existing time entries that used this task will keep their recorded task name, category, and hours — nothing in past entries is lost. The task will be permanently removed and cannot be restored.'
      );
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
  const [emps, roles] = await Promise.all([
    api('GET', `/api/admin/employees?employee_id=${state.employeeId}&pin=${encodeURIComponent(state.pin)}`),
    api('GET', '/api/roles'),
  ]);

  // Populate the new-employee role dropdown
  const newEmpRole = $('new-emp-role');
  const prevNewRole = newEmpRole.value;
  newEmpRole.innerHTML = '<option value="">— No role (all tasks) —</option>';
  roles.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    newEmpRole.appendChild(opt);
  });
  newEmpRole.value = prevNewRole;

  const list = $('employees-list');
  list.innerHTML = '';
  emps.forEach(e => {
    const roleOpts = roles.map(r =>
      `<option value="${r.id}" ${e.role_id === r.id ? 'selected' : ''}>${r.name}</option>`
    ).join('');
    const div = document.createElement('div');
    div.className = `admin-item ${e.active ? '' : 'inactive'}`;
    div.innerHTML = `
      <span class="item-name">${e.name}</span>
      <span class="item-meta">${e.is_admin ? 'Admin' : 'Employee'}</span>
      <select class="role-select emp-role-select" data-id="${e.id}">
        <option value="" ${!e.role_id ? 'selected' : ''}>No role</option>
        ${roleOpts}
      </select>
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

  list.querySelectorAll('.emp-role-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const emp = emps.find(e => e.id === parseInt(sel.dataset.id));
      await api('PUT', `/api/admin/employees/${emp.id}`, {
        employee_id: state.employeeId, pin: state.pin,
        name: emp.name, is_admin: emp.is_admin,
        active: emp.active, role_id: sel.value || null,
      });
    });
  });

  list.querySelectorAll('.reset-pin-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newPin = prompt(`Enter new PIN for ${btn.dataset.name}:`);
      if (!newPin) return;
      const emp = emps.find(e => e.id === parseInt(btn.dataset.id));
      await api('PUT', `/api/admin/employees/${emp.id}`, {
        employee_id: state.employeeId, pin: state.pin,
        name: emp.name, is_admin: emp.is_admin,
        active: emp.active, role_id: emp.role_id || null, new_pin: newPin,
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
        active: emp.active ? 0 : 1, role_id: emp.role_id || null,
      });
      await loadAdminEmployees();
    });
  });
}

$('add-emp-btn').addEventListener('click', async () => {
  const name    = $('new-emp-name').value.trim();
  const pin     = $('new-emp-pin').value.trim();
  const admin   = $('new-emp-admin').checked ? 1 : 0;
  const role_id = $('new-emp-role').value || null;
  if (!name || !pin) { alert('Name and PIN are required.'); return; }
  await api('POST', '/api/admin/employees', {
    employee_id: state.employeeId, pin: state.pin,
    name, new_pin: pin, is_admin: admin, role_id,
  });
  $('new-emp-name').value = '';
  $('new-emp-pin').value = '';
  $('new-emp-admin').checked = false;
  $('new-emp-role').value = '';
  await Promise.all([loadAdminEmployees(), loadEmployeeList()]);
});

/* ── Admin: Roles ────────────────────────────────────────────────────────── */
async function loadAdminRoles() {
  const roles = await api('GET', '/api/roles');
  const list = $('roles-list');
  list.innerHTML = '';

  if (!roles.length) {
    list.innerHTML = '<p style="color:var(--gray-400);font-size:.85rem;padding:.5rem 0">No roles yet. Add one above.</p>';
  }

  roles.forEach(role => {
    const div = document.createElement('div');
    div.className = 'admin-item';
    div.dataset.roleId = role.id;
    div.innerHTML = `
      <span class="item-name">${role.name}</span>
      <div class="item-actions">
        <button class="edit-tasks-btn btn btn-sm btn-outline" data-id="${role.id}" data-name="${role.name}">
          Edit Tasks
        </button>
        <button class="edit-item-btn btn btn-sm btn-secondary" data-id="${role.id}" data-name="${role.name}">
          Rename
        </button>
        <button class="delete-perm-btn btn btn-sm btn-danger"
                data-id="${role.id}" data-label="${role.name}">
          Delete
        </button>
      </div>`;
    list.appendChild(div);
  });

  list.querySelectorAll('.edit-tasks-btn').forEach(btn => {
    btn.addEventListener('click', () => openRoleTasksPanel(parseInt(btn.dataset.id), btn.dataset.name, btn));
  });

  list.querySelectorAll('.edit-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const role = roles.find(r => r.id === parseInt(btn.dataset.id));
      const div = btn.closest('.admin-item');
      div.innerHTML = `
        <input class="edit-inline-input" value="${role.name}" placeholder="Role name" style="flex:1" />
        <div class="item-actions">
          <button class="btn btn-sm btn-primary save-inline-btn">Save</button>
          <button class="btn btn-sm btn-secondary cancel-inline-btn">Cancel</button>
        </div>`;
      div.querySelector('.save-inline-btn').addEventListener('click', async () => {
        const newName = div.querySelector('.edit-inline-input').value.trim();
        if (!newName) { alert('Role name is required.'); return; }
        await api('PUT', `/api/roles/${role.id}`, {
          employee_id: state.employeeId, pin: state.pin, name: newName,
        });
        await loadAdminRoles();
      });
      div.querySelector('.cancel-inline-btn').addEventListener('click', loadAdminRoles);
    });
  });

  list.querySelectorAll('.delete-perm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteConfirm(
        'role', parseInt(btn.dataset.id), btn.dataset.label,
        'Employees assigned this role will lose their task restriction and see all tasks. This cannot be undone.'
      );
    });
  });
}

async function openRoleTasksPanel(roleId, roleName, triggerBtn) {
  // Close any already-open panel
  document.querySelectorAll('.role-tasks-panel').forEach(p => p.remove());

  const [assignedIds, allTasks] = await Promise.all([
    api('GET', `/api/roles/${roleId}/tasks`),
    api('GET', '/api/tasks'),
  ]);

  const activeTasks = allTasks.filter(t => t.active && t.name !== 'Not Listed');

  // Group by category
  const byCategory = {};
  activeTasks.forEach(t => {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  });

  const panel = document.createElement('div');
  panel.className = 'role-tasks-panel';
  panel.innerHTML = `
    <div style="font-size:.85rem;font-weight:600;color:var(--gray-700)">
      Tasks allowed for <strong>${roleName}</strong>
      <span class="hint"> — "Not Listed" is always visible to all roles</span>
    </div>
    <div class="task-checklist" id="task-checklist-${roleId}"></div>
    <div class="role-tasks-actions">
      <button class="btn btn-sm btn-secondary" id="select-all-tasks-${roleId}">Select All</button>
      <button class="btn btn-sm btn-secondary" id="clear-all-tasks-${roleId}">Clear All</button>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-primary" id="save-role-tasks-${roleId}">Save</button>
      <button class="btn btn-sm btn-secondary" id="cancel-role-tasks-${roleId}">Cancel</button>
    </div>`;

  const checklist = panel.querySelector(`#task-checklist-${roleId}`);
  Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b)).forEach(([cat, tasks]) => {
    const group = document.createElement('div');
    group.className = 'task-category-group';
    group.innerHTML = `<div class="task-category-label">${cat}</div>`;
    tasks.forEach(t => {
      const label = document.createElement('label');
      label.className = 'task-check-label';
      label.innerHTML = `<input type="checkbox" value="${t.id}" ${assignedIds.includes(t.id) ? 'checked' : ''} /> ${t.name}`;
      group.appendChild(label);
    });
    checklist.appendChild(group);
  });

  panel.querySelector(`#select-all-tasks-${roleId}`).addEventListener('click', () => {
    panel.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = true; });
  });
  panel.querySelector(`#clear-all-tasks-${roleId}`).addEventListener('click', () => {
    panel.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = false; });
  });
  panel.querySelector(`#save-role-tasks-${roleId}`).addEventListener('click', async () => {
    const task_ids = [...panel.querySelectorAll('input[type=checkbox]:checked')].map(cb => parseInt(cb.value));
    await api('PUT', `/api/roles/${roleId}/tasks`, {
      employee_id: state.employeeId, pin: state.pin, task_ids,
    });
    panel.remove();
    triggerBtn.textContent = 'Edit Tasks';
  });
  panel.querySelector(`#cancel-role-tasks-${roleId}`).addEventListener('click', () => {
    panel.remove();
    triggerBtn.textContent = 'Edit Tasks';
  });

  triggerBtn.textContent = 'Close';
  triggerBtn.closest('.admin-item').insertAdjacentElement('afterend', panel);
}

$('add-role-btn').addEventListener('click', async () => {
  const name = $('new-role-name').value.trim();
  if (!name) { alert('Role name is required.'); return; }
  await api('POST', '/api/roles', {
    employee_id: state.employeeId, pin: state.pin, name,
  });
  $('new-role-name').value = '';
  await loadAdminRoles();
});

/* ── Admin: Flagged Entries ──────────────────────────────────────────────── */
async function loadFlaggedEntries() {
  const countEl = $('flagged-count');
  const list    = $('flagged-list');
  list.innerHTML = '';
  countEl.textContent = 'Loading…';

  let data;
  try {
    data = await api('GET', `/api/admin/flagged-entries?employee_id=${state.employeeId}&pin=${encodeURIComponent(state.pin)}`);
  } catch (e) {
    countEl.textContent = 'Error: ' + e.message;
    return;
  }

  const { entries, active_jobs, active_tasks } = data;
  countEl.textContent = entries.length === 0
    ? 'No flagged entries — everything looks good.'
    : `${entries.length} flagged entr${entries.length === 1 ? 'y' : 'ies'} found.`;

  entries.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'admin-item flagged-entry-item';

    const jobBadge  = entry.bad_job  ? '<span class="flag-badge">bad job</span>'  : '';
    const taskBadge = entry.bad_task ? '<span class="flag-badge">bad task</span>' : '';

    const comboId   = `flagged-job-input-${entry.id}`;
    const comboListId = `flagged-job-list-${entry.id}`;

    div.innerHTML = `
      <div class="flagged-meta">
        <span class="flagged-date">${entry.entry_date}</span>
        <span class="flagged-employee">${escHtml(entry.employee_name)}</span>
        <span class="flagged-hours">${entry.hours}h</span>
        ${jobBadge}${taskBadge}
      </div>
      ${entry.bad_job && entry.description ? `
      <div class="flagged-original">
        <span class="flagged-original-label">Employee noted:</span>
        <span class="flagged-original-value">${escHtml(entry.description)}</span>
      </div>` : ''}
      <div class="flagged-fields">
        <label class="flagged-label">Job / Invoice
          <div class="combo-wrap" style="position:relative">
            <input id="${comboId}" class="flagged-job-input combo-input"
                   value="${escHtml(entry.bad_job ? '' : entry.job_number)}"
                   placeholder="${escHtml(entry.bad_job ? 'Search job or invoice…' : entry.job_number)}"
                   autocomplete="off" />
            <ul id="${comboListId}" class="combo-list hidden"></ul>
          </div>
        </label>
        <span class="flagged-job-desc hint"></span>
        <label class="flagged-label">Task
          <select class="flagged-task-select">
            <option value="${escHtml(entry.task_name)}" data-category="" selected>${escHtml(entry.task_name)}${entry.bad_task ? ' (current — invalid)' : ''}</option>
            ${active_tasks.map(t => `<option value="${escHtml(t.name)}" data-category="${escHtml(t.category)}">${escHtml(t.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="item-actions">
        <button class="btn btn-sm btn-primary save-flagged-btn">Save</button>
      </div>
      <div class="flagged-msg hidden"></div>`;

    // Append to DOM first so document.getElementById can find the combo elements
    list.appendChild(div);

    const jobDescEl = div.querySelector('.flagged-job-desc');
    const taskSel   = div.querySelector('.flagged-task-select');
    const saveBtn   = div.querySelector('.save-flagged-btn');
    const msgEl     = div.querySelector('.flagged-msg');

    // Track the currently selected job number (null = nothing chosen yet)
    let selectedJobNumber = entry.bad_job ? null : entry.job_number;

    makeCombo({
      inputId: comboId,
      listId:  comboListId,
      items:   active_jobs,
      getLabel: j => j.job_number,
      getSub:   j => j.description || '',
      getSearch: j => `${j.job_number} ${j.description}`,
      clearOnFocus: false,
      setInputOnSelect: true,
      onSelect: j => {
        selectedJobNumber = j.job_number;
        jobDescEl.textContent = j.description || '';
      },
    });

    saveBtn.addEventListener('click', async () => {
      const newJob  = selectedJobNumber;
      const newTask = taskSel.value;
      const selOpt  = taskSel.options[taskSel.selectedIndex];
      const newCat  = selOpt.dataset.category || entry.category;

      if (!newJob) {
        msgEl.textContent = 'Please select a job from the list.';
        msgEl.className = 'flagged-msg err';
        return;
      }

      msgEl.className = 'flagged-msg hidden';
      saveBtn.disabled = true;
      try {
        await api('PUT', `/api/entries/${entry.id}`, {
          employee_id: state.employeeId,
          pin: state.pin,
          entry_date:  entry.entry_date,
          job_number:  newJob,
          task_name:   newTask,
          category:    newCat,
          hours:       entry.hours,
          description: entry.description,
          notes:       entry.notes,
        });
        msgEl.textContent = 'Saved.';
        msgEl.className = 'flagged-msg ok';
        setTimeout(() => loadFlaggedEntries(), 800);
      } catch (e) {
        msgEl.textContent = e.message;
        msgEl.className = 'flagged-msg err';
        saveBtn.disabled = false;
      }
    });
  });
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.querySelector('.tab[data-tab="flagged"]').addEventListener('click', loadFlaggedEntries);
$('refresh-flagged-btn').addEventListener('click', loadFlaggedEntries);

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
  $('entry-date').value  = today();
  $('filter-from').value = today();
  $('filter-to').value   = today();
  buildQuickHours('quick-hours', 'hours');
  buildQuickHours('edit-quick-hours', 'edit-hours');
  initCombos();
}

init();
