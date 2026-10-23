import os
import sqlite3
import hashlib
import json
import csv
import io
from collections import defaultdict
from datetime import datetime, date
from flask import Flask, request, jsonify, render_template, send_file
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

app = Flask(__name__)
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DATA_DIR, "timelog.db")
LEGACY_BACKUP_PATH = os.path.join(DATA_DIR, "timelog.pre-customer-overhaul.db")

NOT_LISTED = "Not Listed"
SHOP_CUSTOMER = "Shop / Internal"

TASKS = [
    ("Roll Printing",               "Printing"),
    ("Sheet Printing",              "Printing"),
    ("Direct to Fabric Printing",   "Printing"),
    ("On-Site Printing",            "Printing"),
    ("Contour Cutting",             "Cutting"),
    ("Foam Cutting",                "Cutting"),
    ("Laminating",                  "Finishing"),
    ("Heat Press",                  "Finishing"),
    ("Vinyl Application",           "Finishing"),
    ("Table Work",                  "Finishing"),
    ("Fabric Finishing",            "Finishing"),
    ("Edge Welding",                "Finishing"),
    ("CNC Routing",                 "Fabrication"),
    ("Laser Engraving",             "Fabrication"),
    ("3D Printing",                 "Fabrication"),
    ("Metal Fabrication",           "Fabrication"),
    ("Wood Fabrication",            "Fabrication"),
    ("Embroidery",                  "Embroidery & Sewing"),
    ("Sewing",                      "Embroidery & Sewing"),
    ("On-Site Installation",        "Installation"),
    ("Vehicle Loading",             "Installation"),
    ("File Prep & Art Setup",       "Pre-Production"),
    ("Prepress",                    "Pre-Production"),
    ("Color Matching & Test Prints","Pre-Production"),
    ("Proof Creation & Output",     "Pre-Production"),
    ("Client Artwork Review",       "Pre-Production"),
    ("Morning Prep",                "Shop Operations"),
    ("Inventory Management",        "Shop Operations"),
    ("Ordering Material",           "Shop Operations"),
    ("Shipping",                    "Shop Operations"),
    ("Cleaning",                    "Shop Operations"),
    ("Machine Maintenance",         "Equipment Maintenance"),
    ("Vehicle Maintenance",         "Equipment Maintenance"),
    ("Loading Machines",            "Equipment Maintenance"),
    ("Admin",                       "Admin"),
    ("Client Communication",        "Admin"),
    ("Estimate Prep",               "Admin"),
    ("Vendor Communication",        "Admin"),
    ("Department Head Coordination","Admin"),
    ("Team Meeting",                "Admin"),
    ("Training",                    "Admin"),
    ("Assisting",                   "Admin"),
    (NOT_LISTED,                    "Other"),
]


# ── Errors ───────────────────────────────────────────────────────────────────

