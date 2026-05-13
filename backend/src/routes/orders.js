import { Router } from 'express';
import { query, queryOne, run } from '../database.js';
import { addBusinessDays, getOrderVisualStatus } from '../services/dateCalculator.js';
import { generateAllEmails } from '../services/orderGenerator.js';

const router = Router();

function enrichOrder(order) {
  if (!order) return null;
  const items = query('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
  const supplier = order.supplier_id ? queryOne('SELECT * FROM suppliers WHERE id = ?', [order.supplier_id]) : null;
  return { ...order, items, supplier, supplier_name: supplier?.name || '', visual_status: getOrderVisualStatus(order) };
}

router.get('/', (req, res) => {
  const { status, search, client, month, supplier_id, logo_technique, delivery_status } = req.query;
  let sql = `SELECT o.*, s.name as supplier_name FROM orders o LEFT JOIN suppliers s ON o.supplier_id = s.id WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND o.status = ?`; params.push(status); }
  if (logo_technique) { sql += ` AND o.logo_technique = ?`; params.push(logo_technique); }
  if (delivery_status) { sql += ` AND o.delivery_status = ?`; params.push(delivery_status); }
  const searchTerm = search || client;
  if (searchTerm) { sql += ` AND (o.client_name LIKE ? OR o.custom_ot LIKE ?)`; params.push(`%${searchTerm}%`, `%${searchTerm}%`); }
  if (month) { sql += ` AND strftime('%Y-%m', o.created_at) = ?`; params.push(month); }
  if (supplier_id) { sql += ` AND o.supplier_id = ?`; params.push(Number(supplier_id)); }
  sql += ` ORDER BY o.created_at DESC`;
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
  const { custom_ot, client_name, quote_date, net_value, profit_margin, payment_date, supplier_order_number, supplier_id, logo_technique, delivery_status, raw_quote_text, generated_email, notes, items } = req.body;
  if (!client_name) return res.status(400).json({ error: 'Se requiere el nombre del cliente' });
  const deadline = payment_date ? addBusinessDays(payment_date, 10) : null;
  const today = new Date().toISOString().split('T')[0];
  const result = run(
    `INSERT INTO orders (custom_ot, client_name, quote_date, net_value, profit_margin, payment_date, deadline, supplier_order_number, supplier_id, logo_technique, delivery_status, raw_quote_text, generated_email, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [custom_ot || null, client_name, quote_date || today, net_value || 0, profit_margin ?? 30, payment_date || null, deadline, supplier_order_number || null, supplier_id || null, logo_technique || 'SIN LOGO', delivery_status || 'sin_verificar', raw_quote_text || null, generated_email || null, notes || null]
  );
  const orderId = result.lastId;
  if (items && Array.isArray(items)) {
    for (const item of items) {
      run('INSERT INTO order_items (order_id, product_name, sku, color, size, quantity, unit_price) VALUES (?,?,?,?,?,?,?)',
        [orderId, item.product_name || '', item.sku || '', item.color || '', item.size || '', item.quantity || 0, item.unit_price || 0]);
    }
  }
  const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  res.status(201).json(enrichOrder(order));
});

router.put('/:id', (req, res) => {
  const existing = queryOne('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Orden no encontrada' });
  const { custom_ot, client_name, quote_date, net_value, profit_margin, payment_date, supplier_order_number, supplier_id, logo_technique, delivery_status, status, notes } = req.body;
  const newPaymentDate = payment_date !== undefined ? payment_date : existing.payment_date;
  const deadline = newPaymentDate ? addBusinessDays(newPaymentDate, 10) : existing.deadline;
  run(
    `UPDATE orders SET custom_ot=?, client_name=?, quote_date=?, net_value=?, profit_margin=?, payment_date=?, deadline=?, supplier_order_number=?, supplier_id=?, logo_technique=?, delivery_status=?, status=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [custom_ot !== undefined ? custom_ot : existing.custom_ot, client_name || existing.client_name, quote_date ?? existing.quote_date, net_value ?? existing.net_value, profit_margin ?? existing.profit_margin, newPaymentDate, deadline, supplier_order_number ?? existing.supplier_order_number, supplier_id ?? existing.supplier_id, logo_technique || existing.logo_technique, delivery_status || existing.delivery_status, status || existing.status, notes ?? existing.notes, Number(req.params.id)]
  );
  const updated = queryOne('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  res.json(enrichOrder(updated));
});

router.delete('/:id', (req, res) => {
  run('DELETE FROM order_items WHERE order_id = ?', [Number(req.params.id)]);
  const result = run('DELETE FROM orders WHERE id = ?', [Number(req.params.id)]);
  if (result.changes === 0) return res.status(404).json({ error: 'Orden no encontrada' });
  res.json({ success: true });
});

router.post('/generate-emails', (req, res) => {
  const { items, client_name } = req.body;
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'Se requiere un array de items' });
  const emails = generateAllEmails(items, client_name || '');
  res.json(emails);
});

export default router;
