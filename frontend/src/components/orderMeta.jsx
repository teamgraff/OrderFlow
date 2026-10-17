// Elementos compartidos para mostrar el origen y el estado de procesamiento de una orden.

export const formatOf = (n) => (n ? `OF-${String(n).padStart(4, '0')}` : '—');

/** Fechas de la base vienen en UTC ("2026-10-17 14:05:00"): se muestran en hora local. */
export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const PROCESSING = {
  ok: { label: 'Importada', class: 'badge-green', title: 'Importada desde Teamgraff y procesada correctamente' },
  incompleta: { label: 'Incompleta', class: 'badge-yellow', title: 'Faltan datos: requiere revisión' },
  pendiente: { label: 'Pendiente', class: 'badge-gray', title: 'Detectada en Teamgraff; se está reintentando leer su detalle' },
  error: { label: 'Error sync', class: 'badge-red', title: 'No se pudo leer desde Teamgraff: usar "Reprocesar"' },
};

export function ProcessingBadge({ order }) {
  if (order.source !== 'sync' && order.processing_status !== 'incompleta') {
    return <span className="badge badge-gray" title="Ingresada manualmente">✍️ Manual</span>;
  }
  const p = order.source === 'sync'
    ? PROCESSING[order.processing_status] || PROCESSING.pendiente
    : { ...PROCESSING.incompleta, title: 'Ingresada manualmente; requiere revisión' };
  return (
    <span className={`badge ${p.class}`} title={order.review_notes || p.title} style={{ whiteSpace: 'nowrap' }}>
      <span className="badge-dot" />
      {p.label}
    </span>
  );
}