class ApiError(Exception):
    """Raised anywhere inside a request. Because it propagates out of any open
    `with get_db()` block, the transaction is rolled back automatically."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


@app.errorhandler(ApiError)
def handle_api_error(err):
    return jsonify({"error": err.message}), err.status


# ── Database ─────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def table_columns(conn, table):
    return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)

    # Databases from the invoice-centred version have a `jobs` table. Back the file
    # up once, then set the old job/entry tables aside (renamed, never dropped).
    legacy = False
    if os.path.exists(DB_PATH):
        probe = sqlite3.connect(DB_PATH)
        legacy = probe.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'"
        ).fetchone() is not None
        if legacy and not os.path.exists(LEGACY_BACKUP_PATH):
            dst = sqlite3.connect(LEGACY_BACKUP_PATH)
            probe.backup(dst)
            dst.close()
        probe.close()

    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                pin_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                role_id INTEGER REFERENCES roles(id)
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                active INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS role_tasks (
                role_id INTEGER NOT NULL,
                task_id INTEGER NOT NULL,
                PRIMARY KEY (role_id, task_id),
                FOREIGN KEY (role_id) REFERENCES roles(id),
                FOREIGN KEY (task_id) REFERENCES tasks(id)
            );
        """)
        if "role_id" not in table_columns(conn, "employees"):
            conn.execute("ALTER TABLE employees ADD COLUMN role_id INTEGER REFERENCES roles(id)")

        if legacy:
            conn.execute("ALTER TABLE jobs RENAME TO legacy_jobs")
            if "job_number" in table_columns(conn, "time_entries"):
                conn.execute("ALTER TABLE time_entries RENAME TO legacy_time_entries")

        # status 'pending' = created by an employee on the fly (not yet in the
        # system); an admin reviews it and flips it to 'verified'.
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                notes TEXT DEFAULT '',
                active INTEGER DEFAULT 1,
                is_system INTEGER DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'verified',
                created_by INTEGER REFERENCES employees(id),
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_name
                ON customers(name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                invoice_number TEXT NOT NULL,
                title TEXT DEFAULT '',
                active INTEGER DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'verified',
                created_by INTEGER REFERENCES employees(id),
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number
                ON invoices(invoice_number COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);

            CREATE TABLE IF NOT EXISTS time_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER NOT NULL REFERENCES employees(id),
                entry_date TEXT NOT NULL,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                invoice_id INTEGER REFERENCES invoices(id),
                task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
                task_name TEXT NOT NULL,
                category TEXT NOT NULL,
                hours REAL NOT NULL,
                notes TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime')),
                updated_at TEXT DEFAULT (datetime('now','localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_entries_customer ON time_entries(customer_id);
            CREATE INDEX IF NOT EXISTS idx_entries_invoice  ON time_entries(invoice_id);
            CREATE INDEX IF NOT EXISTS idx_entries_date     ON time_entries(entry_date);
            CREATE INDEX IF NOT EXISTS idx_entries_employee ON time_entries(employee_id);

            -- Append-only record of every change. `changes` is {field: [old, new]},
            -- `snapshot` is the full record for creates/deletes/merges.
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                actor_id INTEGER,
                actor_name TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER,
                entity_label TEXT DEFAULT '',
                customer_id INTEGER,
                changes TEXT,
                snapshot TEXT,
                note TEXT DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_audit_entity   ON audit_log(entity_type, entity_id);
            CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit_log(customer_id);
            CREATE INDEX IF NOT EXISTS idx_audit_ts       ON audit_log(ts);
        """)

        system = {"id": None, "name": "System"}

        # Protected internal customer so shop work still has a customer to log against
        if not conn.execute("SELECT 1 FROM customers WHERE is_system=1").fetchone():
            cur = conn.execute(
                "INSERT INTO customers (name, notes, is_system) VALUES (?, ?, 1)",
                (SHOP_CUSTOMER, "General shop work not tied to a customer"),
            )
            audit(conn, system, "create", "customer", cur.lastrowid, SHOP_CUSTOMER,
                  customer_id=cur.lastrowid, note="Seeded system customer")

        # Sync tasks — add new, reactivate returning, deactivate removed
        canonical = dict(TASKS)
        existing = {row["name"]: row for row in
                    conn.execute("SELECT id, name, category, active FROM tasks").fetchall()}
        for name, category in TASKS:
            row = existing.get(name)
            if row is None:
                cur = conn.execute("INSERT INTO tasks (name, category) VALUES (?, ?)",
                                   (name, category))
                audit(conn, system, "create", "task", cur.lastrowid, name,
                      snapshot={"name": name, "category": category}, note="Seeded from built-in task list")
            elif row["category"] != category or not row["active"]:
                changes = {}
                if row["category"] != category:
                    changes["category"] = [row["category"], category]
                if not row["active"]:
                    changes["active"] = [0, 1]
                conn.execute("UPDATE tasks SET category=?, active=1 WHERE id=?",
                             (category, row["id"]))
                audit(conn, system, "update", "task", row["id"], name, changes=changes,
                      note="Reset to built-in task list on startup")
        for name, row in existing.items():
            if name not in canonical and row["active"]:
                conn.execute("UPDATE tasks SET active=0 WHERE id=?", (row["id"],))
                audit(conn, system, "deactivate", "task", row["id"], name,
                      changes={"active": [1, 0]},
                      note="Not in built-in task list; deactivated on startup")

        # Seed a default admin if no employees exist
        if conn.execute("SELECT COUNT(*) FROM employees").fetchone()[0] == 0:
            cur = conn.execute(
                "INSERT INTO employees (name, pin_hash, is_admin) VALUES (?, ?, 1)",
                ("Admin", hash_pin("0000")),
            )
            audit(conn, system, "create", "employee", cur.lastrowid, "Admin",
                  snapshot={"name": "Admin", "is_admin": 1}, note="Seeded default admin")

        if legacy:
            audit(conn, system, "migrate", "system", None, "Customer-centred overhaul",
                  note="Old jobs and time entries were set aside as legacy_jobs / "
                       "legacy_time_entries; a full backup was saved to "
                       "data/timelog.pre-customer-overhaul.db")


# ── Audit helpers ────────────────────────────────────────────────────────────

def audit(conn, actor, action, entity_type, entity_id, label, *,
          changes=None, snapshot=None, customer_id=None, note=""):
    """Append one row to the audit log. `actor` is an employee dict (or the
    {"id": None, "name": "System"} placeholder)."""
    conn.execute(
        """INSERT INTO audit_log
           (actor_id, actor_name, action, entity_type, entity_id, entity_label,
            customer_id, changes, snapshot, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (actor["id"], actor["name"], action, entity_type, entity_id, label,
         customer_id,
         json.dumps(changes) if changes else None,
         json.dumps(snapshot) if snapshot else None,
         note),
    )


def norm(v):
    return "" if v is None else v


def diff(old, new, fields):
    """{field: [old, new]} for every listed field whose value differs."""
    return {f: [norm(old.get(f)), norm(new.get(f))]
            for f in fields if norm(old.get(f)) != norm(new.get(f))}


def row_dict(row, *fields):
    return {f: row[f] for f in fields}


# ── Auth helpers ─────────────────────────────────────────────────────────────

def verify_employee(employee_id, pin: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM employees WHERE id=? AND active=1", (employee_id,)
        ).fetchone()
    if row and row["pin_hash"] == hash_pin(pin):
        return dict(row)
    return None


def current_employee(source, admin=False):
    """Authenticate from a JSON body or query-string mapping."""
    emp = verify_employee(source.get("employee_id"), str(source.get("pin", "")))
    if not emp:
        raise ApiError("Unauthorized", 403 if admin else 401)
    if admin and not emp["is_admin"]:
        raise ApiError("Unauthorized — admin access required", 403)
    return emp


def body():
    return request.get_json(silent=True) or {}


# ── Input helpers ────────────────────────────────────────────────────────────

def clean(value):
    """Trim and collapse internal whitespace."""
    return " ".join(str(value or "").split())


def parse_date(value, default=None):
    if not value:
        if default:
            return default
        return date.today().isoformat()
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date().isoformat()
    except ValueError:
        raise ApiError("Date must be in YYYY-MM-DD format.")


def parse_hours(value):
    try:
        hours = float(value or 0)
    except (TypeError, ValueError):
        raise ApiError("Hours must be a number.")
    if hours <= 0:
        raise ApiError("Hours must be greater than 0.")
    if hours > 24:
        raise ApiError("Hours cannot be more than 24 for a single entry.")
    return hours


def split_hours(total, n):
    """Divide hours into n parts that add back up to the total."""
    base = round(total / n, 2)
    return [base] * (n - 1) + [round(total - base * (n - 1), 2)]


# ── Customers / invoices: resolve-or-create ──────────────────────────────────

def resolve_customer(conn, emp, data, current_id=None):
    """Return the customer row for an entry payload. `customer_id` selects an
    existing customer; `new_customer` names one that isn't in the system yet and
    creates it (pending admin review unless an admin is doing the typing)."""
    cid = data.get("customer_id")
    if cid:
        row = conn.execute("SELECT * FROM customers WHERE id=?", (cid,)).fetchone()
        if not row:
            raise ApiError("Customer not found.")
        if not row["active"] and row["id"] != current_id:
            raise ApiError(f"'{row['name']}' is inactive. Ask an admin to reactivate it.")
        return row

    name = clean(data.get("new_customer"))
    if not name:
        raise ApiError("Please select a customer.")
    row = conn.execute("SELECT * FROM customers WHERE name=? COLLATE NOCASE", (name,)).fetchone()
    if row:
        if not row["active"] and row["id"] != current_id:
            raise ApiError(f"'{row['name']}' is inactive. Ask an admin to reactivate it.")
        return row

    status = "verified" if emp["is_admin"] else "pending"
    cur = conn.execute(
        "INSERT INTO customers (name, status, created_by) VALUES (?, ?, ?)",
        (name, status, emp["id"]),
    )
    audit(conn, emp, "create", "customer", cur.lastrowid, name, customer_id=cur.lastrowid,
          snapshot={"name": name, "status": status},
          note="Added on the fly while logging time" +
               ("" if emp["is_admin"] else " — pending admin review"))
    return conn.execute("SELECT * FROM customers WHERE id=?", (cur.lastrowid,)).fetchone()


def resolve_invoice(conn, emp, customer, spec, current_invoice=None):
    """Return the invoice row for `spec` ({'id': n} or {'number': 'text'}) under
    `customer`, creating a pending invoice when the number isn't on file yet."""
    if isinstance(spec, (str, int)):
        spec = {"number": spec}
    spec = spec or {}

    if spec.get("id"):
        inv = conn.execute("SELECT * FROM invoices WHERE id=?", (spec["id"],)).fetchone()
        if not inv:
            raise ApiError("Invoice not found.")
    else:
        number = clean(spec.get("number"))
        if not number:
            raise ApiError("Invoice number is empty.")
        inv = conn.execute(
            "SELECT * FROM invoices WHERE invoice_number=? COLLATE NOCASE", (number,)
        ).fetchone()
        if not inv:
            status = "verified" if emp["is_admin"] else "pending"
            cur = conn.execute(
                "INSERT INTO invoices (customer_id, invoice_number, status, created_by) "
                "VALUES (?, ?, ?, ?)",
                (customer["id"], number, status, emp["id"]),
            )
            audit(conn, emp, "create", "invoice", cur.lastrowid,
                  f"{number} ({customer['name']})", customer_id=customer["id"],
                  snapshot={"invoice_number": number, "customer": customer["name"],
                            "status": status},
                  note="Added on the fly while logging time" +
                       ("" if emp["is_admin"] else " — pending admin review"))
            return conn.execute("SELECT * FROM invoices WHERE id=?", (cur.lastrowid,)).fetchone()

    if inv["customer_id"] != customer["id"]:
        owner = conn.execute("SELECT name FROM customers WHERE id=?", (inv["customer_id"],)).fetchone()
        raise ApiError(f"Invoice {inv['invoice_number']} is on file under "
                       f"'{owner['name']}', not '{customer['name']}'. "
                       "Select that customer or check the invoice number.")
    if not inv["active"] and (current_invoice is None or inv["id"] != current_invoice):
        raise ApiError(f"Invoice {inv['invoice_number']} is inactive. Ask an admin to reactivate it.")
    return inv


# ── Entry helpers ────────────────────────────────────────────────────────────

ENTRY_SELECT = """
    SELECT te.*, e.name AS employee_name,
           c.name AS customer_name, c.status AS customer_status,
           i.invoice_number, i.title AS invoice_title, i.status AS invoice_status,
           (SELECT COUNT(*) FROM audit_log a
             WHERE a.entity_type='entry' AND a.entity_id=te.id AND a.action='update') AS edit_count
    FROM time_entries te
    JOIN employees e ON e.id = te.employee_id
    JOIN customers c ON c.id = te.customer_id
    LEFT JOIN invoices i ON i.id = te.invoice_id
"""
ENTRY_FIELDS = ["date", "customer", "invoice", "task", "category", "hours", "notes"]


def entry_dict(row):
    d = dict(row)
    d["invoice_number"] = d["invoice_number"] or ""
    d["invoice_title"] = d["invoice_title"] or ""
    return d


def fetch_entry(conn, entry_id):
    row = conn.execute(ENTRY_SELECT + " WHERE te.id=?", (entry_id,)).fetchone()
    return entry_dict(row) if row else None


def entry_view(d):
    """Human-readable shape of an entry — what the audit log stores and diffs."""
    return {
        "date": d["entry_date"], "employee": d["employee_name"],
        "customer": d["customer_name"], "invoice": d["invoice_number"] or "",
        "task": d["task_name"], "category": d["category"],
        "hours": d["hours"], "notes": d["notes"] or "",
    }


def entry_label(v):
    return (f"{v['customer']} · {v['invoice'] or 'no invoice'} · {v['task']} · "
            f"{v['hours']:g}h on {v['date']} ({v['employee']})")


def resolve_task(conn, name, existing_name=None):
    name = clean(name)
    if not name:
        raise ApiError("Please select a task.")
    task = conn.execute("SELECT * FROM tasks WHERE name=?", (name,)).fetchone()
    if not task or (not task["active"] and name != existing_name):
        raise ApiError(f"'{name}' is not on the task list. Please select a task from the dropdown.")
    return task


def require_notes_if_not_listed(task_name, notes):
    if task_name == NOT_LISTED and not notes:
        raise ApiError("Please describe the task in the Notes field.")


# ── Routes: pages & login ────────────────────────────────────────────────────

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
    data = body()
    emp = verify_employee(data.get("employee_id"), str(data.get("pin", "")))
    if not emp:
        return jsonify({"ok": False}), 401
    allowed_task_ids = None
    if not emp["is_admin"] and emp.get("role_id"):
        with get_db() as conn:
            task_rows = conn.execute(
                "SELECT task_id FROM role_tasks WHERE role_id=?", (emp["role_id"],)
            ).fetchall()
            not_listed = conn.execute(
                "SELECT id FROM tasks WHERE name=?", (NOT_LISTED,)
            ).fetchone()
        allowed_task_ids = [r["task_id"] for r in task_rows]
        if not_listed and not_listed["id"] not in allowed_task_ids:
            allowed_task_ids.append(not_listed["id"])
    return jsonify({
        "ok": True,
        "name": emp["name"],
        "is_admin": bool(emp["is_admin"]),
        "allowed_task_ids": allowed_task_ids,
    })


# ── Routes: customers ────────────────────────────────────────────────────────

CUSTOMER_FIELDS = ["name", "notes", "active", "status"]


@app.route("/api/customers", methods=["GET"])
def list_customers():
    """Customer list. With stats=1 (authenticated) each row also carries the
    caller's logged hours — every employee's, for an admin."""
    show_all = request.args.get("all") == "1"
    stats = request.args.get("stats") == "1"
    params = []
    extra = ""
    if stats:
        emp = current_employee(request.args)
        scope = "" if emp["is_admin"] else " AND te.employee_id = ?"
        scope_params = [] if emp["is_admin"] else [emp["id"]]
        extra = f""",
            (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te
              WHERE te.customer_id = c.id{scope}) AS total_hours,
            (SELECT COUNT(*) FROM time_entries te
              WHERE te.customer_id = c.id{scope}) AS entry_count,
            (SELECT MAX(te.entry_date) FROM time_entries te
              WHERE te.customer_id = c.id{scope}) AS last_entry"""
        params = scope_params * 3
    where = "" if show_all else "WHERE c.active = 1"
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT c.*,
                   (SELECT COUNT(*) FROM invoices i
                     WHERE i.customer_id = c.id AND i.active = 1) AS invoice_count{extra}
            FROM customers c {where}
            ORDER BY c.is_system DESC, c.active DESC, c.name COLLATE NOCASE
        """, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/customers", methods=["POST"])
def add_customer():
    data = body()
    emp = current_employee(data, admin=True)
    name = clean(data.get("name"))
    if not name:
        raise ApiError("Customer name required.")
    with get_db() as conn:
        if conn.execute("SELECT 1 FROM customers WHERE name=? COLLATE NOCASE", (name,)).fetchone():
            raise ApiError(f"A customer named '{name}' already exists.", 409)
        cur = conn.execute(
            "INSERT INTO customers (name, notes, created_by) VALUES (?, ?, ?)",
            (name, (data.get("notes") or "").strip(), emp["id"]),
        )
        audit(conn, emp, "create", "customer", cur.lastrowid, name, customer_id=cur.lastrowid,
              snapshot={"name": name, "notes": (data.get("notes") or "").strip()})
    return jsonify({"id": cur.lastrowid, "name": name}), 201


@app.route("/api/customers/<int:cid>", methods=["PUT"])
def update_customer(cid):
    data = body()
    emp = current_employee(data, admin=True)
    with get_db() as conn:
        old = conn.execute("SELECT * FROM customers WHERE id=?", (cid,)).fetchone()
        if not old:
            raise ApiError("Customer not found.", 404)
        if old["is_system"]:
            raise ApiError("The system customer cannot be edited.", 403)
        new = {
            "name": clean(data.get("name", old["name"])),
            "notes": (data.get("notes", old["notes"]) or "").strip(),
            "active": int(data.get("active", old["active"])),
            "status": data.get("status", old["status"]),
        }
        if not new["name"]:
            raise ApiError("Customer name required.")
        if new["status"] not in ("verified", "pending"):
            raise ApiError("Invalid status.")
        clash = conn.execute(
            "SELECT id FROM customers WHERE name=? COLLATE NOCASE AND id<>?", (new["name"], cid)
        ).fetchone()
        if clash:
            raise ApiError(f"A customer named '{new['name']}' already exists. "
                           "Use Merge to combine them.", 409)
        changes = diff(dict(old), new, CUSTOMER_FIELDS)
        if changes:
            conn.execute(
                """UPDATE customers SET name=?, notes=?, active=?, status=?,
                   updated_at=datetime('now','localtime') WHERE id=?""",
                (new["name"], new["notes"], new["active"], new["status"], cid),
            )
            keys = set(changes)
            if keys == {"status"} and new["status"] == "verified":
                action = "verify"
            elif keys == {"active"}:
                action = "activate" if new["active"] else "deactivate"
            else:
                action = "update"
            audit(conn, emp, action, "customer", cid, new["name"],
                  customer_id=cid, changes=changes)
    return jsonify({"ok": True})


@app.route("/api/customers/<int:cid>", methods=["DELETE"])
def delete_customer(cid):
    data = body()
    emp = current_employee(data, admin=True)
    with get_db() as conn:
        c = conn.execute("SELECT * FROM customers WHERE id=?", (cid,)).fetchone()
        if not c:
            raise ApiError("Customer not found.", 404)
        if c["is_system"]:
            raise ApiError("The system customer cannot be deleted.", 403)
        n = conn.execute("SELECT COUNT(*) FROM time_entries WHERE customer_id=?", (cid,)).fetchone()[0]
        if n:
            raise ApiError(f"'{c['name']}' has {n} time entr{'y' if n == 1 else 'ies'}, so it can't "
                           "be deleted. Merge it into another customer, or mark it inactive.", 409)
        invs = conn.execute("SELECT invoice_number FROM invoices WHERE customer_id=?", (cid,)).fetchall()
        conn.execute("DELETE FROM invoices WHERE customer_id=?", (cid,))
        conn.execute("DELETE FROM customers WHERE id=?", (cid,))
        audit(conn, emp, "delete", "customer", cid, c["name"], customer_id=cid,
              snapshot={**row_dict(c, "name", "notes", "active", "status", "created_at"),
                        "invoices_removed": [r["invoice_number"] for r in invs]})
    return jsonify({"ok": True})


@app.route("/api/customers/<int:cid>/merge", methods=["POST"])
def merge_customer(cid):
    """Fold customer `cid` into `into_id`: invoices and entries move across and
    the now-empty source customer is removed."""
    data = body()
    emp = current_employee(data, admin=True)
    into_id = data.get("into_id")
    with get_db() as conn:
        src = conn.execute("SELECT * FROM customers WHERE id=?", (cid,)).fetchone()
        dst = conn.execute("SELECT * FROM customers WHERE id=?", (into_id,)).fetchone()
        if not src or not dst:
            raise ApiError("Customer not found.", 404)
        if src["id"] == dst["id"]:
            raise ApiError("Pick a different customer to merge into.")
        if src["is_system"] or dst["is_system"]:
            raise ApiError("The system customer cannot be merged.", 403)
        entry_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM time_entries WHERE customer_id=?", (cid,)).fetchall()]
        invoice_numbers = [r["invoice_number"] for r in conn.execute(
            "SELECT invoice_number FROM invoices WHERE customer_id=?", (cid,)).fetchall()]
        conn.execute("UPDATE time_entries SET customer_id=? WHERE customer_id=?", (dst["id"], cid))
        conn.execute("UPDATE invoices SET customer_id=? WHERE customer_id=?", (dst["id"], cid))
        # Re-point history so the target's timeline keeps the source's story;
        # only the customer link moves, never the recorded content.
        conn.execute("UPDATE audit_log SET customer_id=? WHERE customer_id=?", (dst["id"], cid))
        conn.execute("DELETE FROM customers WHERE id=?", (cid,))
        audit(conn, emp, "merge", "customer", dst["id"], dst["name"], customer_id=dst["id"],
              snapshot={"merged_customer": row_dict(src, "name", "notes", "status", "created_at"),
                        "entries_moved": len(entry_ids), "entry_ids": entry_ids,
                        "invoices_moved": invoice_numbers},
              note=f"Merged '{src['name']}' into '{dst['name']}'")
    return jsonify({"ok": True, "entries_moved": len(entry_ids),
                    "invoices_moved": len(invoice_numbers)})


@app.route("/api/customers/<int:cid>/detail", methods=["GET"])
def customer_detail(cid):
    """Everything about one customer: invoices, hours by task/employee, recent
    entries (and, for admins, the change history)."""
    emp = current_employee(request.args)
    scope = "" if emp["is_admin"] else " AND te.employee_id = ?"
    sp = [] if emp["is_admin"] else [emp["id"]]
    with get_db() as conn:
        c = conn.execute("SELECT * FROM customers WHERE id=?", (cid,)).fetchone()
        if not c:
            raise ApiError("Customer not found.", 404)
        invoices = conn.execute(f"""
            SELECT i.*, COALESCE(SUM(te.hours), 0) AS hours, COUNT(te.id) AS entries,
                   MAX(te.entry_date) AS last_entry
            FROM invoices i
            LEFT JOIN time_entries te ON te.invoice_id = i.id{scope}
            WHERE i.customer_id = ?
            GROUP BY i.id
            ORDER BY i.active DESC, i.invoice_number COLLATE NOCASE
        """, sp + [cid]).fetchall()
        totals = conn.execute(f"""
            SELECT COALESCE(SUM(hours), 0) AS hours, COUNT(*) AS entries, MAX(entry_date) AS last_entry
            FROM time_entries te WHERE te.customer_id = ?{scope}
        """, [cid] + sp).fetchone()
        no_invoice = conn.execute(f"""
            SELECT COALESCE(SUM(hours), 0) AS hours, COUNT(*) AS entries
            FROM time_entries te WHERE te.customer_id = ? AND te.invoice_id IS NULL{scope}
        """, [cid] + sp).fetchone()
        by_task = conn.execute(f"""
            SELECT task_name, category, SUM(hours) AS hours FROM time_entries te
            WHERE te.customer_id = ?{scope} GROUP BY task_name, category ORDER BY hours DESC
        """, [cid] + sp).fetchall()
        by_employee = []
        history = []
        if emp["is_admin"]:
            by_employee = conn.execute("""
                SELECT e.name AS employee_name, SUM(te.hours) AS hours
                FROM time_entries te JOIN employees e ON e.id = te.employee_id
                WHERE te.customer_id = ? GROUP BY e.id ORDER BY hours DESC
            """, (cid,)).fetchall()
            history = [audit_row(r) for r in conn.execute(
                "SELECT * FROM audit_log WHERE customer_id=? ORDER BY id DESC LIMIT 40", (cid,)
            ).fetchall()]
        recent = conn.execute(
            ENTRY_SELECT + f" WHERE te.customer_id = ?{scope} "
            "ORDER BY te.entry_date DESC, te.id DESC LIMIT 25", [cid] + sp
        ).fetchall()
    return jsonify({
        "customer": dict(c),
        "totals": dict(totals),
        "no_invoice": dict(no_invoice),
        "invoices": [dict(r) for r in invoices],
        "by_task": [dict(r) for r in by_task],
        "by_employee": [dict(r) for r in by_employee],
        "recent_entries": [entry_dict(r) for r in recent],
        "history": history,
    })


@app.route("/api/me/recent-customers", methods=["GET"])
def recent_customers():
    """The caller's most recently used customers, for one-click selection."""
    emp = current_employee(request.args)
    with get_db() as conn:
        rows = conn.execute("""
            SELECT c.id, c.name, MAX(te.entry_date) AS last_used
            FROM time_entries te JOIN customers c ON c.id = te.customer_id
            WHERE te.employee_id = ? AND c.active = 1
            GROUP BY c.id ORDER BY last_used DESC, MAX(te.id) DESC LIMIT 6
        """, (emp["id"],)).fetchall()
    return jsonify([dict(r) for r in rows])


# ── Routes: invoices ─────────────────────────────────────────────────────────

INVOICE_FIELDS = ["invoice_number", "title", "active", "status", "customer"]


def invoice_view(conn, inv):
    d = dict(inv)
    d["customer"] = conn.execute(
        "SELECT name FROM customers WHERE id=?", (inv["customer_id"],)).fetchone()["name"]
    return d


@app.route("/api/invoices", methods=["GET"])
def list_invoices():
    show_all = request.args.get("all") == "1"
    params = []
    where = []
    if not show_all:
        where.append("i.active = 1")
    if request.args.get("customer_id"):
        where.append("i.customer_id = ?")
        params.append(request.args["customer_id"])
    sql = ("SELECT i.*, c.name AS customer_name FROM invoices i "
           "JOIN customers c ON c.id = i.customer_id" +
           (" WHERE " + " AND ".join(where) if where else "") +
           " ORDER BY i.invoice_number COLLATE NOCASE")
    with get_db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/invoices", methods=["POST"])
def add_invoice():
    data = body()
    emp = current_employee(data, admin=True)
    number = clean(data.get("invoice_number"))
    title = clean(data.get("title"))
    if not number:
        raise ApiError("Invoice number required.")
    with get_db() as conn:
        customer = conn.execute("SELECT * FROM customers WHERE id=?",
                                (data.get("customer_id"),)).fetchone()
        if not customer:
            raise ApiError("Pick a customer for this invoice.")
        existing = conn.execute(
            "SELECT * FROM invoices WHERE invoice_number=? COLLATE NOCASE", (number,)).fetchone()
        if existing:
            if existing["customer_id"] == customer["id"] and existing["status"] == "pending":
                # An employee already logged time against it — this makes it official.
                conn.execute(
                    "UPDATE invoices SET status='verified', title=?, "
                    "updated_at=datetime('now','localtime') WHERE id=?",
                    (title or existing["title"], existing["id"]))
                changes = {"status": ["pending", "verified"]}
                if title and title != existing["title"]:
                    changes["title"] = [existing["title"], title]
                audit(conn, emp, "verify", "invoice", existing["id"],
                      f"{existing['invoice_number']} ({customer['name']})",
                      customer_id=customer["id"], changes=changes,
                      note="Matched an invoice employees had already logged time against")
                return jsonify({"id": existing["id"], "verified_existing": True}), 200
            owner = conn.execute("SELECT name FROM customers WHERE id=?",
                                 (existing["customer_id"],)).fetchone()["name"]
            raise ApiError(f"Invoice {existing['invoice_number']} already exists under '{owner}'.", 409)
        cur = conn.execute(
            "INSERT INTO invoices (customer_id, invoice_number, title, created_by) VALUES (?, ?, ?, ?)",
            (customer["id"], number, title, emp["id"]))
        audit(conn, emp, "create", "invoice", cur.lastrowid, f"{number} ({customer['name']})",
              customer_id=customer["id"],
              snapshot={"invoice_number": number, "title": title, "customer": customer["name"]})
    return jsonify({"id": cur.lastrowid}), 201


@app.route("/api/invoices/<int:iid>", methods=["PUT"])
def update_invoice(iid):
    data = body()
    emp = current_employee(data, admin=True)
    with get_db() as conn:
        old = conn.execute("SELECT * FROM invoices WHERE id=?", (iid,)).fetchone()
        if not old:
            raise ApiError("Invoice not found.", 404)
        customer = conn.execute("SELECT * FROM customers WHERE id=?",
                                (data.get("customer_id", old["customer_id"]),)).fetchone()
        if not customer:
            raise ApiError("Customer not found.")
        new = {
            "invoice_number": clean(data.get("invoice_number", old["invoice_number"])),
            "title": clean(data.get("title", old["title"])),
            "active": int(data.get("active", old["active"])),
            "status": data.get("status", old["status"]),
            "customer": customer["name"],
        }
        if not new["invoice_number"]:
            raise ApiError("Invoice number required.")
        if new["status"] not in ("verified", "pending"):
            raise ApiError("Invalid status.")
        clash = conn.execute(
            "SELECT id FROM invoices WHERE invoice_number=? COLLATE NOCASE AND id<>?",
            (new["invoice_number"], iid)).fetchone()
        if clash:
            raise ApiError(f"Invoice {new['invoice_number']} already exists.", 409)
        changes = diff(invoice_view(conn, old), new, INVOICE_FIELDS)
        if changes:
            conn.execute(
                """UPDATE invoices SET customer_id=?, invoice_number=?, title=?, active=?, status=?,
                   updated_at=datetime('now','localtime') WHERE id=?""",
                (customer["id"], new["invoice_number"], new["title"], new["active"],
                 new["status"], iid))
            if customer["id"] != old["customer_id"]:
                # Entries carry their customer too; keep them consistent with the invoice.
                conn.execute("UPDATE time_entries SET customer_id=? WHERE invoice_id=?",
                             (customer["id"], iid))
            keys = set(changes)
            if keys == {"status"} and new["status"] == "verified":
                action = "verify"
            elif keys == {"active"}:
                action = "activate" if new["active"] else "deactivate"
            else:
                action = "update"
            label = f"{new['invoice_number']} ({customer['name']})"
            audit(conn, emp, action, "invoice", iid, label,
                  customer_id=customer["id"], changes=changes)
            if customer["id"] != old["customer_id"]:
                # Also surface it on the customer it left.
                audit(conn, emp, "update", "invoice", iid, label,
                      customer_id=old["customer_id"], changes=changes,
                      note=f"Moved to '{customer['name']}'")
    return jsonify({"ok": True})


@app.route("/api/invoices/<int:iid>", methods=["DELETE"])
def delete_invoice(iid):
    data = body()
    emp = current_employee(data, admin=True)
    with get_db() as conn:
        inv = conn.execute("SELECT * FROM invoices WHERE id=?", (iid,)).fetchone()
        if not inv:
            raise ApiError("Invoice not found.", 404)
        n = conn.execute("SELECT COUNT(*) FROM time_entries WHERE invoice_id=?", (iid,)).fetchone()[0]
        if n:
            raise ApiError(f"Invoice {inv['invoice_number']} has {n} time entr"
                           f"{'y' if n == 1 else 'ies'}, so it can't be deleted. "
                           "Mark it inactive instead.", 409)
        v = invoice_view(conn, inv)
        conn.execute("DELETE FROM invoices WHERE id=?", (iid,))
        audit(conn, emp, "delete", "invoice", iid, f"{inv['invoice_number']} ({v['customer']})",
              customer_id=inv["customer_id"],
              snapshot=row_dict(v, "invoice_number", "title", "customer", "status", "created_at"))
    return jsonify({"ok": True})


@app.route("/api/customers/import", methods=["POST"])
def import_customers_csv():
    """Bulk-load customers and their invoices from a CSV (one invoice per row)."""
    emp = current_employee(request.form, admin=True)
    file = request.files.get("file")
    if not file:
        raise ApiError("No file uploaded")
    if not file.filename.lower().endswith(".csv"):
        raise ApiError("File must be a .csv")

    reader = csv.DictReader(io.StringIO(file.stream.read().decode("utf-8-sig"), newline=""))
    names = reader.fieldnames or []

    def find(*options):
        return next((h for h in names if h.strip().lower() in options), None)

    customer_col = find("customer", "client", "customer name", "client name")
    number_col = find("invoice", "invoice number", "invoice #", "job number", "job", "number")
    title_col = find("title", "description", "desc", "name")
    if not customer_col:
        raise ApiError("Could not find a customer column. Expected a column named "
                       "Customer, Client, or Customer Name.")

    sync_mode = request.form.get("deactivate_missing") in ("1", "true", "on")
    stats = defaultdict(int)
    new_customers, new_invoices = [], []
    seen_invoice_ids = set()

    with get_db() as conn:
        for row in reader:
            cname = clean(row.get(customer_col))
            number = clean(row.get(number_col)) if number_col else ""
            title = clean(row.get(title_col)) if title_col else ""
            if not cname:
                stats["skipped"] += 1
                continue

            cust = conn.execute("SELECT * FROM customers WHERE name=? COLLATE NOCASE", (cname,)).fetchone()
            if cust and cust["is_system"]:
                stats["skipped"] += 1
                continue
            if not cust:
                cur = conn.execute("INSERT INTO customers (name, created_by) VALUES (?, ?)",
                                   (cname, emp["id"]))
                cust = conn.execute("SELECT * FROM customers WHERE id=?", (cur.lastrowid,)).fetchone()
                new_customers.append(cname)
                stats["customers_added"] += 1
            else:
                changes = {}
                if not cust["active"]:
                    changes["active"] = [0, 1]
                if cust["status"] == "pending":
                    changes["status"] = ["pending", "verified"]
                if changes:
                    conn.execute("UPDATE customers SET active=1, status='verified', "
                                 "updated_at=datetime('now','localtime') WHERE id=?", (cust["id"],))
                    audit(conn, emp, "update", "customer", cust["id"], cust["name"],
                          customer_id=cust["id"], changes=changes, note="CSV import")
                    stats["customers_updated"] += 1

            if not number:
                continue
            inv = conn.execute("SELECT * FROM invoices WHERE invoice_number=? COLLATE NOCASE",
                               (number,)).fetchone()
            if not inv:
                cur = conn.execute(
                    "INSERT INTO invoices (customer_id, invoice_number, title, created_by) "
                    "VALUES (?, ?, ?, ?)", (cust["id"], number, title, emp["id"]))
                seen_invoice_ids.add(cur.lastrowid)
                new_invoices.append(number)
                stats["invoices_added"] += 1
                continue
            seen_invoice_ids.add(inv["id"])
            if inv["customer_id"] != cust["id"]:
                stats["conflicts"] += 1  # same number already filed under another customer
                continue
            changes = {}
            new_title = title or inv["title"]
            if new_title != inv["title"]:
                changes["title"] = [inv["title"], new_title]
            if not inv["active"]:
                changes["active"] = [0, 1]
            if inv["status"] == "pending":
                changes["status"] = ["pending", "verified"]
            if changes:
                conn.execute(
                    "UPDATE invoices SET title=?, active=1, status='verified', "
                    "updated_at=datetime('now','localtime') WHERE id=?", (new_title, inv["id"]))
                audit(conn, emp, "verify" if set(changes) == {"status"} else "update", "invoice",
                      inv["id"], f"{inv['invoice_number']} ({cust['name']})",
                      customer_id=cust["id"], changes=changes, note="CSV import")
                stats["invoices_updated"] += 1
            else:
                stats["unchanged"] += 1

        if sync_mode:
            if not seen_invoice_ids:
                raise ApiError("No invoice rows found in the file — nothing was deactivated.")
            # Pending invoices were added by employees and are by definition not in
            # the export yet, so a sync never deactivates them.
            ph = ",".join("?" * len(seen_invoice_ids))
            stale = conn.execute(
                f"SELECT i.id, i.invoice_number, i.customer_id FROM invoices i "
                f"WHERE i.active=1 AND i.status='verified' AND i.id NOT IN ({ph})",
                tuple(seen_invoice_ids)).fetchall()
            for r in stale:
                conn.execute("UPDATE invoices SET active=0, updated_at=datetime('now','localtime') "
                             "WHERE id=?", (r["id"],))
                audit(conn, emp, "deactivate", "invoice", r["id"], r["invoice_number"],
                      customer_id=r["customer_id"], changes={"active": [1, 0]},
                      note="CSV import sync — not in the uploaded file")
            stats["deactivated"] = len(stale)

        audit(conn, emp, "import", "import", None, file.filename,
              snapshot={"customers_added": new_customers[:500], "invoices_added": new_invoices[:500],
                        "totals": dict(stats)},
              note="CSV import" + (" (sync: deactivated invoices missing from the file)" if sync_mode else ""))
    return jsonify(dict(stats))


# ── Routes: tasks ────────────────────────────────────────────────────────────

@app.route("/api/tasks", methods=["GET"])
def list_tasks():
    show_all = request.args.get("all") == "1"
    with get_db() as conn:
        if show_all:
            rows = conn.execute("SELECT * FROM tasks ORDER BY active DESC, name").fetchall()
        else:
            rows = conn.execute("SELECT * FROM tasks WHERE active=1 ORDER BY name").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/tasks", methods=["POST"])
def add_task():
    data = body()
    emp = current_employee(data, admin=True)
    name = clean(data.get("name"))
    category = clean(data.get("category"))
    if not name or not category:
        raise ApiError("Name and category required")
    with get_db() as conn:
        cur = conn.execute("INSERT INTO tasks (name, category) VALUES (?, ?)", (name, category))
        audit(conn, emp, "create", "task", cur.lastrowid, name,
              snapshot={"name": name, "category": category})
    return jsonify({"id": cur.lastrowid, "name": name, "category": category}), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    data = body()
    emp = current_employee(data, admin=True)
    with get_db() as conn:
        old = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not old:
            raise ApiError("Task not found", 404)
        new = {"name": clean(data.get("name", old["name"])),
               "category": clean(data.get("category", old["category"])),
               "active": int(data.get("active", old["active"]))}
        if not new["name"] or not new["category"]:
            raise ApiError("Name and category required")
        changes = diff(dict(old), new, ["name", "category", "active"])
        if changes:
            conn.execute("UPDATE tasks SET name=?, category=?, active=? WHERE id=?",
                         (new["name"], new["category"], new["active"], task_id))
            action = "update"
            if set(changes) == {"active"}:
                action = "activate" if new["active"] else "deactivate"
            audit(conn, emp, action, "task", task_id, new["name"], changes=changes)
    return jsonify({"ok": True})


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    data = body()
    emp = current_employee(data, admin=True)
    with get_db() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not task:
            raise ApiError("Task not found", 404)
        if task["name"] == NOT_LISTED:
            raise ApiError("'Not Listed' is a required system task and cannot be deleted", 403)
        conn.execute("DELETE FROM role_tasks WHERE task_id=?", (task_id,))
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        audit(conn, emp, "delete", "task", task_id, task["name"],
              snapshot=row_dict(task, "name", "category", "active"))
    return jsonify({"ok": True})


# ── Routes: time entries ─────────────────────────────────────────────────────

def can_touch(emp, entry):
    return bool(emp["is_admin"]) or entry["employee_id"] == emp["id"]


@app.route("/api/entries", methods=["GET"])
def list_entries():
    emp = current_employee(request.args)
    a = request.args
    where, params = ["1=1"], []
    if not emp["is_admin"]:
        where.append("te.employee_id = ?")
        params.append(emp["id"])
    elif a.get("for_employee"):
        where.append("te.employee_id = ?")
        params.append(a["for_employee"])
    if a.get("date_from"):
        where.append("te.entry_date >= ?")
        params.append(a["date_from"])
    if a.get("date_to"):
        where.append("te.entry_date <= ?")
        params.append(a["date_to"])
    if a.get("customer_id"):
        where.append("te.customer_id = ?")
        params.append(a["customer_id"])
    if a.get("invoice_id"):
        where.append("te.invoice_id = ?")
        params.append(a["invoice_id"])
    with get_db() as conn:
        rows = conn.execute(
            ENTRY_SELECT + " WHERE " + " AND ".join(where) +
            " ORDER BY te.entry_date DESC, te.id DESC LIMIT 300", params).fetchall()
    return jsonify([entry_dict(r) for r in rows])


@app.route("/api/entries", methods=["POST"])
def add_entry():
    """Log time. A customer is required; invoices are optional and may name
    numbers that aren't in the system yet (they're created as pending)."""
    data = body()
    emp = current_employee(data)
    entry_date = parse_date(data.get("entry_date"))
    hours = parse_hours(data.get("hours"))
    notes = (data.get("notes") or "").strip()
    specs = data.get("invoices") or []

    with get_db() as conn:
        task = resolve_task(conn, data.get("task_name"))
        require_notes_if_not_listed(task["name"], notes)
        customer = resolve_customer(conn, emp, data)

        invoices, seen = [], set()
        for spec in specs:
            inv = resolve_invoice(conn, emp, customer, spec)
            if inv["id"] not in seen:
                seen.add(inv["id"])
                invoices.append(inv)

        targets = invoices or [None]
        split = bool(data.get("split")) and len(targets) > 1
        amounts = split_hours(hours, len(targets)) if split else [hours] * len(targets)
        if split:
            note_suffix = f"Hours split across {len(targets)} invoices ({hours:g}h total)"
        else:
            note_suffix = ""

        ids = []
        for inv, amount in zip(targets, amounts):
            cur = conn.execute(
                """INSERT INTO time_entries
                   (employee_id, entry_date, customer_id, invoice_id, task_id, task_name,
                    category, hours, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (emp["id"], entry_date, customer["id"], inv["id"] if inv else None,
                 task["id"], task["name"], task["category"], amount, notes))
            view = entry_view(fetch_entry(conn, cur.lastrowid))
            audit(conn, emp, "create", "entry", cur.lastrowid, entry_label(view),
                  customer_id=customer["id"], snapshot=view, note=note_suffix)
            ids.append(cur.lastrowid)
    return jsonify({"ids": ids, "customer_id": customer["id"]}), 201


@app.route("/api/entries/<int:entry_id>", methods=["PUT"])
def update_entry(entry_id):
    data = body()
    emp = current_employee(data)
    with get_db() as conn:
        existing = fetch_entry(conn, entry_id)
        if not existing:
            raise ApiError("Entry not found", 404)
        if not can_touch(emp, existing):
            raise ApiError("Forbidden", 403)
        old_view = entry_view(existing)

        entry_date = parse_date(data.get("entry_date"), default=existing["entry_date"])
        hours = parse_hours(data.get("hours", existing["hours"]))
        notes = (data.get("notes", existing["notes"]) or "").strip()
        task = resolve_task(conn, data.get("task_name", existing["task_name"]),
                            existing_name=existing["task_name"])
        require_notes_if_not_listed(task["name"], notes)

        if data.get("customer_id") or data.get("new_customer"):
            customer = resolve_customer(conn, emp, data, current_id=existing["customer_id"])
        else:
            customer = conn.execute("SELECT * FROM customers WHERE id=?",
                                    (existing["customer_id"],)).fetchone()
        same_customer = customer["id"] == existing["customer_id"]

        invoice_id = existing["invoice_id"] if same_customer else None
        if "invoice" in data:
            spec = data["invoice"]
            if not spec or (isinstance(spec, dict) and not (spec.get("id") or clean(spec.get("number")))):
                invoice_id = None
            else:
                inv = resolve_invoice(conn, emp, customer, spec,
                                      current_invoice=existing["invoice_id"] if same_customer else None)
                invoice_id = inv["id"]

        category = task["category"]  # always follows the task
        conn.execute(
            """UPDATE time_entries SET entry_date=?, customer_id=?, invoice_id=?, task_id=?,
               task_name=?, category=?, hours=?, notes=?,
               updated_at=datetime('now','localtime') WHERE id=?""",
            (entry_date, customer["id"], invoice_id, task["id"], task["name"], category,
             hours, notes, entry_id))
        new_view = entry_view(fetch_entry(conn, entry_id))
        changes = diff(old_view, new_view, ENTRY_FIELDS)
        if changes:
            audit(conn, emp, "update", "entry", entry_id, entry_label(new_view),
                  customer_id=customer["id"], changes=changes)
            if not same_customer:
                audit(conn, emp, "update", "entry", entry_id, entry_label(old_view),
                      customer_id=existing["customer_id"], changes=changes,
                      note=f"Moved to '{customer['name']}'")
    return jsonify({"ok": True, "changed": bool(changes)})


@app.route("/api/entries/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id):
    data = body()
    emp = current_employee(data)
    with get_db() as conn:
        existing = fetch_entry(conn, entry_id)
        if not existing:
            raise ApiError("Entry not found", 404)
        if not can_touch(emp, existing):
            raise ApiError("Forbidden", 403)
        view = entry_view(existing)
        conn.execute("DELETE FROM time_entries WHERE id=?", (entry_id,))
        audit(conn, emp, "delete", "entry", entry_id, entry_label(view),
              customer_id=existing["customer_id"],
              snapshot={**view, "created_at": existing["created_at"]})
    return jsonify({"ok": True})


@app.route("/api/entries/<int:entry_id>/history", methods=["GET"])
def entry_history(entry_id):
    emp = current_employee(request.args)
    with get_db() as conn:
        existing = fetch_entry(conn, entry_id)
        if existing and not can_touch(emp, existing):
            raise ApiError("Forbidden", 403)
        rows = conn.execute(
            "SELECT * FROM audit_log WHERE entity_type='entry' AND entity_id=? ORDER BY id",
            (entry_id,)).fetchall()
        if not existing and not rows:
            raise ApiError("Entry not found", 404)
        if not existing and not emp["is_admin"]:
            raise ApiError("Forbidden", 403)
    return jsonify([audit_row(r) for r in rows])


# ── Routes: employees ────────────────────────────────────────────────────────

@app.route("/api/admin/employees", methods=["GET"])
def admin_list_employees():
    current_employee(request.args, admin=True)
    with get_db() as conn:
        rows = conn.execute(
            """SELECT e.id, e.name, e.is_admin, e.active, e.role_id, r.name AS role_name
               FROM employees e LEFT JOIN roles r ON e.role_id = r.id
               ORDER BY e.name"""
        ).fetchall()
    return jsonify([dict(r) for r in rows])


def employee_view(conn, row):
    role = None
    if row["role_id"]:
        r = conn.execute("SELECT name FROM roles WHERE id=?", (row["role_id"],)).fetchone()
        role = r["name"] if r else None
    return {"name": row["name"], "is_admin": row["is_admin"], "active": row["active"], "role": role}


@app.route("/api/admin/employees", methods=["POST"])
def admin_add_employee():
    data = body()
    emp = current_employee(data, admin=True)
    name = clean(data.get("name"))
    pin = str(data.get("new_pin") or "").strip()
    if not name or not pin:
        raise ApiError("Name and PIN required")
    role_id = data.get("role_id") or None
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO employees (name, pin_hash, is_admin, role_id) VALUES (?, ?, ?, ?)",
            (name, hash_pin(pin), int(data.get("is_admin", 0)), role_id))
        row = conn.execute("SELECT * FROM employees WHERE id=?", (cur.lastrowid,)).fetchone()
        audit(conn, emp, "create", "employee", cur.lastrowid, name,
              snapshot=employee_view(conn, row))
    return jsonify({"id": cur.lastrowid, "name": name}), 201


@app.route("/api/admin/employees/<int:emp_id>", methods=["PUT"])
def admin_update_employee(emp_id):
    data = body()
    actor = current_employee(data, admin=True)
    role_id = data.get("role_id") or None
    with get_db() as conn:
        old = conn.execute("SELECT * FROM employees WHERE id=?", (emp_id,)).fetchone()
        if not old:
            raise ApiError("Employee not found", 404)
        old_view = employee_view(conn, old)
        if data.get("new_pin"):
            conn.execute(
                "UPDATE employees SET name=?, pin_hash=?, is_admin=?, active=?, role_id=? WHERE id=?",
                (data["name"], hash_pin(str(data["new_pin"])), int(data.get("is_admin", 0)),
                 int(data.get("active", 1)), role_id, emp_id))
        else:
            conn.execute(
                "UPDATE employees SET name=?, is_admin=?, active=?, role_id=? WHERE id=?",
                (data["name"], int(data.get("is_admin", 0)), int(data.get("active", 1)),
                 role_id, emp_id))
        new_row = conn.execute("SELECT * FROM employees WHERE id=?", (emp_id,)).fetchone()
        changes = diff(old_view, employee_view(conn, new_row), ["name", "is_admin", "active", "role"])
        if changes:
            action = "update"
            if set(changes) == {"active"}:
                action = "activate" if new_row["active"] else "deactivate"
            audit(conn, actor, action, "employee", emp_id, new_row["name"], changes=changes)
        if data.get("new_pin"):
            audit(conn, actor, "update", "employee", emp_id, new_row["name"], note="PIN reset by admin")
    return jsonify({"ok": True})


@app.route("/api/employees/<int:emp_id>/change-pin", methods=["POST"])
def change_pin(emp_id):
    data = body()
    emp = verify_employee(emp_id, str(data.get("old_pin", "")))
    if not emp:
        raise ApiError("Current PIN is incorrect", 401)
    new_pin = str(data.get("new_pin", ""))
    if not new_pin:
        raise ApiError("New PIN is required")
    with get_db() as conn:
        conn.execute("UPDATE employees SET pin_hash=? WHERE id=?", (hash_pin(new_pin), emp_id))
        audit(conn, emp, "update", "employee", emp_id, emp["name"], note="Changed own PIN")
    return jsonify({"ok": True})


# ── Routes: roles ────────────────────────────────────────────────────────────

@app.route("/api/roles", methods=["GET"])
def list_roles():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM roles ORDER BY name").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/roles", methods=["POST"])
def add_role():
    data = body()
    emp = current_employee(data, admin=True)
    name = clean(data.get("name"))
    if not name:
        raise ApiError("Role name required")
    with get_db() as conn:
        cur = conn.execute("INSERT INTO roles (name) VALUES (?)", (name,))
        audit(conn, emp, "create", "role", cur.lastrowid, name, snapshot={"name": name})
    return jsonify({"id": cur.lastrowid, "name": name}), 201


@app.route("/api/roles/<int:role_id>", methods=["PUT"])
def update_role(role_id):
    data = body()
    emp = current_employee(data, admin=True)
    name = clean(data.get("name"))
    if not name:
        raise ApiError("Role name required")
    with get_db() as conn:
        old = conn.execute("SELECT * FROM roles WHERE id=?", (role_id,)).fetchone()
        if not old:
            raise ApiError("Role not found", 404)
        conn.execute("UPDATE roles SET name=? WHERE id=?", (name, role_id))
        if old["name"] != name:
            audit(conn, emp, "update", "role", role_id, name, changes={"name": [old["name"], name]})
    return jsonify({"ok": True})


@app.route("/api/roles/<int:role_id>", methods=["DELETE"])
def delete_role(role_id):
    data = body()
    emp = current_employee(data, admin=True)
    with get_db() as conn:
        role = conn.execute("SELECT * FROM roles WHERE id=?", (role_id,)).fetchone()
        if not role:
            raise ApiError("Role not found", 404)
        affected = [r["name"] for r in conn.execute(
            "SELECT name FROM employees WHERE role_id=?", (role_id,)).fetchall()]
        conn.execute("UPDATE employees SET role_id=NULL WHERE role_id=?", (role_id,))
        conn.execute("DELETE FROM role_tasks WHERE role_id=?", (role_id,))
        conn.execute("DELETE FROM roles WHERE id=?", (role_id,))
        audit(conn, emp, "delete", "role", role_id, role["name"],
              snapshot={"name": role["name"], "employees_unassigned": affected})
    return jsonify({"ok": True})


@app.route("/api/roles/<int:role_id>/tasks", methods=["GET"])
def get_role_tasks(role_id):
    with get_db() as conn:
        rows = conn.execute("SELECT task_id FROM role_tasks WHERE role_id=?", (role_id,)).fetchall()
    return jsonify([r["task_id"] for r in rows])


@app.route("/api/roles/<int:role_id>/tasks", methods=["PUT"])
def set_role_tasks(role_id):
    data = body()
    emp = current_employee(data, admin=True)
    task_ids = {int(t) for t in data.get("task_ids", [])}
    with get_db() as conn:
        role = conn.execute("SELECT * FROM roles WHERE id=?", (role_id,)).fetchone()
        if not role:
            raise ApiError("Role not found", 404)
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM tasks").fetchall()}
        before = {r["task_id"] for r in conn.execute(
            "SELECT task_id FROM role_tasks WHERE role_id=?", (role_id,)).fetchall()}
        conn.execute("DELETE FROM role_tasks WHERE role_id=?", (role_id,))
        for tid in task_ids:
            conn.execute("INSERT OR IGNORE INTO role_tasks (role_id, task_id) VALUES (?, ?)",
                         (role_id, tid))
        added = sorted(names.get(t, str(t)) for t in task_ids - before)
        removed = sorted(names.get(t, str(t)) for t in before - task_ids)
        changes = {}
        if added:
            changes["tasks added"] = ["", ", ".join(added)]
        if removed:
            changes["tasks removed"] = [", ".join(removed), ""]
        if changes:
            audit(conn, emp, "update", "role", role_id, role["name"], changes=changes,
                  note="Allowed task list changed")
    return jsonify({"ok": True})


# ── Routes: admin review queue & audit log ───────────────────────────────────

@app.route("/api/admin/review", methods=["GET"])
def admin_review():
    """Things that got established on the fly and need an admin's eyes."""
    current_employee(request.args, admin=True)
    with get_db() as conn:
        customers = conn.execute("""
            SELECT c.id, c.name, c.created_at, e.name AS created_by_name,
                   (SELECT COUNT(*) FROM time_entries te WHERE te.customer_id = c.id) AS entry_count,
                   (SELECT COALESCE(SUM(hours), 0) FROM time_entries te WHERE te.customer_id = c.id) AS hours,
                   (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id) AS invoice_count
            FROM customers c LEFT JOIN employees e ON e.id = c.created_by
            WHERE c.status = 'pending' ORDER BY c.created_at DESC
        """).fetchall()
        invoices = conn.execute("""
            SELECT i.id, i.invoice_number, i.title, i.customer_id, c.name AS customer_name,
                   i.created_at, e.name AS created_by_name,
                   (SELECT COUNT(*) FROM time_entries te WHERE te.invoice_id = i.id) AS entry_count,
                   (SELECT COALESCE(SUM(hours), 0) FROM time_entries te WHERE te.invoice_id = i.id) AS hours
            FROM invoices i JOIN customers c ON c.id = i.customer_id
            LEFT JOIN employees e ON e.id = i.created_by
            WHERE i.status = 'pending' ORDER BY i.created_at DESC
        """).fetchall()
        not_listed = conn.execute(
            ENTRY_SELECT + " WHERE te.task_name = ? ORDER BY te.entry_date DESC, te.id DESC LIMIT 200",
            (NOT_LISTED,)).fetchall()
        tasks = conn.execute(
            "SELECT name, category FROM tasks WHERE active=1 AND name<>? ORDER BY name",
            (NOT_LISTED,)).fetchall()
        all_customers = conn.execute(
            "SELECT id, name FROM customers WHERE active=1 AND is_system=0 "
            "ORDER BY name COLLATE NOCASE").fetchall()
    return jsonify({
        "customers": [dict(r) for r in customers],
        "invoices": [dict(r) for r in invoices],
        "not_listed_entries": [entry_dict(r) for r in not_listed],
        "active_tasks": [dict(r) for r in tasks],
        "all_customers": [dict(r) for r in all_customers],
    })


def audit_row(r):
    d = dict(r)
    d["changes"] = json.loads(d["changes"]) if d["changes"] else None
    d["snapshot"] = json.loads(d["snapshot"]) if d["snapshot"] else None
    return d


@app.route("/api/admin/audit", methods=["GET"])
def audit_list():
    current_employee(request.args, admin=True)
    a = request.args
    where, params = ["1=1"], []
    for col, key in (("entity_type", "entity_type"), ("action", "action"),
                     ("actor_id", "actor_id"), ("customer_id", "customer_id"),
                     ("entity_id", "entity_id")):
        if a.get(key):
            where.append(f"{col} = ?")
            params.append(a[key])
    if a.get("date_from"):
        where.append("date(ts) >= ?")
        params.append(a["date_from"])
    if a.get("date_to"):
        where.append("date(ts) <= ?")
        params.append(a["date_to"])
    if a.get("q"):
        like = f"%{a['q']}%"
        where.append("(entity_label LIKE ? OR note LIKE ? OR actor_name LIKE ? OR changes LIKE ?)")
        params += [like] * 4
    try:
        limit = max(1, min(int(a.get("limit", 100)), 500))
        offset = max(0, int(a.get("offset", 0)))
    except ValueError:
        raise ApiError("Invalid paging values.")
    clause = " AND ".join(where)
    with get_db() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM audit_log WHERE {clause}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM audit_log WHERE {clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [limit, offset]).fetchall()
    return jsonify({"total": total, "rows": [audit_row(r) for r in rows]})


# ── Export ───────────────────────────────────────────────────────────────────

def describe_changes(row):
    """One-line plain-text version of an audit row for the spreadsheet."""
    if row["changes"]:
        ch = json.loads(row["changes"])
        return "; ".join(f"{k}: {norm(v[0])!s} → {norm(v[1])!s}" for k, v in ch.items())
    if row["snapshot"]:
        snap = json.loads(row["snapshot"])
        return "; ".join(f"{k}: {v}" for k, v in snap.items()
                         if not isinstance(v, (list, dict)))
    return ""


@app.route("/api/export", methods=["GET"])
def export_excel():
    emp = current_employee(request.args)
    date_from = request.args.get("date_from", "")
    date_to = request.args.get("date_to", "")
    include_log = emp["is_admin"] and request.args.get("include_log") == "1"

    where, params = ["1=1"], []
    if not emp["is_admin"]:
        where.append("te.employee_id = ?")
        params.append(emp["id"])
    if date_from:
        where.append("te.entry_date >= ?")
        params.append(date_from)
    if date_to:
        where.append("te.entry_date <= ?")
        params.append(date_to)

    with get_db() as conn:
        rows = conn.execute(
            ENTRY_SELECT + " WHERE " + " AND ".join(where) +
            " ORDER BY c.name COLLATE NOCASE, te.entry_date, e.name, te.id", params).fetchall()
        log_rows = []
        if include_log:
            lw, lp = ["1=1"], []
            if date_from:
                lw.append("date(ts) >= ?")
                lp.append(date_from)
            if date_to:
                lw.append("date(ts) <= ?")
                lp.append(date_to)
            log_rows = conn.execute(
                f"SELECT * FROM audit_log WHERE {' AND '.join(lw)} ORDER BY id", lp).fetchall()

    wb = openpyxl.Workbook()
    header_fill = PatternFill("solid", fgColor="1E5C1E")
    header_font = Font(bold=True, color="FFFFFF", size=11)
    center = Alignment(horizontal="center", vertical="center")
    wrap = Alignment(wrap_text=True, vertical="top")
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    alt_fill = PatternFill("solid", fgColor="EBF3FB")

    def write_sheet(ws, headers, widths, data_rows):
        for col, (header, width) in enumerate(zip(headers, widths), 1):
            cell = ws.cell(row=1, column=col, value=header)
            cell.fill, cell.font, cell.alignment, cell.border = header_fill, header_font, center, border
            ws.column_dimensions[get_column_letter(col)].width = width
        ws.row_dimensions[1].height = 22
        for r, values in enumerate(data_rows, 2):
            for col, val in enumerate(values, 1):
                cell = ws.cell(row=r, column=col, value=val)
                cell.border, cell.alignment = border, wrap
                if r % 2 == 0:
                    cell.fill = alt_fill
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{max(len(data_rows) + 1, 2)}"

    ws = wb.active
    ws.title = "Time Entries"
    write_sheet(
        ws,
        ["Customer", "Invoice #", "Invoice Title", "Date", "Employee", "Task", "Category",
         "Hours", "Notes", "Logged", "Last Edited", "Edits"],
        [26, 16, 28, 12, 20, 28, 22, 8, 40, 18, 18, 7],
        [[r["customer_name"], r["invoice_number"] or "", r["invoice_title"] or "",
          r["entry_date"], r["employee_name"], r["task_name"], r["category"], r["hours"],
          r["notes"], r["created_at"], r["updated_at"] if r["edit_count"] else "", r["edit_count"]]
         for r in rows])

    # Customer summary: one subtotal line per invoice, plus time with no invoice
    per_customer = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    for r in rows:
        key = r["invoice_number"] or "(no invoice)"
        per_customer[r["customer_name"]][key][0] += r["hours"]
        per_customer[r["customer_name"]][key][1] += 1
    cust_rows = []
    for cname in sorted(per_customer, key=str.lower):
        invs = per_customer[cname]
        cust_rows.append([cname, "TOTAL", round(sum(v[0] for v in invs.values()), 2),
                          sum(v[1] for v in invs.values())])
        for inv in sorted(invs):
            cust_rows.append(["", inv, round(invs[inv][0], 2), invs[inv][1]])
    write_sheet(wb.create_sheet("Summary by Customer"),
                ["Customer", "Invoice", "Hours", "Entries"], [30, 22, 12, 10], cust_rows)

    emp_hours, emp_dates = defaultdict(float), defaultdict(list)
    for r in rows:
        emp_hours[r["employee_name"]] += r["hours"]
        emp_dates[r["employee_name"]].append(r["entry_date"])
    write_sheet(wb.create_sheet("Summary by Employee"),
                ["Employee", "Total Hours", "Date From", "Date To"], [22, 12, 14, 14],
                [[n, round(h, 2), min(emp_dates[n]), max(emp_dates[n])]
                 for n, h in sorted(emp_hours.items())])

    if include_log:
        write_sheet(wb.create_sheet("Change Log"),
                    ["When", "Who", "Action", "Type", "Item", "Details", "Note"],
                    [18, 18, 12, 11, 48, 60, 40],
                    [[r["ts"], r["actor_name"], r["action"], r["entity_type"],
                      r["entity_label"], describe_changes(r), r["note"]] for r in log_rows])

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
