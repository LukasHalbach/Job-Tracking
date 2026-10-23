# TSi Job Time Tracker

A local web app for tracking employee time **by customer**. Every entry is logged against a customer (required), optionally an invoice, and a task. Every change is recorded in an audit log. Data is stored in SQLite and can be exported to Excel.

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the app

```bash
python app.py
```

The app will start on **http://localhost:5000** (or your machine's IP on port 5000 for other computers on the same network, e.g. `http://192.168.1.x:5000`).

The database is created automatically at `data/timelog.db` on first run.

### 3. Default admin login

- **Name:** Admin  
- **PIN:** `0000`

Change this PIN immediately via the Admin panel → Employees tab.

---

## Adding Employees

1. Sign in as Admin
2. Click **Admin** in the top-right
3. Go to the **Employees** tab
4. Enter the employee's name and a PIN, then click **Add Employee**

Each employee uses their name + PIN to sign in before logging time.

## How logging works

1. **Pick a customer** (required). Start typing to search, or tap one of your recent customers.
2. **Optionally pick an invoice.** Only that customer's invoices are offered. You can attach several and split the hours between them.
3. Pick a task, enter hours and notes, and submit. The customer stays selected so you can log several tasks in a row.

### When it isn't in the system yet

Because customers and invoices are entered by an admin, work often starts before the record exists. Employees can type a new customer or invoice number right in the form. It is saved immediately and marked **pending**. Admins see it under **Admin → Needs Review**, where they can:

- **Verify** it as real,
- **Rename & verify** it (fix a typo),
- **Merge** it into an existing customer (moves all invoices and entries across),
- **Fix** an invoice (change its number, title, or the customer it belongs to).

If an admin later adds the same invoice under the same customer, the pending record is simply verified.

An invoice number is unique across all customers. If someone types a number that is on file under a different customer, they are told which one (or can switch customer in one click).

## Customers

- **Customers tab** (everyone): browse customers and open a profile showing invoices with hours, hours by task, and recent entries. Employees see their own hours; admins see everyone's, plus hours by employee and the customer's recent changes.
- **Admin → Customers**: add, rename, deactivate, merge, or delete customers and manage each customer's invoices. A customer or invoice with time entries can't be deleted — merge or deactivate instead.
- **CSV import** (Admin → Customers): one invoice per row with columns `Customer`, `Invoice Number` (optional), `Title` (optional). Customers are created as needed. "Deactivate verified invoices not in this file" syncs your open-invoice list; invoices employees added on the fly are never deactivated by it.
- **Shop / Internal** is a protected customer for general shop work.

## Change tracking

Everything that changes is written to an append-only audit log with who, when, and the old and new values:

- time entries (create, edit, delete — deleted entries keep a full snapshot),
- customers and invoices (create, edit, verify, activate/deactivate, move, merge, delete, CSV imports),
- tasks, employees, and roles (PIN values are never logged).

Where to see it:

- **Edit Entry** → *Change history* for that entry (employees can see their own).
- **Customers tab** → a customer's *Recent changes* (admins).
- **Admin → History**: search and filter by type, action, person and date.
- **Export** can include a *Change Log* sheet.

## Managing Tasks

Tasks can be added or deactivated in **Admin → Tasks**. Each task has an associated category that auto-fills when the task is selected.

The **Not Listed** task requires employees to fill in the Notes field describing the work. Admins re-assign those entries to a proper task under **Admin → Needs Review**.

## Exporting Data

1. Sign in as an admin
2. Click **Admin** → **Export Data** tab
3. Select a date range (leave blank for all data)
4. Click **Download Excel**

The export includes:
- **Time Entries**: customer, invoice, date, employee, task, category, hours, notes, when it was logged / last edited
- **Summary by Customer**: hours per customer with an invoice-by-invoice breakdown
- **Summary by Employee**: total hours per employee for the period
- **Change Log** (optional, admins): every create / edit / delete in the date range

Admins export everyone's entries; other employees export only their own.

## Running on a Shared Computer

To make the app accessible from all computers on your local network:

```bash
python app.py
```

The app binds to `0.0.0.0:5000` by default, so other machines can reach it at `http://<this-computer's-IP>:5000`.

To find your IP address:
- **Windows:** run `ipconfig` in Command Prompt
- **Mac/Linux:** run `ifconfig` or `ip addr`

## File Structure

```
Job-Tracking/
├── app.py              # Flask server, schema, audit log, all API routes
├── requirements.txt
├── data/
│   └── timelog.db      # SQLite database (auto-created)
├── static/
│   ├── style.css
│   ├── core.js         # state, helpers, combobox, change-history rendering
│   ├── entry.js        # log-time form, entries table, edit modal
│   ├── customers.js    # Customers tab (profiles)
│   ├── admin.js        # admin panel (customers, review queue, history, …)
│   └── app.js          # login, navigation, startup
└── templates/
    └── index.html
```

## Upgrading from the invoice-based version

On first start, a database from the old version is backed up to `data/timelog.pre-customer-overhaul.db`, and its old `jobs` and `time_entries` tables are renamed to `legacy_jobs` and `legacy_time_entries` (nothing is dropped). Employees, roles, role task lists and tasks carry over; customers, invoices and entries start fresh. The startup is recorded in the History log.

Note: the built-in task list in `app.py` is re-applied at each start — tasks that are not in it are deactivated and edits to built-in task names/categories are reset. Changes made this way are recorded in History as "System".
