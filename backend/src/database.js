import initSqlJs from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// En producción (Railway), DATA_PATH apunta al volumen persistente (/data)
// En local, usa la carpeta relativa backend/data/
const dataDir = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'orderflow.db');
const backupDir = path.join(dataDir, 'backups');
console.log(`📂 Database path: ${dbPath}`);

let db;
let txDepth = 0;

export async function initDB({ seed = true } = {}) {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    sku_prefix TEXT,
    phone TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    custom_ot TEXT,
    quote_date DATE,
    client_name TEXT NOT NULL,
    net_value REAL DEFAULT 0,
    profit_margin REAL DEFAULT 30,
    payment_date DATE,
    deadline DATE,
    supplier_order_number TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','overdue')),
    supplier_id INTEGER REFERENCES suppliers(id),
    logo_technique TEXT DEFAULT 'SIN LOGO',
    delivery_status TEXT DEFAULT 'sin_verificar',
    raw_quote_text TEXT,
    generated_email TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  try {
    db.run(`ALTER TABLE orders ADD COLUMN custom_ot TEXT`);
  } catch (e) {}

  try {
    db.run(`ALTER TABLE orders ADD COLUMN logo_technique TEXT DEFAULT 'SIN LOGO'`);
  } catch (e) {}

  try {
    db.run(`ALTER TABLE orders ADD COLUMN delivery_status TEXT DEFAULT 'sin_verificar'`);
  } catch (e) {}

  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_name TEXT,
    sku TEXT,
    color TEXT,
    size TEXT,
    quantity INTEGER DEFAULT 0,
    unit_price REAL DEFAULT 0,
    notes TEXT
  )`);

  // Seed suppliers (solo en una base nueva)
  const [{ values: [[count]] }] = db.exec('SELECT COUNT(*) FROM suppliers');
  if (seed && count === 0) {
    db.run(`INSERT INTO suppliers (name, email, sku_prefix, phone, notes) VALUES (?, ?, ?, ?, ?)`,
      ['Proveedor Textil Norte', 'ventas@textilnorte.cl', 'TN,PTN', '+56 9 1234 5678', 'Poleras y polerón']);
    db.run(`INSERT INTO suppliers (name, email, sku_prefix, phone, notes) VALUES (?, ?, ?, ?, ?)`,
      ['Confecciones Sur', 'pedidos@confeccionessur.cl', 'CS,SUR', '+56 9 8765 4321', 'Camisas y pantalones']);
    db.run(`INSERT INTO suppliers (name, email, sku_prefix, phone, notes) VALUES (?, ?, ?, ?, ?)`,
      ['Distribuidora Central', 'ordenes@distcentral.cl', 'DC,DIST', '+56 9 5555 1234', 'Chalecos y accesorios']);
    console.log('✅ Seed suppliers inserted');
  }

  runMigrations();

  saveDB();
  console.log('✅ Database initialized');
  return db;
}

/**
 * Migraciones versionadas (PRAGMA user_version). Solo agregan: nunca borran datos.
 * Antes de aplicar cualquiera se guarda una copia de la base en DATA_PATH/backups/.
 */
const MIGRATIONS = [
  // 1: N° interno correlativo (OF), vínculo con Teamgraff y sincronización automática.
  () => {
    const addCol = (table, def) => {
      const name = def.split(' ')[0];
      const cols = db.exec(`PRAGMA table_info(${table})`)[0]?.values.map((v) => v[1]) ?? [];
      if (!cols.includes(name)) db.run(`ALTER TABLE ${table} ADD COLUMN ${def}`);
    };
    addCol('orders', 'of_number INTEGER');
    addCol('orders', 'teamgraff_ot TEXT');
    addCol('orders', 'teamgraff_quote TEXT');
    addCol('orders', "source TEXT DEFAULT 'manual'");
    addCol('orders', "processing_status TEXT DEFAULT 'ok'");
    addCol('orders', 'review_notes TEXT');
    addCol('orders', 'client_rut TEXT');
    addCol('orders', 'contact_name TEXT');
    addCol('orders', 'contact_email TEXT');
    addCol('orders', 'imported_at DATETIME');
    addCol('order_items', 'line_no INTEGER');
    addCol('order_items', 'logo_position TEXT');
    addCol('order_items', 'logo_size TEXT');

    db.run(`CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      status TEXT NOT NULL DEFAULT 'running',
      checked INTEGER DEFAULT 0,
      created INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      log TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS sync_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teamgraff_ot TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      detail_ref TEXT,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS ix_sync_issues_ot ON sync_issues(teamgraff_ot, status)`);

    // Órdenes existentes: N° OF por orden de creación y vínculo con su N° de OT.
    const rows = db.exec('SELECT id, TRIM(custom_ot) FROM orders ORDER BY id')[0]?.values ?? [];
    const byOt = new Map();
    rows.forEach(([id, ot], i) => {
      db.run('UPDATE orders SET of_number = ? WHERE id = ?', [i + 1, id]);
      if (ot && /^\d+$/.test(ot)) byOt.set(ot, [...(byOt.get(ot) ?? []), id]);
    });
    db.run(`INSERT OR REPLACE INTO counters (name, value) VALUES ('of_number', ?)`, [rows.length]);
    for (const [ot, ids] of byOt) {
      // Si un mismo N° de OT se cargó varias veces, se vincula solo la carga más reciente
      // y las demás quedan marcadas para revisión (no se borra ni se cambia nada más).
      const keep = ids[ids.length - 1];
      db.run('UPDATE orders SET teamgraff_ot = ? WHERE id = ?', [ot, keep]);
      for (const id of ids.slice(0, -1)) {
        db.run(`UPDATE orders SET processing_status = 'incompleta', review_notes = ? WHERE id = ?`,
          [`El N° de OT ${ot} también está en la orden OF-${pad(rows.findIndex((r) => r[0] === keep) + 1)}. Revisar y corregir el N° de OT de esta orden.`, id]);
      }
    }
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_of_number ON orders(of_number)');
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_teamgraff_ot ON orders(teamgraff_ot)');
  },
];

function runMigrations() {
  const current = db.exec('PRAGMA user_version')[0].values[0][0];
  if (current >= MIGRATIONS.length) return;
  const hasData = db.exec('SELECT COUNT(*) FROM orders')[0].values[0][0] > 0;
  if (hasData && fs.existsSync(dbPath)) {
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `orderflow-v${current}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    fs.copyFileSync(dbPath, backup);
    console.log(`💾 Respaldo antes de migrar: ${backup}`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.run('BEGIN');
    try {
      MIGRATIONS[v]();
      db.run(`PRAGMA user_version = ${v + 1}`);
      db.run('COMMIT');
      console.log(`✅ Migración ${v + 1} aplicada`);
    } catch (err) {
      db.run('ROLLBACK');
      throw new Error(`Falló la migración ${v + 1}: ${err.message}`);
    }
  }
}

