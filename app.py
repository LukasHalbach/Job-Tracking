import os
import sqlite3
import hashlib
import json
from datetime import datetime, date
from flask import Flask, request, jsonify, render_template, send_file
import io
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "timelog.db")

TASKS = [
    ("Admin", "Admin"),
    ("Cleaning", "Cleaning up shop"),
    ("Client Artwork Review", "Pre-Production"),
    ("Client Communication", "Admin"),
    ("CNC Route – Sign Letters", "Laser / CNC"),
    ("Color Matching & Test Prints", "Pre-Production"),
    ("Courier / Delivery Coordination", "Shop Operations"),
    ("Department Head Coordination", "Admin"),
    ("Equipment Fault Investigation", "Equipment Maintenance"),
    ("File Prep & Art Setup", "Pre-Production"),
    ("Flat Bed Printing 200", "Printing"),
    ("Foam Cutting", "Foam Cutting"),
    ("Material / Substrate Receiving", "Shop Operations"),
    ("Morning Prep", "Shop Operations"),
    ("Prepress", "Pre-Production"),
    ("Proof Creation & Output", "Pre-Production"),
    ("Quote / Estimate Prep", "Admin"),
    ("Restock Material", "Restock"),
    ("Roll to Roll 300", "Large Format Print"),
    ("Shipping", "Inbound/Outbound"),
    ("Stock Take & Inventory Restock", "Shop Operations"),
    ("Summa Cutting", "Summa Plotting"),
    ("Supplier / Vendor Communication", "Admin"),
    ("Supply Run", "Out to buy supplies"),
    ("Table Work", "Finishing Work"),
    ("Team Meeting", "Admin"),
    ("Vehicle / Van Loading", "Shop Operations"),
    ("Vinyl Application – Flat Substrate", "Vinyl Application"),
    ("Wide Format Print – Banner / Vinyl", "Large Format Print"),
    ("Loading Machine", "Loading 55"),
    ("Reloading Machines", "Roll to Roll"),
    ("Trash", "Taking out Trash"),
    ("Laminate", "Laminating"),
    ("Helping With", "Heat Press"),
    ("Fabric Finishing", "Helping with Fabric"),
    ("On Site Install", "Installation"),
    ("Vehicle Maintenance / Repairs", "Shop Operations"),
    ("Plotting", "Contour Cuts"),
    ("Machine Maintenance", "Shop Operations"),
    ("Ordering Material", "Admin"),
    ("Hats", "Embroidery"),
    ("T-Shirts", "Embroidery"),
    ("Caddie Bibs", "Sewing"),
    ("Caddie Backs", "Sewing"),
    ("Direct to Fabric", "DGI Printing"),
    ("Transfer to Fabric", "Mimaki Dye Sub Printing"),
    ("Heat Press Fabric", "Heat Pressing"),
    ("Direct to Film", "DTF Printing"),
    ("Not Listed", "Other"),
]


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                pin_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_number TEXT NOT NULL,
                description TEXT DEFAULT '',
                active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                active INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS time_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER NOT NULL,
                entry_date TEXT NOT NULL,
                job_id INTEGER,
                job_number TEXT NOT NULL,
                task_id INTEGER,
                task_name TEXT NOT NULL,
                category TEXT NOT NULL,
                hours REAL NOT NULL,
                description TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (employee_id) REFERENCES employees(id)
            );
        """)

        # Seed tasks if empty
        count = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        if count == 0:
            conn.executemany(
                "INSERT INTO tasks (name, category) VALUES (?, ?)", TASKS
            )

        # Seed a default admin if no employees exist
        count = conn.execute("SELECT COUNT(*) FROM employees").fetchone()[0]
        if count == 0:
            conn.execute(
                "INSERT INTO employees (name, pin_hash, is_admin) VALUES (?, ?, 1)",
                ("Admin", hash_pin("0000")),
            )


# ── Auth helpers ─────────────────────────────────────────────────────────────

def verify_employee(employee_id: int, pin: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM employees WHERE id=? AND active=1", (employee_id,)
        ).fetchone()
    if row and row["pin_hash"] == hash_pin(pin):
        return dict(row)
    return None


def verify_admin(employee_id: int, pin: str):
    emp = verify_employee(employee_id, pin)
    if emp and emp["is_admin"]:
        return emp
    return None


# ── API Routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/employees", methods=["GET"])
def list_employees():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, is_admin FROM employees WHERE active=1 ORDER BY name"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/auth", methods=["POST"])
def auth():
    data = request.json
    emp = verify_employee(data.get("employee_id"), str(data.get("pin", "")))
    if emp:
        return jsonify({"ok": True, "name": emp["name"], "is_admin": bool(emp["is_admin"])})
    return jsonify({"ok": False}), 401


@app.route("/api/jobs", methods=["GET"])
def list_jobs():
    show_all = request.args.get("all") == "1"
    with get_db() as conn:
        if show_all:
            rows = conn.execute(
                "SELECT * FROM jobs ORDER BY active DESC, job_number"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM jobs WHERE active=1 ORDER BY job_number"
            ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/jobs", methods=["POST"])
def add_job():
    data = request.json
    if not verify_admin(data.get("employee_id"), str(data.get("pin", ""))):
        return jsonify({"error": "Unauthorized"}), 403
    job_number = (data.get("job_number") or "").strip()
    if not job_number:
        return jsonify({"error": "Job number required"}), 400
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO jobs (job_number, description) VALUES (?, ?)",
            (job_number, data.get("description", "")),
        )
        return jsonify({"id": cur.lastrowid, "job_number": job_number}), 201


@app.route("/api/jobs/<int:job_id>", methods=["PUT"])
def update_job(job_id):
    data = request.json
    if not verify_admin(data.get("employee_id"), str(data.get("pin", ""))):
        return jsonify({"error": "Unauthorized"}), 403
    with get_db() as conn:
        conn.execute(
            "UPDATE jobs SET job_number=?, description=?, active=? WHERE id=?",
            (data["job_number"], data.get("description", ""), int(data.get("active", 1)), job_id),
        )
    return jsonify({"ok": True})


@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    show_all = request.args.get("all") == "1"
    with get_db() as conn:
        if show_all:
            rows = conn.execute(
                "SELECT * FROM tasks ORDER BY active DESC, name"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE active=1 ORDER BY name"
            ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/tasks", methods=["POST"])
def add_task():
    data = request.json
    if not verify_admin(data.get("employee_id"), str(data.get("pin", ""))):
        return jsonify({"error": "Unauthorized"}), 403
    name = (data.get("name") or "").strip()
    category = (data.get("category") or "").strip()
    if not name or not category:
        return jsonify({"error": "Name and category required"}), 400
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO tasks (name, category) VALUES (?, ?)", (name, category)
        )
        return jsonify({"id": cur.lastrowid, "name": name, "category": category}), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    data = request.json
    if not verify_admin(data.get("employee_id"), str(data.get("pin", ""))):
        return jsonify({"error": "Unauthorized"}), 403
    with get_db() as conn:
        conn.execute(
            "UPDATE tasks SET name=?, category=?, active=? WHERE id=?",
            (data["name"], data["category"], int(data.get("active", 1)), task_id),
        )
    return jsonify({"ok": True})


@app.route("/api/entries", methods=["GET"])
def list_entries():
    employee_id = request.args.get("employee_id")
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")
    all_employees = request.args.get("all_employees") == "1"

    query = """
        SELECT te.*, e.name as employee_name
        FROM time_entries te
        JOIN employees e ON te.employee_id = e.id
        WHERE 1=1
    """
    params = []

    if not all_employees and employee_id:
        query += " AND te.employee_id = ?"
        params.append(employee_id)

    if date_from:
        query += " AND te.entry_date >= ?"
        params.append(date_from)

    if date_to:
        query += " AND te.entry_date <= ?"
        params.append(date_to)

    query += " ORDER BY te.entry_date DESC, te.created_at DESC LIMIT 200"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/entries", methods=["POST"])
def add_entry():
    data = request.json
    emp = verify_employee(data.get("employee_id"), str(data.get("pin", "")))
    if not emp:
        return jsonify({"error": "Unauthorized"}), 401

    job_number = (data.get("job_number") or "").strip()
    task_name = (data.get("task_name") or "").strip()
    category = (data.get("category") or "").strip()
    hours = float(data.get("hours") or 0)

    if not job_number:
        return jsonify({"error": "Job number required"}), 400
    if not task_name:
        return jsonify({"error": "Task required"}), 400
    if hours <= 0:
        return jsonify({"error": "Hours must be greater than 0"}), 400

    entry_date = data.get("entry_date") or date.today().isoformat()

    with get_db() as conn:
        # Resolve job_id
        job_row = conn.execute(
            "SELECT id FROM jobs WHERE job_number=?", (job_number,)
        ).fetchone()
        job_id = job_row["id"] if job_row else None

        # Resolve task_id
        task_row = conn.execute(
            "SELECT id FROM tasks WHERE name=? AND active=1", (task_name,)
        ).fetchone()
        task_id = task_row["id"] if task_row else None

        cur = conn.execute(
            """INSERT INTO time_entries
               (employee_id, entry_date, job_id, job_number, task_id, task_name,
                category, hours, description, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                emp["id"], entry_date, job_id, job_number, task_id, task_name,
                category, hours,
                data.get("description", ""),
                data.get("notes", ""),
            ),
        )
        return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/entries/<int:entry_id>", methods=["PUT"])
