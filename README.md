# TSi Job Time Tracker

A local web app for tracking employee time against jobs and tasks. Data is stored in SQLite and can be exported to Excel.

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

## Managing Jobs / Invoices

Jobs can be added and toggled active/inactive in **Admin → Jobs / Invoices**. Active jobs appear in the job search dropdown. Inactive jobs are hidden but old entries referencing them are preserved.

Employees can also type a job number directly if it isn't in the list yet — it will be saved as entered.

## Managing Tasks

Tasks can be added or deactivated in **Admin → Tasks**. Each task has an associated category that auto-fills when the task is selected.

The **Not Listed** task requires employees to fill in the Notes field describing the work.

## Exporting Data

1. Sign in as any employee
2. Click **Admin** → **Export Data** tab
3. Select a date range (leave blank for all data)
4. Click **Download Excel**

The export includes:
- **Time Entries** sheet: all entries with date, employee, job, task, category, hours, description, notes
- **Summary by Employee** sheet: total hours per employee for the period

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
├── app.py              # Flask server + all API routes
├── requirements.txt
├── data/
│   └── timelog.db      # SQLite database (auto-created)
├── static/
│   ├── style.css
│   └── app.js
└── templates/
    └── index.html
```
