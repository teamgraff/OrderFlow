import { Router } from 'express';
import { query, queryOne, run, transaction, getDB } from '../database.js';
import { addBusinessDays, getOrderVisualStatus } from '../services/dateCalculator.js';
import { generateAllEmails } from '../services/orderGenerator.js';
import { createOrder, findByOt, normalizeOt, DuplicateOtError } from '../services/orderStore.js';

const router = Router();

function enrichOrder(order) {
  if (!order) return null;
  const items = query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  const supplier = order.supplier_id ? queryOne('SELECT * FROM suppliers WHERE id = ?', [order.supplier_id]) : null;
  return { ...order, items, supplier, supplier_name: supplier?.name || '', visual_status: getOrderVisualStatus(order) };
}

router.get('/', (req, res) => {
  const { status, search, client, month, supplier_id, logo_technique, delivery_status, processing_status, source } = req.query;
  let sql = `SELECT o.*, s.name as supplier_name, (SELECT COALESCE(SUM(quantity),0) FROM order_items i WHERE i.order_id = o.id) AS total_units
    FROM orders o LEFT JOIN suppliers s ON o.supplier_id = s.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND o.status = ?`; params.push(status); }
  if (logo_technique) { sql += ` AND o.logo_technique = ?`; params.push(logo_technique); }
  if (delivery_status) { sql += ` AND o.delivery_status = ?`; params.push(delivery_status); }
  const searchTerm = search || client;
  if (searchTerm) {
    // También acepta el N° interno escrito con prefijo: "OF-0012" u "of12".
    const ofNum = /^\s*of-?\s*0*(\d+)\s*$/i.exec(searchTerm)?.[1] ?? '';
    sql += ` AND (o.client_name LIKE ? OR o.custom_ot LIKE ? OR CAST(o.id AS TEXT) = ? OR CAST(o.of_number AS TEXT) = ?)`;
    params.push(`%${searchTerm}%`, `%${searchTerm}%`, searchTerm.trim(), ofNum);
  }
  if (month) { sql += ` AND strftime('%Y-%m', o.created_at) = ?`; params.push(month); }
  if (supplier_id) { sql += ` AND o.supplier_id = ?`; params.push(Number(supplier_id)); }
  if (processing_status === 'revisar') sql += ` AND o.processing_status IN ('incompleta','pendiente','error')`;
  else if (processing_status) { sql += ` AND o.processing_status = ?`; params.push(processing_status); }
  if (source) { sql += ` AND o.source = ?`; params.push(source); }
  sql += ` ORDER BY o.created_at DESC, o.id DESC`;
  const orders = query(sql, params);
  const enriched = orders.map(o => ({ ...o, visual_status: getOrderVisualStatus(o) }));
  res.json(enriched);
});

router.get('/stats', (req, res) => {
  const totalRow = queryOne('SELECT COUNT(*) as count FROM orders');
  const valueRow = queryOne('SELECT COALESCE(SUM(net_value),0) as total FROM orders');
  const allOrders = query('SELECT * FROM orders');
  let pending = 0, overdue = 0, warning = 0, completed = 0;
  for (const o of allOrders) {
    const vs = getOrderVisualStatus(o);
    if (vs === 'red') overdue++;
    else if (vs === 'yellow') warning++;
    else if (vs === 'green') completed++;
    else pending++;
  }
  res.json({ total: totalRow.count, totalValue: valueRow.total, pending, overdue, warning, completed });
});

router.get('/:id', (req, res) => {
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
  res.json(enrichOrder(order));
});

router.post('/', (req, res) => {
  const { client_name, items, ...rest } = req.body;
  if (!client_name) return res.status(400).json({ error: 'Se requiere el nombre del cliente' });
  try {
    // Carga manual: mismo registro que la sincronización (N° OF correlativo y control de duplicados).
    const order = createOrder({ ...rest, client_name, items, source: 'manual', processing_status: 'ok', review_notes: null, imported_at: null });
    res.status(201).json(enrichOrder(order));
  } catch (err) {
    if (err instanceof DuplicateOtError) return res.status(409).json({ error: err.message, existingId: err.existingId });
    throw err;
  }
});

router.put('/:id', (req, res) => {
  const existing = queryOne('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Orden no encontrada' });
  const { custom_ot, client_name, quote_date, net_value, profit_margin, payment_date, supplier_order_number, supplier_id, logo_technique, delivery_status, status, notes } = req.body;
  const newCustomOt = custom_ot !== undefined ? custom_ot : existing.custom_ot;
  const newOt = normalizeOt(newCustomOt);
  const clash = newOt ? findByOt(newOt) : null;
  if (clash && clash.id !== existing.id) {
    return res.status(409).json({ error: new DuplicateOtError(newOt, clash).message, existingId: clash.id });
  }
  const newPaymentDate = payment_date !== undefined ? payment_date : existing.payment_date;
  const deadline = newPaymentDate ? addBusinessDays(newPaymentDate, 10) : existing.deadline;
  run(
    `UPDATE orders SET custom_ot=?, teamgraff_ot=?, client_name=?, quote_date=?, net_value=?, profit_margin=?, payment_date=?, deadline=?, supplier_order_number=?, supplier_id=?, logo_technique=?, delivery_status=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [newCustomOt, newOt, client_name || existing.client_name, quote_date ?? existing.quote_date, net_value ?? existing.net_value, profit_margin ?? existing.profit_margin, newPaymentDate, deadline, supplier_order_number ?? existing.supplier_order_number, supplier_id ?? existing.supplier_id, logo_technique || existing.logo_technique, delivery_status || existing.delivery_status, status || existing.status, notes ?? existing.notes, Number(req.params.id)]
  );
  // "Marcar como revisada": la única transición de procesamiento que se hace a mano.
  if (req.body.processing_status === 'ok' && existing.processing_status === 'incompleta') {
    run(`UPDATE orders SET processing_status = 'ok', review_notes = NULL WHERE id = ?`, [existing.id]);
  }
  const updated = queryOne('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  res.json(enrichOrder(updated));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const changes = transaction(() => {
    const db = getDB();
    db.run('UPDATE sync_issues SET order_id = NULL WHERE order_id = ?', [id]);
    db.run('DELETE FROM order_items WHERE order_id = ?', [id]);
    db.run('DELETE FROM orders WHERE id = ?', [id]);
    return db.getRowsModified();
  });
  if (changes === 0) return res.status(404).json({ error: 'Orden no encontrada' });
  res.json({ success: true });
});

router.post('/generate-emails', (req, res) => {
  const { items, client_name } = req.body;
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Se requiere un array de items' });
  const emails = generateAllEmails(items, client_name || '');
  res.json(emails);
});

export default router;
