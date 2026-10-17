import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { useTempDataDir } from './helpers.js';

const dataDir = useTempDataDir();

test('Migración sobre una base antigua: respaldo, N° OF por orden de creación, vínculo OT y duplicados marcados', async () => {
  // Base con el esquema anterior (como la de producción).
  const SQL = await initSqlJs();
  const old = new SQL.Database();
  old.run(`CREATE TABLE suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, sku_prefix TEXT, phone TEXT, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  old.run(`INSERT INTO suppliers (name) VALUES ('Proveedor real')`);
  old.run(`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, custom_ot TEXT, quote_date DATE, client_name TEXT NOT NULL, net_value REAL DEFAULT 0,
    profit_margin REAL DEFAULT 30, payment_date DATE, deadline DATE, supplier_order_number TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','overdue')), supplier_id INTEGER REFERENCES suppliers(id),
    logo_technique TEXT DEFAULT 'SIN LOGO', delivery_status TEXT DEFAULT 'sin_verificar', raw_quote_text TEXT, generated_email TEXT, notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  old.run(`CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_name TEXT, sku TEXT, color TEXT, size TEXT, quantity INTEGER DEFAULT 0, unit_price REAL DEFAULT 0, notes TEXT)`);
  const rows = [[5, '3500', 'A'], [9, '3665', 'Cliente equivocado'], [12, null, 'Sin OT'], [20, ' 3600 ', 'B'], [31, '3665', 'Cliente correcto']];
  for (const [id, ot, c] of rows) old.run('INSERT INTO orders (id, custom_ot, client_name, net_value) VALUES (?, ?, ?, 100)', [id, ot, c]);
  old.run(`INSERT INTO order_items (order_id, product_name, quantity) VALUES (5, 'Polera', 3)`);
  fs.writeFileSync(path.join(dataDir, 'orderflow.db'), Buffer.from(old.export()));

  const db = await import('../src/database.js');
  await db.initDB();

  const os = db.query('SELECT id, of_number, teamgraff_ot, processing_status, review_notes, net_value FROM orders ORDER BY id');
  assert.deepEqual(os.map((o) => [o.id, o.of_number, o.teamgraff_ot]), [[5, 1, '3500'], [9, 2, null], [12, 3, null], [20, 4, '3600'], [31, 5, '3665']]);
  assert.equal(os[1].processing_status, 'incompleta');
  assert.match(os[1].review_notes, /OF-0005/);
  assert.ok(os.every((o) => o.net_value === 100), 'no se pierden datos');
  assert.equal(db.query('SELECT * FROM order_items').length, 1);
  assert.equal(db.query('SELECT * FROM suppliers').length, 1, 'no agrega proveedores de ejemplo a una base existente');
  assert.equal(db.queryOne(`SELECT value FROM counters WHERE name='of_number'`).value, 5);
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).length, 1, 'respaldo antes de migrar');

  // La siguiente orden continúa la numeración.
  const { createOrder } = await import('../src/services/orderStore.js');
  assert.equal(createOrder({ client_name: 'Nueva' }).of_number, 6);

  // Reiniciar no vuelve a migrar ni a respaldar.
  await db.initDB();
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).length, 1);
  assert.equal(db.query('SELECT * FROM orders').length, 6);
});
