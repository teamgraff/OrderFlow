import { query } from '../database.js';

export function detectSupplier(sku) {
  if (!sku) return null;
  const suppliers = query('SELECT * FROM suppliers');
  for (const supplier of suppliers) {
    if (!supplier.sku_prefix) continue;
    const prefixes = supplier.sku_prefix.split(',').map(p => p.trim().toUpperCase());
    const skuUpper = sku.toUpperCase();
    for (const prefix of prefixes) {
      if (skuUpper.startsWith(prefix)) return supplier;
    }
  }
  return null;
}

export function groupItemsBySupplier(items) {
  const groups = new Map();
  for (const item of items) {
    const supplier = detectSupplier(item.sku);
    const key = supplier ? supplier.id : 'unknown';
    if (!groups.has(key)) groups.set(key, { supplier, items: [] });
    groups.get(key).items.push(item);
  }
  return groups;
}

export function generateEmail(supplier, items, clientName = '') {
  // If supplier name has spaces, try to get the first name or contact person, otherwise use the full name
  const contactName = supplier ? supplier.name.split(' ')[0] : 'Pablo'; 
  
  let email = `Hola ${contactName}\n\nJunto con saludar, y esperando que te encuentres bien. Por favor, nos apoyas con la gestión del siguiente pedido\n\n`;
  
  // Group items by Product + SKU + Color
  const groupedItems = new Map();
  for (const item of items) {
    const key = `${item.product_name}|${item.sku}|${item.color}`;
    if (!groupedItems.has(key)) {
      groupedItems.set(key, {
        product_name: item.product_name,
        sku: item.sku,
        color: item.color,
        sizes: []
      });
    }
    if (item.quantity > 0) {
      groupedItems.get(key).sizes.push({ size: item.size, quantity: item.quantity });
    }
  }

  // Generate output for each group
  for (const [, group] of groupedItems) {
    const prodName = (group.product_name || 'PRODUCTO').toUpperCase();
    const sku = group.sku || '';
    const color = (group.color || '').toUpperCase();

    email += `${prodName}\n`;
    if (sku) email += `SKU ${sku}\n`;
    if (color) email += `Color: ${color}\n`;
    
    for (const s of group.sizes) {
      email += `${s.quantity} ${s.size}\n`;
    }
    email += '\n'; // Blank line between products
  }

  email += `\nQUEDO ATENTA\nSALUDOS`;
  return email;
}

export function generateAllEmails(items, clientName = '') {
  const groups = groupItemsBySupplier(items);
  const results = [];
  for (const [, group] of groups) {
    results.push({ supplier: group.supplier, email: generateEmail(group.supplier, group.items, clientName), items: group.items });
  }
  return results;
}
