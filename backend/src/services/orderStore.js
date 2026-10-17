import { queryOne, transaction, nextCounter, getDB, formatOf } from '../database.js';
import { addBusinessDays } from './dateCalculator.js';

export class DuplicateOtError extends Error {
  constructor(ot, existing) {
    super(`La OT ${ot} ya existe en Orderflow como ${formatOf(existing.of_number) ?? `#${existing.id}`} (${existing.client_name}).`);
    this.status = 409;
    this.existingId = existing.id;
  }
}

/** N° de OT de Teamgraff normalizado (solo dígitos) o null. */
export function normalizeOt(value) {
  const s = String(value ?? '').trim();
  return /^\d+$/.test(s) ? String(Number(s)) : null;
}

export function findByOt(ot) {
  return ot ? queryOne('SELECT id, of_number, client_name FROM orders WHERE teamgraff_ot = ?', [ot]) : null;
}

/**
 * Crea una orden con sus ítems en UNA transacción y le asigna el siguiente N° OF.
 * Lo usan la carga manual y la sincronización automática, así ambas producen el mismo registro.
 * Si el N° de OT ya existe lanza DuplicateOtError y no se consume ningún N° OF.
 */
export function createOrder(data) {
  const ot = normalizeOt(data.custom_ot);
  const today = new Date().toISOString().split('T')[0];
  const deadline = data.payment_date ? addBusinessDays(data.payment_date, 10) : null;

  return transaction(() => {
    const existing = findByOt(ot);
    if (existing) throw new DuplicateOtError(ot, existing);

    const ofNumber = nextCounter('of_number');
    const db = getDB();
    db.run(
      `INSERT INTO orders (of_number, custom_ot, teamgraff_ot, teamgraff_quote, client_name, client_rut, contact_name, contact_email,
        quote_date, net_value, profit_margin, payment_date, deadline, supplier_order_number, supplier_id, logo_technique,
        delivery_status, raw_quote_text, generated_email, notes, source, processing_status, review_notes, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ofNumber, data.custom_ot ? String(data.custom_ot).trim() : null, ot, data.teamgraff_quote || null,
        data.client_name, data.client_rut || null, data.contact_name || null, data.contact_email || null,
        data.quote_date || today, data.net_value || 0, data.profit_margin ?? 30, data.payment_date || null, deadline,
        data.supplier_order_number || null, data.supplier_id || null,
        data.logo_technique === undefined ? 'SIN LOGO' : data.logo_technique,
        data.delivery_status || 'sin_verificar', data.raw_quote_text || null, data.generated_email || null, data.notes || null,
        data.source || 'manual', data.processing_status || 'ok', data.review_notes || null,
        data.source === 'sync' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
      ]
    );
    const orderId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    insertItems(orderId, data.items);
    return queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  });
}

/** Inserta ítems de una orden (llamar dentro de una transacción). */
export function insertItems(orderId, items) {
  if (!Array.isArray(items)) return;
  const db = getDB();
  for (const item of items) {
    db.run(
      'INSERT INTO order_items (order_id, product_name, sku, color, size, quantity, unit_price, notes, line_no, logo_position, logo_size) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [orderId, item.product_name || '', item.sku || '', item.color || '', item.size || '', item.quantity || 0, item.unit_price || 0,
        item.notes || null, item.line_no ?? null, item.logo_position || null, item.logo_size || null]
    );
  }
}
