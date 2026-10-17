import { query, queryOne, run, transaction, getDB, formatOf } from '../database.js';
import { createOrder, findByOt, insertItems, DuplicateOtError } from '../services/orderStore.js';
import { parseOtHtml } from './otParsers.js';
import { mapOtToOrder } from './mapOt.js';
import { TeamgraffClient } from './teamgraffClient.js';

/**
 * Sincronización Teamgraff -> Orderflow.
 *
 * Cómo detecta OT nuevas (el listado de Teamgraff se ordena por N° de COTIZACIÓN, no de OT,
 * así que una OT nueva de una cotización antigua puede quedar muchas páginas abajo):
 *  1. Los N° de OT son correlativos: se busca "última importada + 1, + 2, …" con el buscador
 *     "Buscar N° OT" hasta encontrar varios seguidos que aún no existen.
 *  2. Red de seguridad: se revisan las primeras páginas del listado.
 *  3. Si aparece la OT N+2 pero no la N+1, la N+1 queda en seguimiento ("hueco") por unos días.
 * Solo se consideran OT >= el N° de inicio: la historia anterior nunca se importa sola.
 *
 * Todo el estado vive en la base de datos (órdenes, sync_issues, sync_runs):
 * un reinicio o redespliegue no pierde nada y la siguiente ejecución continúa donde quedó.
 */

export const MAX_ATTEMPTS = 5;
const MAX_PROBE_MISSES = 3;
const MAX_PROBES_PER_RUN = 20;
const GAP_WATCH_DAYS = 3;
const UNFINISHED = ['pendiente', 'error'];

let lock = Promise.resolve();
/** Serializa todo lo que escribe desde la sincronización (ciclo automático, reintentos, reprocesos). */
function withLock(fn) {
  const next = lock.then(fn, fn);
  lock = next.catch(() => {});
  return next;
}

let sharedClient = null;
let clientFactory = () => new TeamgraffClient();
/** Solo para pruebas: reemplaza el cliente de Teamgraff. */
export function setClientFactory(factory) {
  clientFactory = factory;
  sharedClient = null;
}
function getClient() {
  // Se reutiliza entre ciclos para no iniciar sesión cada vez.
  if (!sharedClient) sharedClient = clientFactory();
  return sharedClient;
}

let running = false;
export const isRunning = () => running;

/** Primer N° de OT que la sincronización puede importar. Se fija la primera vez y no cambia. */
export function getStartOt() {
  const saved = queryOne(`SELECT value FROM counters WHERE name = 'sync_start_ot'`);
  if (saved) return saved.value;
  const fromEnv = Number(process.env.SYNC_START_OT);
  const start = Number.isInteger(fromEnv) && fromEnv > 0
    ? fromEnv
    : (queryOne(`SELECT MAX(CAST(teamgraff_ot AS INTEGER)) AS m FROM orders`)?.m ?? 0) + 1;
  run(`INSERT INTO counters (name, value) VALUES ('sync_start_ot', ?)`, [start]);
  return start;
}

/** Al arrancar: un ciclo que quedó "running" murió con el proceso anterior. */
export function markInterruptedRuns() {
  run(`UPDATE sync_runs SET status = 'interrupted', finished_at = CURRENT_TIMESTAMP WHERE status = 'running'`);
}

export function runSync(opts = {}) {
  return withLock(() => doRunSync(opts));
}

async function doRunSync({ listPages = 2 } = {}) {
  running = true;
  const runId = run(`INSERT INTO sync_runs (status) VALUES ('running')`).lastId;
  const log = [];
  const stats = { checked: 0, created: 0, failed: 0 };
  let status = 'ok';
  try {
    const client = getClient();
    const start = getStartOt();
    const known = new Set(query(`SELECT teamgraff_ot FROM orders WHERE CAST(teamgraff_ot AS INTEGER) >= ?`, [start]).map((r) => Number(r.teamgraff_ot)));
    const hi = Math.max(start - 1, ...known);

    /** N° de OT -> fila del listado/buscador (null si aún no se conoce) */
    const candidates = new Map();

    // 1. Reintentos pendientes y huecos en seguimiento.
    for (const issue of query(`SELECT teamgraff_ot FROM sync_issues WHERE status = 'open' AND attempts < ?`, [MAX_ATTEMPTS])) {
      candidates.set(Number(issue.teamgraff_ot), null);
    }

    // 2. Red de seguridad: primeras páginas del listado.
    for (let p = 1; p <= listPages; p++) {
      const { rows } = await client.listPage(p);
      for (const row of rows) {
        const n = Number(row.number);
        if (n >= start && !known.has(n)) candidates.set(n, row);
      }
    }

    // 3. Siguientes números correlativos.
    let misses = 0;
    let lastFound = hi;
    for (let n = hi + 1, probes = 0; misses < MAX_PROBE_MISSES && probes < MAX_PROBES_PER_RUN; n++, probes++) {
      let row = candidates.get(n);
      if (!row) {
        row = await client.findOt(n);
        stats.checked++;
        if (row) candidates.set(n, row);
      }
      if (row) { misses = 0; lastFound = n; } else { misses++; }
    }
    // Números saltados por debajo de la última OT encontrada: se procesan (quedan como hueco si no existen).
    for (let n = hi + 1; n < lastFound; n++) if (!candidates.has(n)) candidates.set(n, null);

    for (const [n, row] of [...candidates].sort((a, b) => a[0] - b[0])) {
      const result = await processOt(client, String(n), row);
      if (result.message) log.push(result.message);
      if (result.created) stats.created++;
      if (result.failed) stats.failed++;
    }
    if (stats.failed) status = 'with_errors';
  } catch (err) {
    status = 'failed';
    log.push(`Ciclo interrumpido: ${err.message}`);
    console.error('❌ [sync] Ciclo fallido:', err.message);
  } finally {
    run(`UPDATE sync_runs SET status = ?, finished_at = CURRENT_TIMESTAMP, checked = ?, created = ?, failed = ?, log = ? WHERE id = ?`,
      [status, stats.checked, stats.created, stats.failed, log.join('\n').slice(0, 8000) || null, runId]);
    running = false;
  }
  return { status, ...stats, log };
}

