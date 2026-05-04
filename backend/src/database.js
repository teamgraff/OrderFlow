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
console.log(`📂 Database path: ${dbPath}`);

let db;

export async function initDB() {
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

  // Seed suppliers
  const [{ values: [[count]] }] = db.exec('SELECT COUNT(*) FROM suppliers');
  if (count === 0) {
    db.run(`INSERT INTO suppliers (name, email, sku_prefix, phone, notes) VALUES (?, ?, ?, ?, ?)`,
      ['Proveedor Textil Norte', 'ventas@textilnorte.cl', 'TN,PTN', '+56 9 1234 5678', 'Poleras y polerón']);
    db.run(`INSERT INTO suppliers (name, email, sku_prefix, phone, notes) VALUES (?, ?, ?, ?, ?)`,
      ['Confecciones Sur', 'pedidos@confeccionessur.cl', 'CS,SUR', '+56 9 8765 4321', 'Camisas y pantalones']);
    db.run(`INSERT INTO suppliers (name, email, sku_prefix, phone, notes) VALUES (?, ?, ?, ?, ?)`,
      ['Distribuidora Central', 'ordenes@distcentral.cl', 'DC,DIST', '+56 9 5555 1234', 'Chalecos y accesorios']);
    console.log('✅ Seed suppliers inserted');
  }

  saveDB();
  console.log('✅ Database initialized');
  return db;
}

export function saveDB() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export function getDB() {
  return db;
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
  saveDB();
  return { lastId: db.exec('SELECT last_insert_rowid()')[0]?.values[0][0], changes: db.getRowsModified() };
}
