import { Router } from 'express';
import { query } from '../database.js';
import { generateExcelBuffer } from '../services/excelExporter.js';

const router = Router();

router.get('/export', (req, res) => {
  const orders = query(`SELECT o.*, s.name as supplier_name FROM orders o LEFT JOIN suppliers s ON o.supplier_id = s.id ORDER BY o.created_at DESC`);
  const buffer = generateExcelBuffer(orders);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=ordenes_orderflow.xlsx');
  res.send(Buffer.from(buffer));
});

export default router;
