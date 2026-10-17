import * as cheerio from 'cheerio';

/**
 * Lectores de las páginas de app-teamgraff.com (portados desde Control de Personalización).
 *
 * - parseOtHtml: detalle de la OT (Ordenini/imprimirPantalla.php). Es el mismo documento
 *   que hoy se imprime a PDF y se sube a mano, pero en tablas HTML.
 * - parseOtListHtml: listado o resultado de "Buscar N° OT" (Ordenini/indexOT.php).
 *   De cada fila solo se leen datos; ninguno de sus enlaces de acción se usa
 *   (varios eliminan registros o envían correos al abrirse).
 *
 * Nada se adivina: si el formato no calza se lanza OtFormatError.
 */

export class OtFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OtFormatError';
  }
}

const clean = (s) => String(s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const orNull = (s) => clean(s) || null;

/** Cloudflare oculta los correos: el primer byte es la clave XOR del resto. */
export function decodeCfEmail(hex) {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

/**
 * El sistema mezcla UTF-8 con texto Latin-1 (ej. "reposición" llega como un solo byte 0xF3).
 * Se decodifica como UTF-8 y cada byte inválido como Latin-1.
 */
export function decodeMixedEncoding(bytes) {
  const utf8 = new TextDecoder('utf-8');
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    const len = b < 0x80 ? 1 : (b & 0xe0) === 0xc0 ? 2 : (b & 0xf0) === 0xe0 ? 3 : (b & 0xf8) === 0xf0 ? 4 : 0;
    let valid = len > 0 && i + len <= bytes.length;
    for (let k = 1; valid && k < len; k++) valid = (bytes[i + k] & 0xc0) === 0x80;
    if (valid && len > 1) {
      out += utf8.decode(bytes.subarray(i, i + len));
      i += len;
    } else {
      out += String.fromCharCode(b);
      i += 1;
    }
  }
  return out;
}

/**
 * @returns {{ number: string, quoteNumber: string|null, issuedAt: string|null, contactName: string|null,
 *   clientRut: string|null, clientName: string|null, contactEmail: string|null, notes: string|null,
 *   lines: Array<{ lineNo: number, article: string, quantity: number, color: string|null, logoPosition: string|null,
 *     logoSize: string|null, note: string|null, declaredTotal: number|null, sizes: Array<{ size: string|null, qty: number }> }>,
 *   warnings: string[] }}
 */
export function parseOtHtml(html) {
  const $ = cheerio.load(html);

  // --- Cabecera ---
  const headerTable = $('table')
    .filter((_, t) => /Orden de Trabajo/i.test($(t).find('td').first().text()))
    .first();
  if (!headerTable.length) throw new OtFormatError('No se encontró la cabecera "Orden de Trabajo". ¿Es la página de detalle de una OT?');
  const cellAfter = (label) => {
    const td = headerTable.find('td').filter((_, el) => label.test(clean($(el).text()))).first();
    return td.length ? td.next('td') : null;
  };
  const headerText = clean(headerTable.text());

  const number = clean(cellAfter(/^N°\s*Orden de trabajo/i)?.text() ?? '');
  if (!/^\d+$/.test(number)) throw new OtFormatError('No se encontró el número de OT.');

  const emailCell = headerTable.find('td').filter((_, el) => /^correo/i.test(clean($(el).text()))).first();
  const cf = emailCell.find('[data-cfemail]').attr('data-cfemail');
  const contactEmail = cf ? decodeCfEmail(cf) : orNull(clean(emailCell.text()).replace(/^correo\s*/i, ''));

  const empresa = orNull(cellAfter(/^Empresa$/i)?.text() ?? '');
  const m = empresa ? /^([0-9][0-9.]*-?[0-9kK]?)\s+(.+)$/.exec(empresa) : null;

  // --- Prendas ---
  const itemsTable = $('table')
    .filter((_, t) => $(t).find('th').filter((__, th) => clean($(th).text()) === 'Nggo').length > 0)
    .first();
  if (!itemsTable.length) throw new OtFormatError('No se encontró la tabla de prendas.');

  const warnings = [];
  const lines = [];
  const rows = itemsTable.children('tbody').length ? itemsTable.children('tbody').children('tr') : itemsTable.children('tr');
  rows.each((_, row) => {
    const tds = $(row).children('td');
    if (tds.length >= 7 && /^\d+$/.test(clean(tds.eq(0).text()))) {
      lines.push(parseItemRow($, tds));
    } else if (tds.length === 1 && lines.length) {
      // Fila de indicación de personalización, bajo la prenda.
      const note = orNull(tds.eq(0).text());
      const last = lines[lines.length - 1];
      if (note) last.note = last.note ? `${last.note} ${note}` : note;
    }
  });
  if (!lines.length) throw new OtFormatError('La OT no tiene prendas.');

  for (const line of lines) {
    const sizeSum = line.sizes.reduce((a, s) => a + s.qty, 0);
    if (line.sizes.length === 0) {
      line.sizes = [{ size: null, qty: line.quantity }];
      warnings.push(`Línea ${line.lineNo} (${line.article}): no tiene tallas ingresadas; se cargó como ${line.quantity} unidades sin talla.`);
    } else if (sizeSum !== line.quantity) {
      warnings.push(`Línea ${line.lineNo} (${line.article}): la cantidad es ${line.quantity} pero las tallas suman ${sizeSum}.`);
    }
    if (line.declaredTotal !== null && line.sizes[0].size !== null && line.declaredTotal !== sizeSum) {
      warnings.push(`Línea ${line.lineNo} (${line.article}): "Total de Tallas Ingresadas" dice ${line.declaredTotal} pero las tallas suman ${sizeSum}.`);
    }
  }
  if (lines.some((l, i) => l.lineNo !== i + 1)) warnings.push('La numeración de líneas no es correlativa: revisar que no falten prendas.');

  return {
    number,
    quoteNumber: /N°\s*Cotizaci[oó]n\s*(\d+)/i.exec(headerText)?.[1] ?? null,
    issuedAt: /Fecha inicio OT\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(headerText)?.[1] ?? null,
    contactName: orNull(cellAfter(/^Atenci[oó]n$/i)?.text() ?? ''),
    clientRut: m ? m[1] : null,
    clientName: m ? m[2] : empresa,
    contactEmail,
    notes: orNull(cellAfter(/^Observaci[oó]n$/i)?.text() ?? ''),
    lines,
    warnings,
  };
}

function parseItemRow($, tds) {
  const text = (i) => orNull(tds.eq(i).text());
  const tallaCell = tds.eq(6);
  const sizes = [];
  tallaCell.find('tr').each((_, tr) => {
    const cells = $(tr).children('td');
    if (cells.length < 2) return;
    const qty = clean(cells.eq(0).text());
    if (!/^\d+$/.test(qty)) return;
    sizes.push({ qty: Number(qty), size: orNull(cells.eq(1).text()) });
  });
  const declared = /Ingresadas:\s*(\d+)/i.exec(tallaCell.text());
  const quantity = Number(clean(tds.eq(2).text()));
  return {
    lineNo: Number(clean(tds.eq(0).text())),
    article: clean(tds.eq(1).text()),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    color: text(3),
    logoPosition: text(4),
    logoSize: text(5),
    note: null,
    declaredTotal: declared ? Number(declared[1]) : null,
    sizes,
  };
}

/**
 * @returns {{ rows: Array<{ number: string, issuedAt: string|null, clientName: string|null, dueDate: string|null,
 *   status: string|null, detail: { cotizacion: string, editar2: string }|null }>,
 *   page: number|null, totalPages: number|null, totalRecords: number|null }}
 */
export function parseOtListHtml(html) {
  const $ = cheerio.load(html);
  const table = $('table')
    .filter((_, t) => $(t).find('th').filter((__, th) => clean($(th).text()) === 'OTrabajo').length > 0)
    .first();
  if (!table.length) throw new OtFormatError('No se encontró la tabla "Lista Orden de Trabajo".');

  const headers = table.find('thead th').map((_, th) => clean($(th).text())).get();
  const col = (name) => headers.findIndex((h) => h === name);
  const iOt = col('OTrabajo');
  const iClient = col('Cliente');
  const iDue = col('Fecha Termino');
  const iStatus = headers.lastIndexOf('Estado');
  const iActions = col('Acciones');
  if ([iOt, iClient, iDue, iStatus, iActions].some((i) => i < 0)) {
    throw new OtFormatError(`Formato del listado no reconocido (columnas: ${headers.join(', ')}).`);
  }

  const rows = [];
  table.find('tbody > tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length <= iStatus) return;
    const m = /^(\d+)\s*(\d{1,2}\/\d{1,2}\/\d{4})?/.exec(clean(tds.eq(iOt).text()));
    if (!m) return;
    const view = tds
      .eq(iActions)
      .find('a')
      .filter((__, a) => /Ver en pantalla/i.test($(a).attr('title') ?? ''))
      .attr('onclick');
    const params = view ? /imprimirPantalla\.php\?cotizacion=(\d+)&(?:amp;)?editar2=(\d+)/.exec(view) : null;
    rows.push({
      number: m[1],
      issuedAt: m[2] ?? null,
      clientName: clean(tds.eq(iClient).text()) || null,
      dueDate: /(\d{1,2}\/\d{1,2}\/\d{4})/.exec(clean(tds.eq(iDue).text()))?.[1] ?? null,
      status: clean(tds.eq(iStatus).text()) || null,
      detail: params ? { cotizacion: params[1], editar2: params[2] } : null,
    });
  });

  const nav = clean($('nav').text());
  return {
    rows,
    page: Number(/P.gina\s+(\d+)\s+de\s+\d+/i.exec(nav)?.[1]) || null,
    totalPages: Number(/P.gina\s+\d+\s+de\s+(\d+)/i.exec(nav)?.[1]) || null,
    totalRecords: Number(/de\s+(\d+)\s+registros/i.exec(nav)?.[1]) || null,
  };
}
