import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDataDir, fakeTeamgraff } from './helpers.js';

const dataDir = useTempDataDir();
process.env.SYNC_START_OT = '3711';

const db = await import('../src/database.js');
const { createOrder, DuplicateOtError } = await import('../src/services/orderStore.js');
const sync = await import('../src/sync/syncRun.js');

let tg;
async function freshDb() {
  for (const f of fs.readdirSync(dataDir)) fs.rmSync(path.join(dataDir, f), { recursive: true, force: true });
  await db.initDB({ seed: false });
  tg = fakeTeamgraff();
  sync.setClientFactory(() => tg.client);
}
const orders = () => db.query('SELECT * FROM orders ORDER BY of_number');
const items = (orderId) => db.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [orderId]);
const byOt = (ot) => db.queryOne('SELECT * FROM orders WHERE teamgraff_ot = ?', [String(ot)]);

beforeEach(freshDb);

test('1. OT nueva: se crea con N° OF, datos de la empresa y una fila por talla', async () => {
  tg.add(3711, { client: 'EMPRESA UNO SPA.' });
  const r = await sync.runSync();
  assert.equal(r.status, 'ok');
  assert.equal(r.created, 1);
  const o = byOt(3711);
  assert.equal(db.formatOf(o.of_number), 'OF-0001');
  assert.equal(o.custom_ot, '3711');
  assert.equal(o.client_name, 'EMPRESA UNO SPA.');
  assert.equal(o.client_rut, '76.000.711-5');
  assert.equal(o.contact_name, 'Contacto Demo');
  assert.equal(o.quote_date, '2026-10-16');
  assert.equal(o.source, 'sync');
  assert.equal(o.processing_status, 'ok');
  assert.equal(o.logo_technique, 'BORDADO');
  const it = items(o.id);
  assert.deepEqual(it.map((i) => [i.product_name, i.color, i.size, i.quantity]), [['Polera Pique', 'Azul', 'M', 6], ['Polera Pique', 'Azul', 'L', 4]]);
  assert.equal(it[0].logo_position, 'Frente izquierdo');
  assert.equal(it[0].notes, 'bordado: logo cliente');
});

test('2. OT ya importada: no se duplica ni consume N° OF', async () => {
  tg.add(3711);
  await sync.runSync();
  const r = await sync.runSync();
  assert.equal(r.created, 0);
  assert.equal(orders().length, 1);
  assert.equal(items(byOt(3711).id).length, 2);
  assert.equal(db.queryOne(`SELECT value FROM counters WHERE name='of_number'`).value, 1);
});

test('3. Varias OT nuevas en un ciclo: N° OF correlativos en orden de OT', async () => {
  tg.add(3713); tg.add(3711); tg.add(3712);
  const r = await sync.runSync();
  assert.equal(r.created, 3);
  assert.deepEqual(orders().map((o) => [o.teamgraff_ot, o.of_number]), [['3711', 1], ['3712', 2], ['3713', 3]]);
});

test('3b. OT de una cotización antigua (fuera de las primeras páginas) se detecta por número', async () => {
  for (let i = 0; i < 25; i++) tg.add(3000 + i, { cot: 30000 + i }); // OT antiguas, cotizaciones recientes: llenan el listado
  tg.add(3711, { cot: 100 }); // cotización muy antigua: queda al final del listado
  await sync.runSync();
  assert.ok(byOt(3711));
  assert.equal(orders().length, 1, 'no importa OT anteriores al N° de inicio');
});

test('4. OT con información incompleta: se importa marcada para revisión, sin inventar tallas', async () => {
  tg.add(3711, { lines: [{ article: 'Gorro Gabardina 5P', qty: 20, color: 'AZUL MARINO', pos: 'Al frente', sizes: [] }] });
  await sync.runSync();
  const o = byOt(3711);
  assert.equal(o.processing_status, 'incompleta');
  assert.match(o.review_notes, /no tiene tallas/);
  assert.match(o.review_notes, /técnica/);
  assert.equal(o.logo_technique, null);
  const [it] = items(o.id);
  assert.equal(it.size, '');
  assert.equal(it.quantity, 20);
});

