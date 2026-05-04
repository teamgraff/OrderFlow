import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Save, Truck } from 'lucide-react';
import { api } from '../api/client';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', sku_prefix: '', phone: '', notes: '' });
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const fetchSuppliers = async () => {
    try { setSuppliers(await api.getSuppliers()); } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchSuppliers(); }, []);

  const openNew = () => { setEditing(null); setForm({ name: '', email: '', sku_prefix: '', phone: '', notes: '' }); setShowModal(true); };
  const openEdit = (s) => { setEditing(s); setForm({ name: s.name, email: s.email || '', sku_prefix: s.sku_prefix || '', phone: s.phone || '', notes: s.notes || '' }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name) return showToast('El nombre es requerido', 'error');
    try {
      if (editing) { await api.updateSupplier(editing.id, form); showToast('Proveedor actualizado'); }
      else { await api.createSupplier(form); showToast('Proveedor creado'); }
      setShowModal(false);
      fetchSuppliers();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este proveedor?')) return;
    try { await api.deleteSupplier(id); showToast('Proveedor eliminado'); fetchSuppliers(); } catch (err) { showToast(err.message, 'error'); }
  };

  return (
    <div className="animate-fade-up">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Proveedores</h2>
          <p>Gestiona tus proveedores y sus prefijos de SKU para detección automática</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Nuevo Proveedor</button>
      </div>

      {suppliers.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Truck size={48} style={{ opacity: 0.3, margin: '0 auto 1rem', display: 'block' }} />
            <h3>Sin proveedores</h3>
            <p>Agrega tu primer proveedor para comenzar</p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-container" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th>Prefijos SKU</th><th>Notas</th><th></th></tr>
              </thead>
              <tbody>
                {suppliers.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ color: 'var(--accent)' }}>{s.email || '—'}</td>
                    <td>{s.phone || '—'}</td>
                    <td><code style={{ background: 'rgba(59,130,246,0.1)', padding: '2px 8px', borderRadius: '4px', fontSize: 'var(--text-xs)' }}>{s.sku_prefix || '—'}</code></td>
                    <td style={{ color: 'var(--text-secondary)', maxWidth: '200px' }} className="truncate">{s.notes || '—'}</td>
                    <td>
                      <div className="flex gap-2">
                        <button className="btn btn-icon btn-secondary" onClick={() => openEdit(s)}><Edit2 size={14} /></button>
                        <button className="btn btn-icon btn-danger" onClick={() => handleDelete(s.id)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editing ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h3>
              <button className="btn btn-icon btn-secondary" onClick={() => setShowModal(false)}><X size={16} /></button>
            </div>
            <div className="form-group">
              <label className="form-label">Nombre *</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Proveedor Textil Norte" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="ventas@proveedor.cl" />
              </div>
              <div className="form-group">
                <label className="form-label">Teléfono</label>
                <input className="form-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+56 9 ..." />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Prefijos SKU</label>
              <input className="form-input" value={form.sku_prefix} onChange={e => setForm(f => ({ ...f, sku_prefix: e.target.value }))} placeholder="TN,PTN (separados por coma)" />
              <small style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>Los SKU que empiecen con estos prefijos se asignarán a este proveedor</small>
            </div>
            <div className="form-group">
              <label className="form-label">Notas</label>
              <textarea className="form-textarea" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Notas sobre el proveedor..." />
            </div>
            <div style={{ textAlign: 'right', marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={handleSave}><Save size={16} /> {editing ? 'Actualizar' : 'Crear'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast-container"><div className={`toast ${toast.type}`}>{toast.msg}</div></div>}
    </div>
  );
}
