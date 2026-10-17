import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, RotateCcw, CheckCircle, AlertTriangle, PauseCircle } from 'lucide-react';
import { api } from '../api/client';
import { formatOf, formatDateTime } from '../components/orderMeta';

const RUN_STATUS = {
  ok: { label: 'OK', class: 'badge-green' },
  with_errors: { label: 'Con errores', class: 'badge-yellow' },
  failed: { label: 'Falló', class: 'badge-red' },
  running: { label: 'En curso', class: 'badge-gray' },
  interrupted: { label: 'Interrumpido', class: 'badge-gray' },
};

const ISSUE_KIND = {
  error: 'Error de lectura',
  gap: 'N° saltado',
};

export default function Sync() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000); };

  const load = useCallback(() => api.getSync().then(setData).catch(err => showToast(err.message, 'error')), []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const handleRun = async () => {
    setBusy(true);
    try {
      const r = await api.runSync();
      showToast(r.started ? 'Sincronización iniciada' : r.message, 'info');
      setTimeout(load, 3000);
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  };

  const handleRetry = async (issue) => {
    setBusy(true);
    try {
      const r = await api.retrySyncIssue(issue.id);
      showToast(r.message || 'Reintento realizado', r.failed ? 'error' : 'success');
      load();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  };

  if (!data) return <div className="empty-state"><p>Cargando...</p></div>;

  const lastRun = data.runs[0];
  const openIssues = data.issues.filter(i => i.status === 'open');

  return (
    <div className="animate-fade-up">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Sincronización con Teamgraff</h2>
          <p>Las OT nuevas de app-teamgraff.com se importan automáticamente a Orderflow</p>
        </div>
        <button className="btn btn-primary" onClick={handleRun} disabled={busy || data.running || !data.configured}>
          <RefreshCw size={16} /> {data.running ? 'Sincronizando…' : 'Sincronizar ahora'}
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className={`stat-icon ${data.enabled ? 'green' : 'yellow'}`}>{data.enabled ? <CheckCircle size={24} /> : <PauseCircle size={24} />}</div>
          <div>
            <div className="stat-value" style={{ fontSize: '1.1rem' }}>{data.enabled ? 'Activa' : data.configured ? 'Desactivada' : 'Sin configurar'}</div>
            <div className="stat-label">Sincronización automática</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><RefreshCw size={24} /></div>
          <div>
            <div className="stat-value" style={{ fontSize: '1.1rem' }}>{lastRun ? formatDateTime(lastRun.finished_at || lastRun.started_at) : '—'}</div>
            <div className="stat-label">Última revisión {lastRun && <span className={`badge ${(RUN_STATUS[lastRun.status] || RUN_STATUS.running).class}`}>{(RUN_STATUS[lastRun.status] || RUN_STATUS.running).label}</span>}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><CheckCircle size={24} /></div>
          <div>
            <div className="stat-value">{data.lastOt ?? '—'}</div>
            <div className="stat-label">Última OT en Orderflow {data.startOt && `(importa desde la ${data.startOt})`}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className={`stat-icon ${openIssues.length ? 'red' : 'green'}`}><AlertTriangle size={24} /></div>
          <div>
            <div className="stat-value">{openIssues.length}</div>
            <div className="stat-label">Incidencias abiertas</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 className="card-title" style={{ marginBottom: '1rem' }}>Incidencias</h3>
        {data.issues.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>Sin incidencias en los últimos 7 días.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>N° OT</th><th>Orden</th><th>Tipo</th><th>Detalle</th><th>Intentos</th><th>Actualizado</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {data.issues.map(issue => (
                  <tr key={issue.id}>
                    <td><strong>{issue.teamgraff_ot}</strong></td>
                    <td>{issue.order_id ? <a href="#" onClick={e => { e.preventDefault(); navigate(`/orders/${issue.order_id}`); }}>{formatOf(issue.of_number)}</a> : '—'}</td>
                    <td>{ISSUE_KIND[issue.kind] || issue.kind}</td>
                    <td style={{ maxWidth: 420, whiteSpace: 'normal' }}>{issue.message}</td>
                    <td>{issue.attempts}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(issue.updated_at)}</td>
                    <td>{issue.status === 'open' ? <span className="badge badge-yellow">Abierta</span> : issue.status === 'resolved' ? <span className="badge badge-green">Resuelta</span> : <span className="badge badge-gray">Cerrada</span>}</td>
                    <td>
                      {issue.status !== 'resolved' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => handleRetry(issue)} disabled={busy || !data.configured}>
                          <RotateCcw size={14} /> Reintentar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="card-title" style={{ marginBottom: '1rem' }}>Historial de revisiones</h3>
        {data.runs.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>Todavía no se ha ejecutado ninguna sincronización.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Inicio</th><th>Estado</th><th>Búsquedas</th><th>OT nuevas</th><th>Con error</th><th>Detalle</th></tr></thead>
              <tbody>
                {data.runs.map(run => {
                  const st = RUN_STATUS[run.status] || RUN_STATUS.running;
                  return (
                    <tr key={run.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(run.started_at)}</td>
                      <td><span className={`badge ${st.class}`}>{st.label}</span></td>
                      <td>{run.checked}</td>
                      <td>{run.created}</td>
                      <td>{run.failed}</td>
                      <td style={{ whiteSpace: 'pre-line', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{run.log || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <div className="toast-container"><div className={`toast ${toast.type}`}>{toast.msg}</div></div>}
    </div>
  );
}
