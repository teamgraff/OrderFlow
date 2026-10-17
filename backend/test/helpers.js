// Utilidades de prueba: HTML FICTICIO con la misma estructura que app-teamgraff.com
// (sin datos de clientes reales) y un Teamgraff simulado en memoria.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function useTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orderflow-test-'));
  process.env.DATA_PATH = dir;
  return dir;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Página de detalle (imprimirPantalla.php) con la estructura real: tablas anidadas por talla, filas de nota. */
export function detailHtml({ number, quote = '9000', empresa = '76.123.456-7 EMPRESA DEMO SPA.', atencion = 'Contacto Demo', correo = 'demo@example.com', fecha = '16/10/2026', lines }) {
  const sizeTable = (sizes, articuloBase) => `<!DOCTYPE html><html><body>
    <table align="center"><tr><th>Cantidad</th><th>Talla</th></tr>
    ${sizes.length ? sizes.map(([q, t], i) => `<tr><td>${q}</td><td>${esc(t)}</td><td>
      <a title="Eliminar Items" href="#" onclick="window.open('cuadernoEliminarTalla.php?articulo=${articuloBase + i}&amp;editar2=${quote}')">x</a></td></tr>`).join('')
      + `Total de Tallas Ingresadas: ${sizes.reduce((a, [q]) => a + q, 0)}` : '<tr><td colspan="2">No hay datos.</td></tr>'}
    </table></body></html>`;
  const rows = lines.map((l, i) => `
    <tr><td>${i + 1}</td><td>${esc(l.article)}</td><td>${l.qty}</td><td>${esc(l.color)}</td><td>${esc(l.pos)}</td><td>${esc(l.size ?? '')}</td>
      <td>${sizeTable(l.sizes ?? [], 50000 + i * 10)}</td></tr>
    ${l.note ? `<tr><td colspan="4">${esc(l.note)}</td></tr>` : ''}`).join('');
  return `<html><body>
  <table width="690" border="1">
    <tr><td colspan="3"><div align="center">Orden de Trabajo</div></td></tr>
    <tr><td>N&deg; Orden de trabajo </td><td>${number}      <p>&nbsp;</p></td><td>N&deg;Cotizacion ${quote}</td></tr>
    <tr><td>Atencion</td><td>${esc(atencion)}</td><td>Fecha inicio OT : ${fecha}</td></tr>
    <tr><td>Empresa</td><td>${esc(empresa)}</td><td>correo ${esc(correo)}</td></tr>
    <tr><td>Observacion</td><td></td><td></td></tr>
  </table>
  <table class="table" border="1">
    <tr><th>Nggo</th><th>Articulo</th><th>Cantidad</th><th>Color</th><th>Posicion de logo</th><th>Tamaño Logo</th><th>Talla</th></tr>
    ${rows}
  </table></body></html>`;
}

/** Listado / resultado de búsqueda (indexOT.php) con las columnas reales. */
export function listHtml(rows, { page = 1, totalPages = 1 } = {}) {
  const tr = rows.map((r) => `<tr><td></td><td></td><td></td><td></td><td>x</td><td></td><td></td>
    <td>${r.number} ${r.fecha ?? '16/10/2026'}</td><td>${esc(r.client)}</td><td></td>
    <td><a title="Eliminar Registro del listado Pasivo" href="#" onClick="window.open('cuadernoEot.php?check=1')">x</a>
        <a title="Ver en pantalla" href="#" onclick="window.open('imprimirPantalla.php?cotizacion=${r.cot}&amp;editar2=${r.ed}','miwin')">v</a></td>
    <td>Termino: 20/10/2026</td><td></td><td>Sin asignar</td></tr>`).join('');
  return `<html><body><table><thead><tr><th>Factura</th><th>Prioridad</th><th>Listado</th><th>Compra</th><th>Estados</th>
    <th>Estado Anterior</th><th>Cambio Estado</th><th>OTrabajo</th><th>Cliente</th><th>Observacion</th><th>Acciones</th>
    <th>Fecha Termino</th><th>Plazo y Dias</th><th>Estado</th></tr></thead><tbody>${tr}</tbody></table>
    <nav>Página ${page} de ${totalPages} de ${rows.length} registros</nav></body></html>`;
}

/**
 * Teamgraff simulado. ots: Map N° -> { client, cot, ed, html, failDetail?: number (veces que falla) }.
 * El listado se ordena por cotización descendente, como el real.
 */
export function fakeTeamgraff() {
  const ots = new Map();
  const calls = { list: 0, find: 0, detail: 0 };
  const listRows = () => [...ots.entries()]
    .map(([number, o]) => ({ number, ...o }))
    .sort((a, b) => b.cot - a.cot);
  const client = {
    async listPage(p) {
      calls.list++;
      const { parseOtListHtml } = await import('../src/sync/otParsers.js');
      return parseOtListHtml(listHtml(listRows().slice((p - 1) * 10, p * 10)));
    },
    async findOt(n) {
      calls.find++;
      const { parseOtListHtml } = await import('../src/sync/otParsers.js');
      const rows = listRows().filter((r) => r.number === String(n));
      return parseOtListHtml(listHtml(rows)).rows[0] ?? null;
    },
    async detailHtml(ref) {
      calls.detail++;
      const o = [...ots.values()].find((x) => String(x.cot) === ref.cotizacion && String(x.ed) === ref.editar2);
      if (!o) throw new Error('404');
      if (o.failDetail > 0) { o.failDetail--; throw new Error('app-teamgraff.com respondió 500 en /Ordenini/imprimirPantalla.php'); }
      return o.html;
    },
  };
  let nextCot = 20000;
  const add = (number, { client: c = `Cliente ${number}`, lines, cot, ...rest } = {}) => {
    const n = String(number);
    const q = cot ?? nextCot++;
    ots.set(n, {
      client: c, cot: q, ed: q + 100,
      html: detailHtml({ number: n, quote: String(q + 100), empresa: `76.000.${String(number).padStart(3, '0').slice(-3)}-5 ${c}`, lines: lines ?? [{ article: 'Polera Pique', qty: 10, color: 'Azul', pos: 'Frente izquierdo', sizes: [[6, 'M'], [4, 'L']], note: 'bordado: logo cliente' }] }),
      ...rest,
    });
    return ots.get(n);
  };
  return { ots, calls, client, add };
}
