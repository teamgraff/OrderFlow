import { Router } from 'express';
import { query, queryOne, run } from '../database.js';

const router = Router();

router.get('/', (req, res) => {
  const suppliers = query('SELECT * FROM suppliers ORDER BY name');
  res.json(suppliers);
});

router.get('/:id', (req, res) => {
  const supplier = queryOne('SELECT * FROM suppliers WHERE id = ?', [Number(req.params.id)]);
  if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });
  res.json(supplier);
});

router.post('/', (req, res) => {
  const { name, email, sku_prefix, phone, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Se requiere el nombre' });
  const result = run('INSERT INTO suppliers (name, email, sku_prefix, phone, notes) VALUES (?, ?, ?, ?, ?)',
    [name, email || null, sku_prefix || null, phone || null, notes || null]);
  const supplier = queryOne('SELECT * FROM suppliers WHERE id = ?', [result.lastId]);
  res.status(201).json(supplier);
});

router.put('/:id', (req, res) => {
  const { name, email, sku_prefix, phone, notes } = req.body;
  const existing = queryOne('SELECT * FROM suppliers WHERE id = ?', [Number(req.params.id)]);
  if (!existing) return res.status(404).json({ error: 'Proveedor no encontrado' });
  run('UPDATE suppliers SET name=?, email=?, sku_prefix=?, phone=?, notes=? WHERE id=?',
    [name || existing.name, email ?? existing.email, sku_prefix ?? existing.sku_prefix, phone ?? existing.phone, notes ?? existing.notes, Number(req.params.id)]);
  const updated = queryOne('SELECT * FROM suppliers WHERE id = ?', [Number(req.params.id)]);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const result = run('DELETE FROM suppliers WHERE id = ?', [Number(req.params.id)]);
  if (result.changes === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });
  res.json({ success: true });
});

export default router;