export const pad = (n) => String(n).padStart(4, '0');
export const formatOf = (n) => (n ? `OF-${pad(n)}` : null);

/** Escritura atómica: se escribe un archivo temporal y luego se renombra. */
export function saveDB() {
  if (!db || txDepth > 0) return;
  const data = db.export();
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(data));
  fs.renameSync(tmp, dbPath);
}

export function getDB() {
  return db;
}

/**
 * Ejecuta fn dentro de una transacción: todo o nada, y un solo guardado a disco al final.
 * sql.js es síncrono y de un solo proceso, así que dos transacciones nunca se intercalan.
 */
export function transaction(fn) {
  if (txDepth > 0) return fn();
  db.run('BEGIN');
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.run('COMMIT');
    saveDB();
    return result;
  } catch (err) {
    txDepth--;
    db.run('ROLLBACK');
    throw err;
  }
}

/** Siguiente N° correlativo (llamar dentro de una transacción). */
export function nextCounter(name) {
  db.run(`INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1`, [name]);
  return db.exec('SELECT value FROM counters WHERE name = ?', [name])[0].values[0][0];
}

// Helper: run SELECT and return array of objects
export function query(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: run SELECT and return first row as object
export function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run INSERT/UPDATE/DELETE
export function run(sql, params = []) {
  db.run(sql, params);
  const result = { lastId: db.exec('SELECT last_insert_rowid()')[0]?.values[0][0], changes: db.getRowsModified() };
  saveDB();
  return result;
}