/**
 * Procesa una OT: la crea, o completa una orden que quedó "pendiente".
 * Si no se sabe aún si existe en Teamgraff, la busca primero (nunca se supone que existe).
 * Si existe pero su detalle no se puede leer, se registra igual la orden en estado "pendiente"
 * (aparece en el dashboard con su N° OF) y se reintenta en los siguientes ciclos.
 */
async function processOt(client, ot, row) {
  const existing = findByOt(ot);
  const existingStatus = existing && queryOne('SELECT processing_status FROM orders WHERE id = ?', [existing.id]).processing_status;
  if (existing && !UNFINISHED.includes(existingStatus)) {
    resolveIssues(ot, existing.id);
    return {};
  }
  try {
    if (!row) row = await client.findOt(ot);
    if (!row) {
      if (existing) throw new Error(`La OT ${ot} ya no aparece en Teamgraff.`);
      return trackGap(ot);
    }
    const data = await readOt(client, ot, row);
    if (existing) {
      refreshOrder(existing.id, data);
      resolveIssues(ot, existing.id);
      return { created: false, message: `OT ${ot}: completada (${formatOf(existing.of_number)}).` };
    }
    const order = createOrder(data);
    resolveIssues(ot, order.id);
    return { created: true, message: `OT ${ot} importada como ${formatOf(order.of_number)}${data.processing_status === 'incompleta' ? ' (incompleta, requiere revisión)' : ''}.` };
  } catch (err) {
    if (err instanceof DuplicateOtError) { resolveIssues(ot); return { message: `OT ${ot}: ya existía.` }; }
    return recordFailure(ot, row, err);
  }
}

/** Descarga y lee el detalle de una OT ya verificada en el listado. */
async function readOt(client, ot, row) {
  if (!row.detail) throw new Error('El listado no trae el enlace al detalle de la OT.');
  const parsed = parseOtHtml(await client.detailHtml(row.detail));
  if (parsed.number !== ot) throw new Error(`El detalle abierto corresponde a la OT ${parsed.number}, no a la ${ot}.`);
  return mapOtToOrder(parsed, row);
}

/**
 * Reemplaza en una orden existente SOLO lo que viene de Teamgraff (empresa, contacto, prendas,
 * estado de procesamiento). No toca valor neto, fecha de pago, proveedor, estado ni recepción;
 * la técnica solo se completa si estaba vacía.
 */
function refreshOrder(orderId, data) {
  transaction(() => {
    getDB().run(
      `UPDATE orders SET client_name = ?, client_rut = ?, contact_name = ?, contact_email = ?, teamgraff_quote = ?,
         quote_date = COALESCE(?, quote_date), logo_technique = COALESCE(logo_technique, ?), notes = COALESCE(notes, ?),
         processing_status = ?, review_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [data.client_name, data.client_rut, data.contact_name, data.contact_email, data.teamgraff_quote,
        data.quote_date, data.logo_technique, data.notes, data.processing_status, data.review_notes, orderId]
    );
    getDB().run('DELETE FROM order_items WHERE order_id = ?', [orderId]);
    insertItems(orderId, data.items);
  });
}

function recordFailure(ot, row, err) {
  const issue = openIssue(ot, 'error');
  const attempts = (issue?.attempts ?? 0) + 1;
  const finalFailure = attempts >= MAX_ATTEMPTS;
  const message = `${err.message}${finalFailure ? ' Se agotaron los reintentos automáticos: usar "Reprocesar".' : ''}`;

  transaction(() => {
    let orderId = findByOt(ot)?.id ?? null;
    if (!orderId && row) {
      // La OT existe en Teamgraff (se vio en el listado): se registra ya, para que se vea y no se pierda.
      orderId = createOrder({
        custom_ot: ot,
        client_name: row.clientName || `OT ${ot}`,
        logo_technique: null,
        source: 'sync',
        processing_status: 'pendiente',
      }).id;
    }
    if (orderId) {
      getDB().run(`UPDATE orders SET processing_status = ?, review_notes = ? WHERE id = ? AND processing_status IN ('pendiente','error')`,
        [finalFailure ? 'error' : 'pendiente', message, orderId]);
    }
    if (issue) {
      getDB().run(`UPDATE sync_issues SET attempts = ?, message = ?, order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [attempts, message, orderId, issue.id]);
    } else {
      getDB().run(`INSERT INTO sync_issues (teamgraff_ot, kind, message, attempts, order_id, detail_ref) VALUES (?, 'error', ?, ?, ?, ?)`,
        [ot, message, attempts, orderId, row?.detail ? JSON.stringify(row.detail) : null]);
    }
  });
  console.error(`⚠️ [sync] OT ${ot}: ${err.message}`);
  return { failed: true, message: `OT ${ot}: error (intento ${attempts}/${MAX_ATTEMPTS}): ${err.message}` };
}

