import * as XLSX from 'xlsx';

export function generateExcelBuffer(orders) {
  const data = orders.map(o => ({
    'ID': o.id,
    'N° OF': o.of_number ? `OF-${String(o.of_number).padStart(4, '0')}` : '',
    'N° OT': o.custom_ot || '',
    'Cliente': o.client_name,
    'RUT': o.client_rut || '',
    'Fecha Cotización': o.quote_date || '',
    'Fecha Pago': o.payment_date || '',
    'Fecha Límite': o.deadline || '',
    'Estado': o.status,
    'Proveedor': o.supplier_name || '',
    'Nro Orden Proveedor': o.supplier_order_number || '',
    'Valor Neto': o.net_value || 0,
    '% Utilidad': o.profit_margin || 0,
    'Notas': o.notes || '',
    'Origen': o.source === 'sync' ? 'Teamgraff (automático)' : 'Manual',
    'Procesamiento': o.processing_status || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 5 }, { wch: 9 }, { wch: 8 }, { wch: 25 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 25 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 30 }, { wch: 22 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Órdenes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const DELIVERY_LABELS = {
  completo: 'COMPLETO',
  con_faltantes: 'FALTANTE',
  sin_verificar: 'SIN VERIFICAR',
};

function formatDateDMY(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function generateWeeklyPlanningBuffer(orders) {
  const data = orders.map(o => ({
    'OT': o.custom_ot || `#${o.id}`,
    'RECEPCIÓN (COMPLETO/FALTANTE)': DELIVERY_LABELS[o.delivery_status] || 'SIN VERIFICAR',
    'FECHA DE ENTREGA': formatDateDMY(o.deadline),
    'COMENTARIOS': o.notes || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 15 },  // OT
    { wch: 30 },  // RECEPCIÓN
    { wch: 18 },  // FECHA DE ENTREGA
    { wch: 50 },  // COMENTARIOS
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planificación Semanal');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function generateNextWeekPlanningBuffer(orders) {
  const today = new Date().toISOString().split('T')[0];
  const data = orders.map(o => ({
    'URGENCIA': o.deadline && o.deadline < today ? '🔴 VENCIDA' : '🟡 PRÓXIMA SEMANA',
    'OT': o.custom_ot || `#${o.id}`,
    'CLIENTE': o.client_name || '',
    'RECEPCIÓN (COMPLETO/FALTANTE)': DELIVERY_LABELS[o.delivery_status] || 'SIN VERIFICAR',
    'FECHA DE ENTREGA': formatDateDMY(o.deadline),
    'COMENTARIOS': o.notes || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 18 },  // URGENCIA
    { wch: 15 },  // OT
    { wch: 25 },  // CLIENTE
    { wch: 30 },  // RECEPCIÓN
    { wch: 18 },  // FECHA DE ENTREGA
    { wch: 50 },  // COMENTARIOS
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Próxima Semana');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
