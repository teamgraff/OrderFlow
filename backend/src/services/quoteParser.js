// ── Smart Quote Parser ───────────────────────────────────────────────────────
// Parses pasted quote text and extracts structured product data.
// Supports multiple formats: tabular, list-based, and semi-structured text.

/**
 * Parse a raw quote text and extract structured data.
 * @param {string} rawText - The pasted quote text
 * @returns {{ client: string|null, netValue: number|null, items: Array<object> }}
 */
export function parseQuote(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { client: null, netValue: null, items: [] };
  }

  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const result = {
    client: extractClient(lines, rawText),
    netValue: extractNetValue(lines, rawText),
    items: [],
  };

  // Try different parsing strategies in order of specificity
  result.items = tryParseTabular(lines)
    || tryParseStructuredList(lines)
    || tryParseFreeText(lines)
    || [];

  return result;
}

// ── Client Extraction ───────────────────────────────────────────────────────

function extractClient(lines, rawText) {
  // Look for "Cliente:", "Razón Social:", "Empresa:", "Señor(es):", "Para:"
  const clientPatterns = [
    /(?:cliente|razón\s*social|empresa|señor(?:es)?|para|destinatario|rut)\s*[:]\s*(.+)/i,
    /(?:cotizaci[oó]n\s+(?:para|a))\s+(.+)/i,
  ];

  for (const line of lines) {
    for (const pattern of clientPatterns) {
      const match = line.match(pattern);
      if (match) {
        return match[1].trim().replace(/[.\-_]+$/, '').trim();
      }
    }
  }

  return null;
}

// ── Net Value Extraction ────────────────────────────────────────────────────

function extractNetValue(lines, rawText) {
  // Look for "Total Neto:", "Valor Neto:", "Subtotal:", "NETO:", "Total:"
  const valuePatterns = [
    /(?:total\s*neto|valor\s*neto|neto|subtotal|total)\s*[:$]\s*\$?\s*([\d.,]+)/i,
  ];

  for (const line of lines) {
    for (const pattern of valuePatterns) {
      const match = line.match(pattern);
      if (match) {
        // Parse Chilean number format: 1.234.567 or 1,234,567
        const numStr = match[1].replace(/\./g, '').replace(/,/g, '.');
        const value = parseFloat(numStr);
        if (!isNaN(value)) return value;
      }
    }
  }

  return null;
}

// ── Strategy 1: Tabular Format ──────────────────────────────────────────────
// Detects lines separated by tabs, pipes, or multiple spaces that look like
// table rows with columns for SKU, product, color, size, quantity, price.

function tryParseTabular(lines) {
  // Find lines that look tabular (contain tabs, pipes, or 2+ double-spaces)
  const tabularLines = lines.filter(line =>
    line.includes('\t') || line.includes('|') || /\s{2,}/.test(line)
  );

  if (tabularLines.length < 2) return null; // Need at least header + 1 row

  // Determine separator
  let separator;
  if (tabularLines[0].includes('\t')) separator = '\t';
  else if (tabularLines[0].includes('|')) separator = '|';
  else separator = /\s{2,}/;

  // Parse header to find column indices
  const headerLine = tabularLines[0];
  const headerCells = headerLine.split(separator).map(c => c.trim().toLowerCase());

  const colMap = detectColumns(headerCells);

  if (!colMap.hasMinimumColumns) return null;

  const items = [];
  for (let i = 1; i < tabularLines.length; i++) {
    const cells = tabularLines[i].split(separator).map(c => c.trim());
    if (cells.length < 2) continue;

    const item = extractItemFromCells(cells, colMap);
    if (item && (item.sku || item.product_name)) {
      items.push(item);
    }
  }

  return items.length > 0 ? items : null;
}

function detectColumns(headers) {
  const map = {
    sku: -1,
    product: -1,
    color: -1,
    size: -1,
    quantity: -1,
    price: -1,
    hasMinimumColumns: false,
  };

  headers.forEach((h, i) => {
    if (/^(sku|c[oó]digo|cod|ref|art[ií]culo|item)$/i.test(h)) map.sku = i;
    else if (/^(producto|descripci[oó]n|prenda|nombre|detalle|item)$/i.test(h)) map.product = i;
    else if (/^(color|col)$/i.test(h)) map.color = i;
    else if (/^(talla|talle|size|tam|medida)$/i.test(h)) map.size = i;
    else if (/^(cantidad|cant|qty|unid|unidades|pcs)$/i.test(h)) map.quantity = i;
    else if (/^(precio|price|valor|unit|p\.?u\.?|p\.?\s*unit)$/i.test(h)) map.price = i;
  });

  // Need at least 2 recognized columns
  const recognized = [map.sku, map.product, map.color, map.size, map.quantity].filter(v => v >= 0).length;
  map.hasMinimumColumns = recognized >= 2;

  return map;
}

function extractItemFromCells(cells, colMap) {
  return {
    product_name: colMap.product >= 0 ? cells[colMap.product] || '' : '',
    sku: colMap.sku >= 0 ? cells[colMap.sku] || '' : '',
    color: colMap.color >= 0 ? cells[colMap.color] || '' : '',
    size: colMap.size >= 0 ? cells[colMap.size] || '' : '',
    quantity: colMap.quantity >= 0 ? parseInt(cells[colMap.quantity]) || 0 : 0,
    unit_price: colMap.price >= 0 ? parseFloat(String(cells[colMap.price]).replace(/[$.]/g, '').replace(',', '.')) || 0 : 0,
  };
}

