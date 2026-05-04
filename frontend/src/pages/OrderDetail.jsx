import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Trash2, CheckCircle } from 'lucide-react';
import { api } from '../api/client';

const STATUS_MAP = {
  green: { label: 'Terminado', class: 'badge-green' },
  yellow: { label: 'Por vencer', class: 'badge-yellow' },
  red: { label: 'Vencido', class: 'badge-red' },
  pending: { label: 'Pendiente', class: 'badge-gray' },
};

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [form, setForm] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    Promise.all([api.getOrder(id), api.getSuppliers()])
      .then(([o, s]) => {
        setOrder(o);
        setForm({ custom_ot: o.custom_ot || '', client_name: o.client_name, quote_date: o.quote_date || '', net_value: o.net_value || 0, profit_margin: o.profit_margin || 30, payment_date: o.payment_date || '', supplier_order_number: o.supplier_order_number || '', supplier_id: o.supplier_id || '', logo_technique: o.logo_technique || 'SIN LOGO', delivery_status: o.delivery_status || 'sin_verificar', status: o.status, notes: o.notes || '' });
        setSuppliers(s);
      })
      .catch(err => showToast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    try {
      const updated = await api.updateOrder(id, { ...form, net_value: Number(form.net_value), profit_margin: Number(form.profit_margin), supplier_id: form.supplier_id || null });
      setOrder(updated);
      showToast('Orden actualizada');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDelete = async () => {
    if (!confirm('¿Eliminar esta orden?')) return;
    try {
      await api.deleteOrder(id);
      navigate('/dashboard');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const markComplete = async () => {
    try {
      const updated = await api.updateOrder(id, { status: 'completed' });
      setOrder(updated);
      setForm(f => ({ ...f, status: 'completed' }));
      showToast('Orden marcada como terminada');
    } catch (err) { showToast(err.message, 'error'); }
  };

  if (loading) return <div className="empty-state"><p>Cargando...</p></div>;
  if (!order) return <div className="empty-state"><h3>Orden no encontrada</h3></div>;

  const vs = STATUS_MAP[order.visual_status] || STATUS_MAP.pending;
  const formatMoney = (v) => '$' + Number(v || 0).toLocaleString('es-CL');

  return (
    <div className="animate-fade-up">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard')} style={{ marginBottom: '0.75rem' }}>
            <ArrowLeft size={14} /> Volver
          </button>
          <h2>Orden {order.custom_ot ? `OT ${order.custom_ot}` : `#${order.id}`} <span className={`badge ${vs.class}`} style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }}><span className="badge-dot" />{vs.label}</span></h2>
          <p>{order.client_name} — {order.deadline ? `Fecha límite: ${order.deadline}` : 'Sin fecha límite'}</p>
        </div>
        <div className="flex gap-2">
          {order.status !== 'completed' && (
            <button className="btn btn-success btn-sm" onClick={markComplete}><CheckCircle size={14} /> Marcar Terminada</button>
          )}
          <button className="btn btn-danger btn-sm" onClick={handleDelete}><Trash2 size={14} /> Eliminar</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 className="card-title" style={{ marginBottom: '1rem' }}>Datos de la Orden</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">N° OT</label>
            <input className="form-input" value={form.custom_ot} onChange={e => setForm(f => ({ ...f, custom_ot: e.target.value }))} placeholder="Opcional" />
          </div>
          <div className="form-group">
            <label className="form-label">Cliente</label>
            <input className="form-input" value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Fecha Cotización</label>
            <input className="form-input" type="date" value={form.quote_date} onChange={e => setForm(f => ({ ...f, quote_date: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Valor Neto ($)</label>
            <input className="form-input" type="number" value={form.net_value} onChange={e => setForm(f => ({ ...f, net_value: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">% Utilidad</label>
            <input className="form-input" type="number" value={form.profit_margin} onChange={e => setForm(f => ({ ...f, profit_margin: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Fecha de Pago</label>
            <input className="form-input" type="date" value={form.payment_date} onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} />
            <small style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Fecha límite auto: 10 días hábiles</small>
          </div>
          <div className="form-group">
            <label className="form-label">N° Orden Proveedor</label>
            <input className="form-input" value={form.supplier_order_number} onChange={e => setForm(f => ({ ...f, supplier_order_number: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Proveedor</label>
            <select className="form-select" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
              <option value="">Sin asignar</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Técnica de Personalización *</label>
            <select className="form-select" value={form.logo_technique} onChange={e => setForm(f => ({ ...f, logo_technique: e.target.value }))}>
              <option value="SIN LOGO">SIN LOGO</option>
              <option value="BORDADO">BORDADO</option>
              <option value="ESTAMPADO">ESTAMPADO</option>
              <option value="BORDADO Y ESTAMPADO">BORDADO Y ESTAMPADO</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Estado</label>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="pending">Pendiente</option>
              <option value="in_progress">En proceso</option>
              <option value="completed">Terminado</option>
            </select>
          </div>
          <div className="form-group"></div>
        </div>
        <div style={{ textAlign: 'right', marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={handleSave}><Save size={16} /> Guardar Cambios</button>
        </div>
      </div>

      {/* Recepción de Pedido — Section for packing staff */}
      <div className="card" style={{ marginBottom: '1.5rem', borderLeft: `4px solid ${form.delivery_status === 'con_faltantes' ? '#f59e0b' : form.delivery_status === 'completo' ? '#22c55e' : '#6b7280'}` }}>
        <h3 className="card-title" style={{ marginBottom: '1rem' }}>📦 Recepción de Pedido</h3>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Estado de Recepción</label>
            <select className="form-select" value={form.delivery_status} onChange={e => setForm(f => ({ ...f, delivery_status: e.target.value }))} style={{ fontSize: '1rem', fontWeight: 600 }}>
              <option value="sin_verificar">🔘 Sin verificar</option>
              <option value="completo">✅ Completo</option>
              <option value="con_faltantes">⚠️ Con faltantes</option>
            </select>
          </div>
          <div className="form-group"></div>
        </div>
        <div className="form-group">
          <label className="form-label">{form.delivery_status === 'con_faltantes' ? '⚠️ Detalle de Faltantes (obligatorio)' : 'Notas'}</label>
          <textarea
            className="form-textarea"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={4}
            placeholder={form.delivery_status === 'con_faltantes' ? 'Ej: Faltan 3 poleras talla M color negro, SKU 01074...' : 'Notas adicionales sobre la orden...'}
            style={form.delivery_status === 'con_faltantes' ? { borderColor: '#f59e0b', background: 'rgba(245,158,11,0.05)' } : {}}
          />
        </div>
        <div style={{ textAlign: 'right', marginTop: '1rem' }}>
          <button className="btn btn-primary" onClick={handleSave}><Save size={16} /> Guardar Recepción</button>
        </div>
      </div>

      {/* Items */}
      {order.items && order.items.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 className="card-title" style={{ marginBottom: '1rem' }}>Productos ({order.items.length})</h3>
          <div className="table-container">
            <table className="table">
              <thead><tr><th>Producto</th><th>SKU</th><th>Color</th><th>Talla</th><th>Cantidad</th><th>Precio Unit.</th></tr></thead>
              <tbody>
                {order.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.product_name}</td>
                    <td style={{ fontFamily: 'monospace' }}>{item.sku}</td>
                    <td>{item.color}</td>
                    <td>{item.size}</td>
                    <td>{item.quantity}</td>
                    <td>{formatMoney(item.unit_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Email */}
      {order.generated_email && (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: '1rem' }}>📧 Email Generado</h3>
          <div className="email-preview">{order.generated_email}</div>
        </div>
      )}

      {toast && <div className="toast-container"><div className={`toast ${toast.type}`}>{toast.msg}</div></div>}
    </div>
  );
}