test('5. Error al descargar: queda "pendiente" con su N° OF y se completa en el siguiente ciclo', async () => {
  tg.add(3711, { failDetail: 1 });
  const r1 = await sync.runSync();
  assert.equal(r1.failed, 1);
  let o = byOt(3711);
  assert.equal(o.processing_status, 'pendiente');
  assert.equal(o.of_number, 1);
  assert.equal(items(o.id).length, 0);
  const r2 = await sync.runSync();
  assert.equal(r2.failed, 0);
  o = byOt(3711);
  assert.equal(o.processing_status, 'ok');
  assert.equal(o.of_number, 1, 'conserva el mismo N° OF');
  assert.equal(items(o.id).length, 2);
  assert.equal(orders().length, 1);
  assert.equal(db.queryOne(`SELECT COUNT(*) AS n FROM sync_issues WHERE status='open'`).n, 0);
});

test('6. Error al procesar: tras 5 intentos queda "error" y "Reprocesar" lo corrige', async () => {
  const ot = tg.add(3711);
  ot.html = '<html><body>Página con otro formato</body></html>';
  for (let i = 0; i < sync.MAX_ATTEMPTS; i++) await sync.runSync();
  let o = byOt(3711);
  assert.equal(o.processing_status, 'error');
  assert.match(o.review_notes, /Reprocesar/);
  const before = tg.calls.detail;
  await sync.runSync();
  assert.equal(tg.calls.detail, before, 'agotados los intentos, ya no se reintenta solo');

  tg.add(3711); // la página vuelve a estar bien
  await sync.reprocessOrder(o.id);
  o = byOt(3711);
  assert.equal(o.processing_status, 'ok');
  assert.equal(items(o.id).length, 2);
  assert.equal(orders().length, 1);
});

test('7 y 8. Reinicio del servidor: el estado persiste y la sincronización continúa sin duplicar', async () => {
  tg.add(3711); tg.add(3712, { failDetail: 1 });
  await sync.runSync();
  db.run(`INSERT INTO sync_runs (status) VALUES ('running')`); // ciclo cortado por el reinicio

  await db.initDB({ seed: false }); // "reinicio": se vuelve a leer la base desde el archivo
  sync.markInterruptedRuns();
  assert.equal(db.queryOne(`SELECT COUNT(*) AS n FROM sync_runs WHERE status='running'`).n, 0);
  assert.equal(orders().length, 2);

  tg.add(3713);
  const r = await sync.runSync();
  assert.equal(r.status, 'ok');
  assert.deepEqual(orders().map((o) => [o.teamgraff_ot, o.of_number, o.processing_status]),
    [['3711', 1, 'ok'], ['3712', 2, 'ok'], ['3713', 3, 'ok']]);
});

test('9. Dos sincronizaciones al mismo tiempo: sin duplicados ni N° repetidos', async () => {
  tg.add(3711); tg.add(3712);
  await Promise.all([sync.runSync(), sync.runSync(), sync.runSync()]);
  const os = orders();
  assert.equal(os.length, 2);
  assert.deepEqual(os.map((o) => o.of_number), [1, 2]);
});

test('10. Carga manual mientras corre la sincronización', async () => {
  tg.add(3711); tg.add(3712);
  // La persona carga a mano la 3712 mientras corre un ciclo.
  const cycle = sync.runSync();
  const manual = createOrder({ custom_ot: '3712', client_name: 'Cargada a mano', items: [{ product_name: 'X', quantity: 1 }] });
  await cycle;
  assert.equal(manual.source, 'manual');
  assert.equal(orders().length, 2);
  assert.equal(byOt(3712).client_name, 'Cargada a mano', 'la sincronización no la pisa ni la duplica');
  assert.deepEqual(orders().map((o) => o.of_number).sort(), [1, 2]);
  // Y una carga manual de una OT ya importada se rechaza sin consumir N° OF.
  assert.throws(() => createOrder({ custom_ot: '3711', client_name: 'Repetida' }), DuplicateOtError);
  assert.equal(db.queryOne(`SELECT value FROM counters WHERE name='of_number'`).value, 2);
  // Una carga manual sin N° de OT sigue funcionando.
  assert.equal(createOrder({ client_name: 'Sin OT' }).of_number, 3);
});

