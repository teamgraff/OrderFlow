import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, DollarSign, Clock, AlertTriangle, Download, Search, Eye } from 'lucide-react';
import { api } from '../api/client';

const STATUS_MAP = {
  green: { label: 'Terminado', class: 'badge-green', emoji: '🟢' },
  yellow: { label: 'Por vencer', class: 'badge-yellow', emoji: '🟡' },
  red: { label: 'Vencido', class: 'badge-red', emoji: '🔴' },
  pending: { label: 'Pendiente', class: 'badge-gray', emoji: '⏳' },
};

const DELIVERY_MAP = {
  sin_verificar: { label: 'Sin verificar', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  completo: { label: '✅ Completo', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  con_faltantes: { label: '⚠️ Faltantes', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({ total: 0, totalValue: 0, pending: 0, overdue: 0, warning: 0, completed: 0 });
  const [filters, setFilters] = useState({ status: '', client: '', month: '', logo_technique: '', delivery_status: '' });
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordersData, statsData] = await Promise.all([api.getOrders(filters), api.getOrderStats()]);
      setOrders(ordersData);
      setStats(statsData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [filters.status, filters.month, filters.logo_technique, filters.delivery_status]);

  const handleSearch = () => fetchData();

  const formatMoney = (v) => {
    if (!v) return '$0';
    return '$' + Number(v).toLocaleString('es-CL');
  };

  const handleExport = () => {
    window.open(api.exportExcel(), '_blank');
  };

  return (
    <div className="animate-fade-up">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Dashboard</h2>
          <p>Resumen general de órdenes de compra</p>
        </div>
        <button className="btn btn-secondary" onClick={handleExport}>
          <Download size={16} /> Exportar Excel
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Package size={24} /></div>
          <div>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Órdenes</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><DollarSign size={24} /></div>
          <div>
            <div className="stat-value">{formatMoney(stats.totalValue)}</div>
            <div className="stat-label">Valor Total</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon yellow"><Clock size={24} /></div>
          <div>
            <div className="stat-value">{stats.pending + stats.warning}</div>
            <div className="stat-label">Pendientes</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><AlertTriangle size={24} /></div>
          <div>
            <div className="stat-value">{stats.overdue}</div>
            <div className="stat-label">Vencidas</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <input className="form-input" placeholder="Buscar cliente..." value={filters.client} onChange={e => setFilters(f => ({ ...f, client: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ minWidth: '200px' }} />
        <select className="form-select" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="in_progress">En proceso</option>
          <option value="completed">Terminado</option>
        </select>
        <select className="form-select" value={filters.logo_technique} onChange={e => setFilters(f => ({ ...f, logo_technique: e.target.value }))}>
          <option value="">Todas las técnicas</option>
          <option value="SIN LOGO">SIN LOGO</option>
          <option value="BORDADO">BORDADO</option>
          <option value="ESTAMPADO">ESTAMPADO</option>
          <option value="BORDADO Y ESTAMPADO">BORDADO Y ESTAMPADO</option>
        </select>
        <select className="form-select" value={filters.delivery_status} onChange={e => setFilters(f => ({ ...f, delivery_status: e.target.value }))}>
          <option value="">Toda recepción</option>
          <option value="sin_verificar">Sin verificar</option>
          <option value="completo">Completo</option>
          <option value="con_faltantes">Con faltantes</option>
        </select>
        <input className="form-input" type="month" value={filters.month} onChange={e => setFilters(f => ({ ...f, month: e.target.value }))} />
        <button className="btn btn-secondary btn-sm" onClick={handleSearch}><Search size={14} /> Buscar</button>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state"><p>Cargando...</p></div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <Package size={48} style={{ opacity: 0.3, margin: '0 auto 1rem', display: 'block' }} />
            <h3>Sin órdenes</h3>
            <p>Crea tu primera orden desde "Nueva Orden"</p>
          </div>
        ) : (
          <div className="table-container" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>N° OT / ID</th>
                  <th>Cliente</th>
                  <th>Técnica</th>
                  <th>Fecha Límite</th>
                  <th>Estado</th>
                  <th>Recepción</th>
                  <th>Proveedor</th>
                  <th>Valor Neto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => {
                  const vs = STATUS_MAP[order.visual_status] || STATUS_MAP.pending;
                  const ds = DELIVERY_MAP[order.delivery_status] || DELIVERY_MAP.sin_verificar;
                  return (
                    <tr key={order.id} className="cursor-pointer" onClick={() => navigate(`/orders/${order.id}`)}>
                      <td>{order.custom_ot ? <strong>{order.custom_ot}</strong> : <span style={{ color: 'var(--text-muted)' }}>#{order.id}</span>}</td>
                      <td style={{ fontWeight: 600 }}>{order.client_name}</td>
                      <td>
                        <span style={{ fontSize: '0.85rem', padding: '2px 6px', background: 'var(--bg-secondary)', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                          {order.logo_technique || 'SIN LOGO'}
                        </span>
                      </td>
                      <td>{order.deadline || '—'}</td>
                      <td>
                        <span className={`badge ${vs.class}`}>
                          <span className="badge-dot" />
                          {vs.label}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8rem', padding: '3px 8px', borderRadius: '6px', color: ds.color, background: ds.bg, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {ds.label}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{order.supplier_name || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{formatMoney(order.net_value)}</td>
                      <td>
                        <button className="btn btn-icon btn-secondary" onClick={e => { e.stopPropagation(); navigate(`/orders/${order.id}`); }}>
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
