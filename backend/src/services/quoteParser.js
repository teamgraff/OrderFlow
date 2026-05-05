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
// Splits by "Cantidad Talla" markers, then extracts product info before each
// marker and size/qty/price data after it.

function tryParseTeamGraffQuote(rawText) {
  if (!rawText.includes('Cantidad Talla') && !rawText.includes('TENEMOS EL AGRADO')) {
    return null;
  }

  const items = [];
  const parts = rawText.split(/Cantidad\s+Talla/i);

  if (parts.length < 2) return null;

  // Known position keywords that appear between color and "Cantidad Talla"
  const positionKeywords = 'FRENTE|ESPALDA|PECHO|MANGA|CUELLO|SIN\\s*LOGO|BOLSILLO|SUPERIOR|INFERIOR|IZQUIERDO|DERECHO';

  // Known color names (Spanish)
  const colorNames = 'NEGRO|BLANCO|AZUL\\s*MARINO|AZUL|ROJO|VERDE|GRIS|NAVY|BEIGE|CELESTE|BURDEO|AMARILLO|NARANJO|AZULINO|CAFE|MORADO|ROSADO|CORAL|TURQUESA|FUCSIA|CRUDO|PIEDRA|KHAKI|VINO|CHOCOLATE|PLOMO';

  for (let i = 0; i < parts.length - 1; i++) {
    const beforeBlock = parts[i];
    const afterBlock = parts[i + 1];

    let productName = '';
    let sku = '';
    let color = '';

    // Try Pattern A: number + NAME + numeric SKU + Color + POSITION
    // "1 CAMISA OXFORD CLASSIC C/BOL. M/L HOMBRE 06212 Celeste FRENTE..."
    const patternA = new RegExp(
      '(?:^|.*\\s)(\\d+)\\s+([A-Z][A-Za-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00d1\\s/.%0-9]+?)\\s+(\\d{4,6})\\s+([A-Za-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00d1][A-Za-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00d1\\s]*)\\s+(?:' + positionKeywords + ')',
      'i'
    );
    const matchA = beforeBlock.match(patternA);

    // Try Pattern B: number + Name + COLOR_NAME + POSITION (no numeric SKU)
    // "2 Polera Cuello Pique Dryfresh Manga Larga Hombre AZUL MARINO FRENTE..."
    const patternB = new RegExp(
      '(?:^|.*\\s)(\\d+)\\s+([A-Za-z][A-Za-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00d1\\s/.%0-9-]+?)\\s+(' + colorNames + ')(?:\\s+(?:OSCURO|CLARO|MELANGE))?\\s+(?:' + positionKeywords + ')',
      'i'
    );
    const matchB = beforeBlock.match(patternB);

    if (matchA) {
      productName = matchA[2].trim();
      sku = matchA[3];
      color = matchA[4].trim();
    } else if (matchB) {
      productName = matchB[2].trim();
      sku = '';
      color = matchB[3].trim();
    } else {
      // Pattern C: very flexible - just find numbered entry before position text
      const patternC = new RegExp(
        '(?:^|.*\\s)(\\d+)\\s+(.{5,100}?)\\s+(?:' + positionKeywords + ')', 'i'
      );
      const matchC = beforeBlock.match(patternC);
      if (matchC) {
        productName = matchC[2].trim();
        // Try to extract color from end of product name
        const colorAtEnd = new RegExp('(.+?)\\s+(' + colorNames + ')(?:\\s+(?:OSCURO|CLARO|MELANGE))?\\s*$', 'i');
        const colorSplit = productName.match(colorAtEnd);
        if (colorSplit) {
          productName = colorSplit[1].trim();
          color = colorSplit[2].trim();
        }
        // Try to extract SKU from end of product name
        const skuAtEnd = productName.match(/^(.+?)\s+(\d{4,6})\s*$/);
        if (skuAtEnd) {
          productName = skuAtEnd[1].trim();
          sku = skuAtEnd[2];
        }
      } else {
        continue;
      }
    }

    // Clean product name: remove extra spaces, trailing junk
    productName = productName.replace(/\s+/g, ' ').replace(/[\s\-}]+$/, '').trim();
    if (!productName || productName.length < 3) continue;
    
    // Clean color: remove position keywords that may have leaked in
    color = color.replace(/\s*(FRENTE|ESPALDA|PECHO|MANGA|CUELLO|BOLSILLO|SUPERIOR|INFERIOR|IZQUIERDO|DERECHO)\s*/gi, ' ').trim();

    // ── Extract sizes, quantities and prices from afterBlock ──
    // Format: "  1   L 2   XL  3   $ 11.444   $ 34.332 LOGO BORDADO..."

    // Find price pattern: total_qty  $ unit_price  $ subtotal
    const priceMatch = afterBlock.match(/(\d+)\s+\$\s*([\d.,]+)\s+\$\s*([\d.,]+)/);
    const unitPrice = priceMatch ? parseChileanNumber(priceMatch[2]) : 0;

    // Get text before price (contains size/qty pairs)
    const pricePos = priceMatch ? afterBlock.indexOf(priceMatch[0]) : -1;
    const sizesText = pricePos > 0 ? afterBlock.substring(0, pricePos).trim() : '';

    // Parse "1   L 2   XL" pairs
    const validSizes = ['XXS','XS','S','M','L','XL','XXL','XXXL','2XL','3XL','4XL'];
    const sizeQtyPattern = /(\d+)\s+(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)\b/gi;
    let sizeMatch;
    let foundSizes = false;

    while ((sizeMatch = sizeQtyPattern.exec(sizesText)) !== null) {
      const qty = parseInt(sizeMatch[1]);
      const size = sizeMatch[2].toUpperCase();
      if (qty > 0 && qty < 1000 && validSizes.includes(size)) {
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

    // Fallback: use total quantity from price line
    if (!foundSizes && priceMatch) {
      items.push({
        product_name: productName,
        sku: sku,
        color: color,
        size: '',
        quantity: parseInt(priceMatch[1]) || 1,
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

  // Generic patterns: "Cliente:", "Razon Social:", "Empresa:", etc.
  const clientPatterns = [
    /(?:cliente|raz\u00f3n\s*social|empresa|se\u00f1or(?:es)?|para|destinatario)\s*[:]\s*(.+)/i,
    /(?:cotizaci[o\u00f3]n\s+(?:para|a))\s+(.+)/i,
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
    if (/^(sku|c[o\u00f3]digo|cod|ref|art[i\u00ed]culo|item)$/i.test(h)) map.sku = i;
    else if (/^(producto|descripci[o\u00f3]n|prenda|nombre|detalle|item)$/i.test(h)) map.product = i;
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
//   - Polera Piqu\u00e9 / SKU: TN-001 / Color: Negro / Tallas: S(5), M(10), L(8)
//   - 10 x Camisa Oxford Azul, talla M, SKU: CS-200

function tryParseStructuredList(lines) {
  const items = [];

  for (const line of lines) {
    // Skip headers and metadata lines
    if (/^(cliente|empresa|cotizaci|fecha|total|neto|iva|subtotal|rut|nota|observ)/i.test(line)) continue;

    // Pattern: has SKU-like code and quantity somewhere
    const skuMatch = line.match(/(?:sku|c[o\u00f3]d(?:igo)?|ref|art)\s*[:.]\s*([A-Z0-9][\w-]+)/i);
    const colorMatch = line.match(/(?:color)\s*[:.]\s*([A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00d1\s]+?)(?:\s*[/,|]|$)/i);
    const qtyMatch = line.match(/(?:cant(?:idad)?|qty|unid(?:ades)?)\s*[:.]\s*(\d+)/i)
      || line.match(/^[-\u2022*]\s*(\d+)\s*[xX\u00d7]\s*/);

    // Tallas pattern: S(5), M(10), L(8) or talla: M or tallas: S,M,L
    const tallasExpandedMatch = line.match(/(?:tallas?)\s*[:.]\s*((?:[A-Z0-9XS]+\s*\(\s*\d+\s*\)\s*[,;]?\s*)+)/i);
    const tallaSimpleMatch = line.match(/(?:talla|talle|size)\s*[:.]\s*([A-Z0-9XS]+)/i);

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
  // Remove common prefixes (-, *, \u2022, numbers)
  let cleaned = line.replace(/^[-\u2022*]\s*/, '').replace(/^\d+\s*[xX\u00d7]\s*/, '');
  // Take first segment before / or |
  cleaned = cleaned.split(/[/|]/)[0].trim();
  // Remove SKU references
  cleaned = cleaned.replace(/\b(?:sku|c[o\u00f3]d(?:igo)?|ref)\s*[:.]\s*[A-Z0-9][\w-]*/gi, '').trim();
  // Remove quantity refs
  cleaned = cleaned.replace(/\b(?:cant(?:idad)?|qty|unid(?:ades)?)\s*[:.]\s*\d+/gi, '').trim();
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