def update_entry(entry_id):
    data = request.json
    emp = verify_employee(data.get("employee_id"), str(data.get("pin", "")))
    if not emp:
        return jsonify({"error": "Unauthorized"}), 401

    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM time_entries WHERE id=?", (entry_id,)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Entry not found"}), 404
        # Only admin or the owning employee can edit
        if not emp["is_admin"] and existing["employee_id"] != emp["id"]:
            return jsonify({"error": "Forbidden"}), 403

        job_number = (data.get("job_number") or "").strip()
        task_name = (data.get("task_name") or "").strip()
        hours = float(data.get("hours") or 0)

        job_row = conn.execute(
            "SELECT id FROM jobs WHERE job_number=?", (job_number,)
        ).fetchone()
        job_id = job_row["id"] if job_row else None

        task_row = conn.execute(
            "SELECT id FROM tasks WHERE name=?", (task_name,)
        ).fetchone()
        task_id = task_row["id"] if task_row else None

        conn.execute(
            """UPDATE time_entries SET
               entry_date=?, job_id=?, job_number=?, task_id=?, task_name=?,
               category=?, hours=?, description=?, notes=?,
               updated_at=datetime('now')
               WHERE id=?""",
            (
                data.get("entry_date", existing["entry_date"]),
                job_id, job_number, task_id, task_name,
                data.get("category", existing["category"]),
                hours,
                data.get("description", existing["description"]),
                data.get("notes", existing["notes"]),
                entry_id,
            ),
        )
    return jsonify({"ok": True})


