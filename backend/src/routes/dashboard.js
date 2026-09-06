import { Router } from 'express';
import { query } from '../database.js';
import { generateExcelBuffer, generateWeeklyPlanningBuffer, generateNextWeekPlanningBuffer } from '../services/excelExporter.js';
import { getNextWeekRange } from '../services/dateCalculator.js';

const router = Router();

router.get('/export', (req, res) => {
  const orders = query(`SELECT o.*, s.name as supplier_name FROM orders o LEFT JOIN suppliers s ON o.supplier_id = s.id ORDER BY o.created_at DESC`);
  const buffer = generateExcelBuffer(orders);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=ordenes_orderflow.xlsx');
  res.send(Buffer.from(buffer));
});

router.get('/export-weekly', (req, res) => {
  const orders = query(`SELECT o.*, s.name as supplier_name FROM orders o LEFT JOIN suppliers s ON o.supplier_id = s.id WHERE o.status != 'completed' ORDER BY o.deadline ASC`);
  const buffer = generateWeeklyPlanningBuffer(orders);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=planificacion_semanal_orderflow.xlsx');
  res.send(Buffer.from(buffer));
});

router.get('/export-next-week', (req, res) => {
  const { end } = getNextWeekRange();
  const orders = query(
    `SELECT o.*, s.name as supplier_name FROM orders o LEFT JOIN suppliers s ON o.supplier_id = s.id
     WHERE o.status != 'completed' AND o.deadline IS NOT NULL AND o.deadline <= ?
     ORDER BY o.deadline ASC`,
    [end]
  );
  const buffer = generateNextWeekPlanningBuffer(orders);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=proxima_semana_orderflow.xlsx');
  res.send(Buffer.from(buffer));
});

export default router;
