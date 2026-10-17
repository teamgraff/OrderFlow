import { syncConfigured } from './teamgraffClient.js';
import { markInterruptedRuns, runSync } from './syncRun.js';

/**
 * Ejecuta la sincronización en segundo plano dentro del mismo proceso del servidor,
 * aunque nadie tenga Orderflow abierto.
 *
 * Variables: SYNC_ENABLED=true para activarla, SYNC_INTERVAL_MINUTES (por defecto 3).
 * Debe correr UNA sola instancia del servidor (sql.js guarda la base en un archivo).
 */
let started = false;

export function syncEnabled() {
  return process.env.SYNC_ENABLED === 'true' && syncConfigured();
}

export function startSyncScheduler() {
  if (started) return;
  started = true;
  markInterruptedRuns();

  if (process.env.SYNC_ENABLED !== 'true') {
    console.log('⏸️  Sincronización con Teamgraff desactivada (SYNC_ENABLED != true).');
    return;
  }
  if (!syncConfigured()) {
    console.warn('⚠️  SYNC_ENABLED=true pero faltan TEAMGRAFF_USER / TEAMGRAFF_PASSWORD: la sincronización no se inicia.');
    return;
  }

  const minutes = Math.max(1, Number(process.env.SYNC_INTERVAL_MINUTES) || 3);
  const tick = () => {
    runSync()
      .then((r) => { if (r.created || r.failed || r.status === 'failed') console.log(`🔄 [sync] ${r.status}: ${r.created} creadas, ${r.failed} con error`); })
      .catch((err) => console.error('❌ [sync]', err.message));
  };
  // Primera ejecución a los 30 s del arranque; luego cada N minutos.
  setTimeout(tick, 30_000).unref();
  setInterval(tick, minutes * 60_000).unref();
  console.log(`🔄 Sincronización con Teamgraff activa cada ${minutes} min.`);
}