@app.route("/api/entries/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id):
    data = request.json
    emp = verify_employee(data.get("employee_id"), str(data.get("pin", "")))
    if not emp:
        return jsonify({"error": "Unauthorized"}), 401

    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM time_entries WHERE id=?", (entry_id,)
        ).fetchone()
        if not existing:
            return jsonify({"error": "Entry not found"}), 404
        if not emp["is_admin"] and existing["employee_id"] != emp["id"]:
            return jsonify({"error": "Forbidden"}), 403
        conn.execute("DELETE FROM time_entries WHERE id=?", (entry_id,))
    return jsonify({"ok": True})


# ── Admin: Employees ──────────────────────────────────────────────────────────

@app.route("/api/admin/employees", methods=["GET"])
def admin_list_employees():
    data = request.args
    if not verify_admin(data.get("employee_id"), str(data.get("pin", ""))):
        return jsonify({"error": "Unauthorized"}), 403
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, is_admin, active FROM employees ORDER BY name"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/admin/employees", methods=["POST"])
def admin_add_employee():
    data = request.json
    if not verify_admin(data.get("employee_id"), str(data.get("pin", ""))):
        return jsonify({"error": "Unauthorized"}), 403
    name = (data.get("name") or "").strip()
    pin = str(data.get("new_pin") or "").strip()
    if not name or not pin:
        return jsonify({"error": "Name and PIN required"}), 400
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO employees (name, pin_hash, is_admin) VALUES (?, ?, ?)",
            (name, hash_pin(pin), int(data.get("is_admin", 0))),
        )
    return jsonify({"id": cur.lastrowid, "name": name}), 201


