import * as XLSX from 'xlsx';

export function generateExcelBuffer(orders) {
  const data = orders.map(o => ({
    'ID': o.id,
    'Cliente': o.client_name,
    'Fecha Cotización': o.quote_date || '',
    'Fecha Pago': o.payment_date || '',
    'Fecha Límite': o.deadline || '',
    'Estado': o.status,
    'Proveedor': o.supplier_name || '',
    'Nro Orden Proveedor': o.supplier_order_number || '',
    'Valor Neto': o.net_value || 0,
    '% Utilidad': o.profit_margin || 0,
    'Notas': o.notes || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 5 }, { wch: 25 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 25 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Órdenes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