test('Hueco: si aparece la OT N+2 antes que la N+1, la N+1 queda en seguimiento y se importa cuando aparece', async () => {
  tg.add(3712);
  await sync.runSync();
  assert.ok(byOt(3712));
  assert.equal(db.queryOne(`SELECT kind, status FROM sync_issues WHERE teamgraff_ot='3711'`).kind, 'gap');
  tg.add(3711);
  await sync.runSync();
  assert.ok(byOt(3711));
  assert.equal(db.queryOne(`SELECT status FROM sync_issues WHERE teamgraff_ot='3711'`).status, 'resolved');
});

test('Si Teamgraff no responde, el ciclo queda "failed" y no se crea nada', async () => {
  tg.add(3711);
  tg.client.listPage = async () => { throw new Error('fetch failed'); };
  const r = await sync.runSync();
  assert.equal(r.status, 'failed');
  assert.equal(orders().length, 0);
  assert.equal(db.queryOne('SELECT status FROM sync_runs ORDER BY id DESC').status, 'failed');
});

test('Valor neto: se toma el "Total Neto" de la cotización', async () => {
  tg.add(3711);
  await sync.runSync();
  const o = byOt(3711);
  assert.equal(o.net_value, 103711);
  assert.equal(o.teamgraff_quote, String(tg.ots.get('3711').ed));
});

test('Valor neto: sin "Total Neto", cotización equivocada o caída -> la OT se importa igual con neto vacío', async () => {
  tg.add(3711, { net: null });
  tg.add(3712, { quoteShown: '1' });
  tg.add(3713, { failQuote: true });
  const r = await sync.runSync();
  assert.equal(r.created, 3);
  assert.equal(r.failed, 0);
  for (const ot of [3711, 3712, 3713]) {
    assert.equal(byOt(ot).net_value, 0);
    assert.equal(byOt(ot).processing_status, 'ok', 'el neto no marca la orden como incompleta');
  }
  assert.match(r.log.join('\n'), /no muestra "Total Neto"/);
  assert.match(r.log.join('\n'), /no es la/);
  assert.match(r.log.join('\n'), /no se pudo leer la cotización/);
});

test('Valor neto: "Reprocesar" lo completa si está vacío y nunca pisa uno ingresado a mano', async () => {
  tg.add(3711, { failQuote: true }); tg.add(3712);
  await sync.runSync();
  db.run('UPDATE orders SET net_value = 555 WHERE teamgraff_ot = ?', ['3712']);
  tg.ots.get('3711').failQuote = false;
  await sync.reprocessOrder(byOt(3711).id);
  await sync.reprocessOrder(byOt(3712).id);
  assert.equal(byOt(3711).net_value, 103711);
  assert.equal(byOt(3712).net_value, 555);
});

test('Valor neto: relleno único de órdenes existentes con neto vacío (sin pisar las que tienen valor)', async () => {
  tg.add(3500); tg.add(3501); tg.add(3502, { net: 0 });
  createOrder({ custom_ot: '3500', client_name: 'Manual sin neto' });
  createOrder({ custom_ot: '3501', client_name: 'Manual con neto', net_value: 777 });
  createOrder({ custom_ot: '3502', client_name: 'Cotización sin neto' });
  const r = await sync.runSync();
  assert.equal(byOt(3500).net_value, 103500);
  assert.equal(byOt(3500).teamgraff_quote, String(tg.ots.get('3500').ed));
  assert.equal(byOt(3501).net_value, 777);
  assert.equal(byOt(3502).net_value, 0);
  assert.match(r.log.join('\n'), /en 1 de 2 órdenes/);
  assert.match(r.log.join('\n'), /está en \$0/);
  // Solo una vez.
  const before = tg.calls.quote;
  await sync.runSync();
  assert.equal(tg.calls.quote, before);
});