/** Un número saltado que todavía no aparece en Teamgraff: se vigila unos días y luego se cierra. */
function trackGap(ot) {
  const issue = openIssue(ot, 'gap');
  if (!issue) {
    run(`INSERT INTO sync_issues (teamgraff_ot, kind, message, attempts) VALUES (?, 'gap', ?, 0)`,
      [ot, `La OT ${ot} no aparece en Teamgraff, pero sí OT posteriores. Se seguirá buscando ${GAP_WATCH_DAYS} días.`]);
    return { message: `OT ${ot}: aún no existe en Teamgraff (hueco en seguimiento).` };
  }
  const ageDays = (Date.now() - Date.parse(issue.created_at.replace(' ', 'T') + 'Z')) / 86400000;
  if (ageDays > GAP_WATCH_DAYS) {
    run(`UPDATE sync_issues SET status = 'closed', message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [`La OT ${ot} nunca apareció en Teamgraff (probablemente anulada o eliminada).`, issue.id]);
    return { message: `OT ${ot}: se deja de buscar (no existe en Teamgraff).` };
  }
  return {};
}

function openIssue(ot, kind) {
  return queryOne(`SELECT * FROM sync_issues WHERE teamgraff_ot = ? AND kind = ? AND status = 'open' ORDER BY id DESC`, [ot, kind]);
}

function resolveIssues(ot, orderId = null) {
  run(`UPDATE sync_issues SET status = 'resolved', order_id = COALESCE(?, order_id), updated_at = CURRENT_TIMESTAMP WHERE teamgraff_ot = ? AND status = 'open'`, [orderId, ot]);
}

/** Botón "Reprocesar" de una orden importada: vuelve a leer la OT desde Teamgraff. */
export function reprocessOrder(orderId) {
  return withLock(async () => {
    const order = queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) throw Object.assign(new Error('Orden no encontrada'), { status: 404 });
    if (!order.teamgraff_ot) throw Object.assign(new Error('La orden no tiene N° de OT de Teamgraff vinculado.'), { status: 400 });
    const ot = order.teamgraff_ot;
    const client = getClient();
    try {
      const row = await client.findOt(ot);
      if (!row) throw new Error(`La OT ${ot} no aparece en Teamgraff.`);
      refreshOrder(orderId, await readOt(client, ot, row));
      resolveIssues(ot, orderId);
      return queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
    } catch (err) {
      run(`UPDATE orders SET review_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND processing_status IN ('pendiente','error')`,
        [`Reproceso fallido: ${err.message}`, orderId]);
      throw Object.assign(err, { status: err.status ?? 502 });
    }
  });
}

/** Botón "Reintentar" de una incidencia: rehabilita los reintentos y procesa esa OT ahora. */
export function retryIssue(issueId) {
  return withLock(async () => {
    const issue = queryOne('SELECT * FROM sync_issues WHERE id = ?', [issueId]);
    if (!issue) throw Object.assign(new Error('Incidencia no encontrada'), { status: 404 });
    run(`UPDATE sync_issues SET status = 'open', attempts = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [issueId]);
    return processOt(getClient(), issue.teamgraff_ot, null);
  });
}

export function syncOverview() {
  return {
    running,
    startOt: queryOne(`SELECT value FROM counters WHERE name = 'sync_start_ot'`)?.value ?? null,
    lastOt: queryOne(`SELECT MAX(CAST(teamgraff_ot AS INTEGER)) AS m FROM orders`)?.m ?? null,
    runs: query(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 30`),
    issues: query(`SELECT i.*, o.of_number FROM sync_issues i LEFT JOIN orders o ON o.id = i.order_id
                   WHERE i.status = 'open' OR i.updated_at >= datetime('now','-7 days')
                   ORDER BY i.status = 'open' DESC, i.id DESC LIMIT 100`),
  };
}
