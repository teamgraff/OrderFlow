/**
 * Convierte una OT leída de Teamgraff (parseOtHtml) en los datos de una orden de Orderflow,
 * con el mismo formato de ítems que produce la carga manual: una fila por talla.
 *
 * No se inventa nada: lo que no viene en la OT queda vacío y, si es relevante,
 * la orden queda como "incompleta" con el motivo en review_notes.
 * Precio, SKU, valor neto, fecha de pago y proveedor no vienen en la OT: se completan a mano, como hoy.
 */

export function mapOtToOrder(ot, listed = null) {
  const reasons = [...ot.warnings];

  const clientName = ot.clientName || listed?.clientName || null;
  if (!ot.clientName) reasons.push(listed?.clientName ? 'La OT no trae la empresa; se usó el nombre del listado de Teamgraff.' : 'La OT no trae el nombre de la empresa.');
  // El RUT se guarda tal como viene ("si está disponible"); a personas naturales Teamgraff les pone
  // un código corto (ej. "2257-0"), por eso su formato no marca la orden como incompleta.

  const technique = detectTechnique(ot.lines);
  if (technique === null) reasons.push('No se pudo determinar la técnica (bordado/estampado): la OT no lo indica explícitamente.');

  const items = [];
  for (const line of ot.lines) {
    for (const s of line.sizes) {
      items.push({
        line_no: line.lineNo,
        product_name: line.article,
        sku: '',
        color: line.color || '',
        size: s.size || '',
        quantity: s.qty,
        unit_price: 0,
        logo_position: line.logoPosition,
        logo_size: line.logoSize,
        notes: line.note,
      });
    }
  }

  return {
    custom_ot: ot.number,
    teamgraff_quote: ot.quoteNumber,
    client_name: clientName || `OT ${ot.number} (sin empresa)`,
    client_rut: ot.clientRut,
    contact_name: ot.contactName,
    contact_email: ot.contactEmail,
    quote_date: toIsoDate(ot.issuedAt),
    logo_technique: technique,
    notes: ot.notes,
    source: 'sync',
    processing_status: reasons.length ? 'incompleta' : 'ok',
    review_notes: reasons.length ? reasons.join('\n') : null,
    items,
  };
}

/** Técnica solo si la OT la menciona explícitamente; null si no se puede saber. */
export function detectTechnique(lines) {
  const text = lines.map((l) => `${l.article ?? ''} ${l.logoPosition ?? ''} ${l.logoSize ?? ''} ${l.note ?? ''}`).join(' ').toLowerCase();
  const bordado = /bordad/.test(text);
  const estampado = /estampad/.test(text);
  if (bordado && estampado) return 'BORDADO Y ESTAMPADO';
  if (bordado) return 'BORDADO';
  if (estampado) return 'ESTAMPADO';
  if (lines.every((l) => /sin logo/i.test(l.logoPosition ?? '') || /sin logo/i.test(l.logoSize ?? ''))) return 'SIN LOGO';
  return null;
}

/** "16/10/2026" -> "2026-10-16" */
export function toIsoDate(ddmmyyyy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddmmyyyy ?? '');
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
