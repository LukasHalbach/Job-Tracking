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

### Customers: requests, not self-service

Only admins create customers (import your list under **Admin → Customers**, from Excel or CSV — a single `Company Name` or `Customer` column is enough).

If an employee needs a customer that isn't there, they type the name and choose **Request … as a new customer**. The request:

- is visible **only to the person who made it** — it never appears in anyone else's customer list;
- lets them **keep logging time against it** (any number of entries, tasks and invoices) while it waits;
- shows up for you under **Admin → Needs Review → Customer requests**.

You then choose **Approve** (it becomes a normal customer for everyone and their time stays attached), **Rename & approve** (fix a typo first), or **Merge into existing…** (it was really an existing customer; all their time moves across). **Decline** is available when no time has been logged against the request.

### Job / invoice numbers are optional

You don't have to load job numbers ahead of time. Employees can leave the invoice blank, pick one already on file for that customer, or type the number. A typed number is saved as-is and shown with a small **typed** label (it hasn't been confirmed against your order system); it does not need review.

For time logged with no number, **Admin → Unassigned Time** lists it by customer with dates, alongside that customer's invoices and the dates each was worked on. Tick the entries, pick or type the number, and assign them in one go. Each assignment is recorded in the entry's change history.

An invoice number is unique across all customers. If someone types a number that is on file under a different customer, they're told which one (or can switch customer in one click).

## Customers

- **Customers tab** (everyone): browse customers and open a profile showing invoices with hours, hours by task, and recent entries. Employees see their own hours; admins see everyone's, plus hours by employee and the customer's recent changes.
- **Admin → Customers**: add, rename, deactivate, merge, or delete customers and manage each customer's invoices. A customer or invoice with time entries can't be deleted — merge or deactivate instead.
- **Import** (Admin → Customers, `.xlsx` or `.csv`): columns `Company Name`/`Customer`, plus optional `Invoice Number` and `Title` (one invoice per row). An order export with `txtCustomerName`, `txtProductLineItem` (the invoice number) and `txtOrderText` (the title) is recognised as-is, so customers and invoices load from one file. Re-importing is safe — existing customers and invoices are left alone. "Deactivate confirmed invoices not in this file" syncs your open-invoice list; numbers employees typed in are never deactivated by it.
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

Tasks can be added or deactivated in **Admin → Tasks**. Each task has an associated category that auto-fills when the task is selected. Changes you make there are permanent; the built-in list in `app.py` is only used to fill an empty database.

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

## Backups

The database is backed up automatically once a day, on the first use of the day, into `data/backups/` (`timelog-YYYY-MM-DD.db`). The newest 30 are kept.

- **Keep a copy elsewhere.** Those files sit on the same computer as the app. Use **Admin → Export Data → Download backup now** from time to time, or set the `TIMELOG_BACKUP_DIR` environment variable to a folder on another drive or network share before starting the app.
- **Restoring.** Stop the app, replace `data/timelog.db` with the backup file you want (rename it to `timelog.db`), delete any `timelog.db-wal` / `timelog.db-shm` files next to it, and start the app again.
- The Export tab shows when the last automatic backup ran, and warns if one failed.

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

### Bringing the old entries into the new tracker

**Admin → Export Data → Bring old entries into the new tracker…** copies the old time entries in, so they show up in everyone's entry list, customer profiles, reports and exports. It shows a preview first and changes nothing until you confirm.

Import your customer list and order export first (Admin → Customers), so more entries find their customer. Each old entry gets its customer from, in order:

1. its job number, if that invoice is now on file;
2. the old job's customer name, matched to your customer list (case doesn't matter);
3. "Shop" → Shop / Internal;
4. a customer name not in your list → added as a pending customer for you to approve or merge in **Needs Review**;
5. no customer at all → a pending **Unknown customer (old tracker)**. Sort these out by moving their invoices to the right customer (Admin → Customers → Invoices → Edit), which moves the entries with them.

The old job number becomes the entry's invoice. Each copied entry's history notes that it came from the old tracker. The old data itself is left untouched, and running it again never copies anything twice.

To download the old data as it was logged instead, use **Download old tracker data (Excel)** on the same tab. Both options only appear on a database that was upgraded from the old version.
