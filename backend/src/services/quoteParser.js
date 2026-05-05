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
  result.items = tryParseTeamGraffQuote(rawText)
    || tryParseTabular(lines)
    || tryParseStructuredList(lines)
    || tryParseFreeText(lines)
    || [];

  return result;
}

// ── Strategy 0: TeamGraff Quote Format ──────────────────────────────────────
// Handles the specific format from TeamGraff PDF quotes where text comes as
// a continuous string with numbered products followed by "Cantidad Talla" blocks.
//
// Example pattern:
// 1 MICROPOLAR PRACTICAL LINE HOMBRE M/L 03007 Azulino FRENTE SUPERIOR IZQUIERDO BOLSILLO
// Cantidad Talla  1   XXL 1   L  2   $ 4.590   $ 9.180
// 2 CAMISA OXFORD CLASSIC M/L HOMBRE 55% ALG 45% POLY 06012 Celeste ...

function tryParseTeamGraffQuote(rawText) {
  // Check if this looks like a TeamGraff quote
  if (!rawText.includes('Cantidad Talla') && !rawText.includes('TENEMOS EL AGRADO')) {
    return null;
  }

  const items = [];

  // Split by product number pattern: digit(s) followed by product name in caps
  // Pattern: look for numbered entries like "1 PRODUCT NAME CODE Color..."
  // followed by "Cantidad Talla" blocks with size/quantity pairs
  
  // First, find all product blocks
  // Each block starts with a number and ends before the next number or "Subtotal"
  const productPattern = /(\d+)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\/%.0-9]+?)\s+(\d{4,6})\s+([A-Za-záéíóúñÑ\s]+?)\s+(?:FRENTE|ESPALDA|PECHO|MANGA|CUELLO|SIN LOGO|BOLSILLO|SUPERIOR|INFERIOR|IZQUIERDO|DERECHO|LOGO|ESTAMPADO|BORDADO|SUBLIMADO).*?Cantidad\s+Talla\s+((?:\d+\s+[A-Z0-9]+\s*)+)\s+(\d+)\s+\$\s*([\d.,]+)\s+\$\s*([\d.,]+)/gi;

  let match;
  while ((match = productPattern.exec(rawText)) !== null) {
    const productName = match[2].trim();
    const sku = match[3].trim();
    const color = match[4].trim();
    const sizesBlock = match[5].trim();
    const unitPrice = parseChileanNumber(match[7]);

    // Parse size/quantity pairs from "1   XXL 1   L" format
    const sizePattern = /(\d+)\s+([A-Z0-9]{1,4})/gi;
    let sizeMatch;
    while ((sizeMatch = sizePattern.exec(sizesBlock)) !== null) {
      const qty = parseInt(sizeMatch[1]);
      const size = sizeMatch[2].toUpperCase();
      if (qty > 0 && ['XXS','XS','S','M','L','XL','XXL','XXXL','2XL','3XL','4XL'].includes(size)) {
        items.push({
          product_name: productName,
          sku: sku,
          color: color,
          size: size,
          quantity: qty,
          unit_price: unitPrice,
        });
      }
    }
  }

  // If the complex regex didn't work, try a simpler approach
  if (items.length === 0) {
    return tryParseTeamGraffSimple(rawText);
  }

  return items.length > 0 ? items : null;
}

// Simpler TeamGraff parser: find "Cantidad Talla" blocks and work backwards for product info
function tryParseTeamGraffSimple(rawText) {
  const items = [];
  
  // Split by "Cantidad Talla" to get product blocks
  const parts = rawText.split(/Cantidad\s+Talla/i);
  
  if (parts.length < 2) return null;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const beforeBlock = parts[i]; // Contains product info
    const afterBlock = parts[i + 1]; // Contains sizes, quantities, prices
    
    // Extract product name: look for the last numbered product line before "Cantidad Talla"
    // Pattern: number + PRODUCT NAME IN CAPS + 5-digit SKU + Color
    const productMatch = beforeBlock.match(/(\d+)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\/%.0-9]+?)\s+(\d{4,6})\s+([A-Za-záéíóúñÑ]+(?:\s+[A-Za-záéíóúñÑ]+)?)\s/);
    
    if (!productMatch) continue;
    
    const productName = productMatch[2].trim();
    const sku = productMatch[3];
    const color = productMatch[4].trim();
    
    // Extract sizes and quantities from after block
    // Pattern: pairs of "quantity size" like "1 XXL 1 L" followed by total, unit price, subtotal
    // Find the size/qty pairs before the price pattern "$ X.XXX"
    const priceStart = afterBlock.search(/\d+\s+\$\s*[\d.,]+/);
    const sizesText = priceStart > 0 ? afterBlock.substring(0, priceStart) : afterBlock.substring(0, 50);
    
    // Extract unit price
    const priceMatch = afterBlock.match(/\$\s*([\d.,]+)\s+\$\s*([\d.,]+)/);
    const unitPrice = priceMatch ? parseChileanNumber(priceMatch[1]) : 0;
    
    // Parse size-quantity pairs
    const sizeQtyPattern = /(\d+)\s+(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)\b/gi;
    let sizeMatch;
    let foundSizes = false;
    
    while ((sizeMatch = sizeQtyPattern.exec(sizesText)) !== null) {
      const qty = parseInt(sizeMatch[1]);
      const size = sizeMatch[2].toUpperCase();
      if (qty > 0 && qty < 1000) {
        items.push({
          product_name: productName,
          sku: sku,
          color: color,
          size: size,
          quantity: qty,
          unit_price: unitPrice,
        });
        foundSizes = true;
      }
    }
    
    // If no sizes found, add as single item with total quantity
    if (!foundSizes) {
      const totalQtyMatch = afterBlock.match(/^\s*(\d+)\s+\$/);
      items.push({
        product_name: productName,
        sku: sku,
        color: color,
        size: '',
        quantity: totalQtyMatch ? parseInt(totalQtyMatch[1]) : 1,
        unit_price: unitPrice,
      });
    }
  }
  
  return items.length > 0 ? items : null;
}

// Parse Chilean number format: "4.590" -> 4590, "31.200" -> 31200
function parseChileanNumber(str) {
  if (!str) return 0;
  const cleaned = str.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}


// ── Client Extraction ───────────────────────────────────────────────────────

function extractClient(lines, rawText) {
  // TeamGraff PDFs: find "Nombre :" entries and return the client one (not TeamGraff itself)
  const nombreMatches = [...rawText.matchAll(/Nombre\s*:\s*(.+?)(?=\s+Correo|\s+Rut|\s+Contacto|\s+Direccion)/gi)];
  for (const m of nombreMatches) {
    const name = m[1].trim().replace(/[-]+$/, '').trim();
    if (!/teamgraff|team\s*graff/i.test(name) && name.length > 2) {
      return name;
    }
  }

  // Generic patterns: "Cliente:", "Razón Social:", "Empresa:", etc.
  const clientPatterns = [
    /(?:cliente|razón\s*social|empresa|señor(?:es)?|para|destinatario)\s*[:]\s*(.+)/i,
    /(?:cotizaci[oó]n\s+(?:para|a))\s+(.+)/i,
  ];

  for (const line of lines) {
    for (const pattern of clientPatterns) {
      const match = line.match(pattern);
      if (match) {
        const name = match[1].trim().replace(/[.\-_]+$/, '').trim();
        if (name.length > 2) return name;
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
