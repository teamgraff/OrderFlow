/**
 * Arma el correo de compra de una orden: solo prendas, colores y tallas.
 * Agrupa por prenda + color (en el orden en que aparecen) y suma las cantidades repetidas de una misma talla.
 *
 *   POLERA CUELLO PIQUE DRYFRESH MANGA LARGA HOMBRE
 *   SKU 07014            <- solo si la prenda tiene SKU
 *   Color: AZUL MARINO
 *   3 M
 *   3 L
 */
export function buildPurchaseEmail(items, recipient = '') {
  const groups = new Map();
  for (const item of items || []) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const product = (item.product_name || '').trim().toUpperCase();
    const color = (item.color || '').trim().toUpperCase();
    const sku = (item.sku || '').trim();
    const key = `${product}|${color}|${sku}`;
    if (!groups.has(key)) groups.set(key, { product, color, sku, sizes: new Map() });
    const size = (item.size || '').trim();
    const sizes = groups.get(key).sizes;
    sizes.set(size, (sizes.get(size) || 0) + qty);
  }

  const blocks = [...groups.values()].map((g) => [
    g.product || 'PRENDA SIN NOMBRE',
    ...(g.sku ? [`SKU ${g.sku}`] : []),
    ...(g.color ? [`Color: ${g.color}`] : []),
    ...[...g.sizes].map(([size, qty]) => (size ? `${qty} ${size}` : `${qty} unidades (sin talla)`)),
  ].join('\n'));

  const name = recipient.trim();
  return [
    name ? `Hola ${name}` : 'Hola',
    '',
    'Junto con saludar, y esperando que te encuentres bien. Por favor, nos apoyas con la gestión del siguiente pedido',
    '',
    blocks.join('\n\n'),
    '',
    '',
    'QUEDO ATENTA',
    'SALUDOS',
  ].join('\n');
}