@app.route("/api/admin/employees/<int:emp_id>", methods=["PUT"])
def admin_update_employee(emp_id):
    data = request.json
    if not verify_admin(data.get("employee_id"), str(data.get("pin", ""))):
        return jsonify({"error": "Unauthorized"}), 403
    with get_db() as conn:
        if data.get("new_pin"):
            conn.execute(
                "UPDATE employees SET name=?, pin_hash=?, is_admin=?, active=? WHERE id=?",
                (data["name"], hash_pin(str(data["new_pin"])),
                 int(data.get("is_admin", 0)), int(data.get("active", 1)), emp_id),
            )
        else:
            conn.execute(
                "UPDATE employees SET name=?, is_admin=?, active=? WHERE id=?",
                (data["name"], int(data.get("is_admin", 0)),
                 int(data.get("active", 1)), emp_id),
            )
    return jsonify({"ok": True})


# ── Export ────────────────────────────────────────────────────────────────────

@app.route("/api/export", methods=["GET"])
def export_excel():
    date_from = request.args.get("date_from", "")
    date_to = request.args.get("date_to", "")
    employee_id = request.args.get("employee_id", "")
    emp_pin = request.args.get("pin", "")

    # Must be authenticated
    if not verify_employee(int(employee_id) if employee_id else 0, emp_pin):
        return jsonify({"error": "Unauthorized"}), 401

    query = """
        SELECT te.entry_date, e.name as employee_name, te.job_number,
               te.task_name, te.category, te.hours, te.description, te.notes,
               te.created_at, te.updated_at
        FROM time_entries te
        JOIN employees e ON te.employee_id = e.id
        WHERE 1=1
    """
    params = []
    if date_from:
        query += " AND te.entry_date >= ?"
        params.append(date_from)
    if date_to:
        query += " AND te.entry_date <= ?"
        params.append(date_to)
    query += " ORDER BY te.entry_date, e.name, te.created_at"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Time Entries"

    header_fill = PatternFill("solid", fgColor="1F4E79")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    center = Alignment(horizontal="center", vertical="center")
    wrap = Alignment(wrap_text=True, vertical="top")
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    headers = ["Date", "Employee", "Job / Invoice #", "Task", "Category",
               "Hours", "Description", "Notes"]
    col_widths = [12, 20, 18, 30, 25, 8, 35, 35]

    for col, (header, width) in enumerate(zip(headers, col_widths), 1):
        cell = ws.cell(row=1, column=col, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = border
        ws.column_dimensions[get_column_letter(col)].width = width

    ws.row_dimensions[1].height = 22

    alt_fill = PatternFill("solid", fgColor="EBF3FB")

    for row_idx, row in enumerate(rows, 2):
        fill = alt_fill if row_idx % 2 == 0 else None
        values = [
            row["entry_date"],
            row["employee_name"],
            row["job_number"],
            row["task_name"],
            row["category"],
            row["hours"],
            row["description"],
            row["notes"],
        ]
        for col, val in enumerate(values, 1):
            cell = ws.cell(row=row_idx, column=col, value=val)
            cell.border = border
            cell.alignment = wrap
            if fill:
                cell.fill = fill

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:H{max(len(rows) + 1, 2)}"

    # Summary sheet
    ws2 = wb.create_sheet("Summary by Employee")
    ws2.column_dimensions["A"].width = 22
    ws2.column_dimensions["B"].width = 12
    ws2.column_dimensions["C"].width = 18
    ws2.column_dimensions["D"].width = 18

    s_headers = ["Employee", "Total Hours", "Date From", "Date To"]
    for col, h in enumerate(s_headers, 1):
        cell = ws2.cell(row=1, column=col, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center

    # Aggregate by employee
    from collections import defaultdict
    emp_hours = defaultdict(float)
    emp_dates = defaultdict(list)
    for row in rows:
        emp_hours[row["employee_name"]] += row["hours"]
        emp_dates[row["employee_name"]].append(row["entry_date"])

    for r, (emp_name, total) in enumerate(sorted(emp_hours.items()), 2):
        dates = emp_dates[emp_name]
        ws2.cell(row=r, column=1, value=emp_name)
        ws2.cell(row=r, column=2, value=round(total, 2))
        ws2.cell(row=r, column=3, value=min(dates))
        ws2.cell(row=r, column=4, value=max(dates))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"time_entries_{date_from or 'all'}_{date_to or 'all'}.xlsx"
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=False)