// ── Strategy 2: Structured List ─────────────────────────────────────────────
// Lines like:
//   - Polera Piqué / SKU: TN-001 / Color: Negro / Tallas: S(5), M(10), L(8)
//   - 10 x Camisa Oxford Azul, talla M, SKU: CS-200

function tryParseStructuredList(lines) {
  const items = [];

  for (const line of lines) {
    // Skip headers and metadata lines
    if (/^(cliente|empresa|cotizaci|fecha|total|neto|iva|subtotal|rut|nota|observ)/i.test(line)) continue;

    // Pattern: has SKU-like code and quantity somewhere
    const skuMatch = line.match(/(?:sku|c[oó]d(?:igo)?|ref|art)\s*[:.]?\s*([A-Z0-9][\w-]+)/i);
    const colorMatch = line.match(/(?:color)\s*[:.]?\s*([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\s*[/,|]|$)/i);
    const qtyMatch = line.match(/(?:cant(?:idad)?|qty|unid(?:ades)?)\s*[:.]?\s*(\d+)/i)
      || line.match(/^[-•*]\s*(\d+)\s*[xX×]\s*/);

    // Tallas pattern: S(5), M(10), L(8) or talla: M or tallas: S,M,L
    const tallasExpandedMatch = line.match(/(?:tallas?)\s*[:.]?\s*((?:[A-Z0-9XS]+\s*\(\s*\d+\s*\)\s*[,;]?\s*)+)/i);
    const tallaSimpleMatch = line.match(/(?:talla|talle|size)\s*[:.]?\s*([A-Z0-9XS]+)/i);

    if (tallasExpandedMatch) {
      // Multiple sizes with quantities: S(5), M(10), L(8)
      const sizeEntries = tallasExpandedMatch[1].matchAll(/([A-Z0-9XS]+)\s*\(\s*(\d+)\s*\)/gi);
      for (const entry of sizeEntries) {
        items.push({
          product_name: extractProductName(line),
          sku: skuMatch ? skuMatch[1] : '',
          color: colorMatch ? colorMatch[1].trim() : '',
          size: entry[1].toUpperCase(),
          quantity: parseInt(entry[2]) || 0,
          unit_price: 0,
        });
      }
    } else if (skuMatch || qtyMatch) {
      items.push({
        product_name: extractProductName(line),
        sku: skuMatch ? skuMatch[1] : '',
        color: colorMatch ? colorMatch[1].trim() : '',
        size: tallaSimpleMatch ? tallaSimpleMatch[1].toUpperCase() : '',
        quantity: qtyMatch ? parseInt(qtyMatch[1]) || 0 : 0,
        unit_price: 0,
      });
    }
  }

  return items.length > 0 ? items : null;
}

function extractProductName(line) {
  // Remove common prefixes (-, *, •, numbers)
  let cleaned = line.replace(/^[-•*]\s*/, '').replace(/^\d+\s*[xX×]\s*/, '');
  // Take first segment before / or |
  cleaned = cleaned.split(/[/|]/)[0].trim();
  // Remove SKU references
  cleaned = cleaned.replace(/\b(?:sku|c[oó]d(?:igo)?|ref)\s*[:.]?\s*[A-Z0-9][\w-]*/gi, '').trim();
  // Remove quantity refs
  cleaned = cleaned.replace(/\b(?:cant(?:idad)?|qty|unid(?:ades)?)\s*[:.]?\s*\d+/gi, '').trim();
  // Clean trailing punctuation
  cleaned = cleaned.replace(/[,;:\-/|]+$/, '').trim();

  return cleaned || 'Producto';
}

// ── Strategy 3: Free Text (Fallback) ────────────────────────────────────────
// Tries to find any line with product-like data

function tryParseFreeText(lines) {
  const items = [];

  for (const line of lines) {
    // Skip short lines and metadata
    if (line.length < 5) continue;
    if (/^(cliente|empresa|cotizaci|fecha|total|neto|iva|subtotal|rut|nota|observ|estimad|atent|salud)/i.test(line)) continue;

    // Look for lines with a code-like pattern (letters+numbers+dash)
    const codeMatch = line.match(/\b([A-Z]{1,5}[-]?\d{2,}[\w-]*)\b/i);
    if (!codeMatch) continue;

    // Try to extract quantity
    const qtyMatch = line.match(/\b(\d{1,4})\s*(?:un|pcs|pz|u\b)/i) || line.match(/\b(\d{1,4})\b/);
    const sizeMatch = line.match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL|\d{2})\b/i);
    const colorWords = ['negro', 'blanco', 'azul', 'rojo', 'verde', 'gris', 'navy', 'beige', 'celeste', 'burdeo', 'amarillo', 'naranjo'];
    const colorMatch = colorWords.find(c => line.toLowerCase().includes(c));

    items.push({
      product_name: extractProductName(line),
      sku: codeMatch[1],
      color: colorMatch || '',
      size: sizeMatch ? sizeMatch[1].toUpperCase() : '',
      quantity: qtyMatch ? parseInt(qtyMatch[1]) || 0 : 0,
      unit_price: 0,
    });
  }

  return items.length > 0 ? items : null;
}
