import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCopy, Send, Save, ArrowRight, ArrowLeft, Check, Sparkles, Trash2, Plus, FileUp, FileText } from 'lucide-react';
import { api } from '../api/client';

const STEPS = ['Pegar Cotización', 'Revisar Datos', 'Generar Orden', 'Guardar'];

export default function NewOrder() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [rawText, setRawText] = useState('');
  const [parsedData, setParsedData] = useState({ client: '', netValue: 0, items: [] });
  const [emails, setEmails] = useState([]);
  const [orderForm, setOrderForm] = useState({ custom_ot: '', client_name: '', quote_date: new Date().toISOString().split('T')[0], net_value: 0, profit_margin: 30, payment_date: '', supplier_order_number: '', supplier_id: '', logo_technique: 'SIN LOGO', notes: '' });
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleParse = async () => {
    if (!rawText.trim()) return showToast('Pega el texto de la cotización', 'error');
    setLoading(true);
    try {
      const data = await api.parseQuote(rawText);
      setParsedData(data);
      setOrderForm(f => ({ ...f, custom_ot: data.quoteNumber || '', client_name: data.client || '', net_value: data.netValue || 0 }));
      const supps = await api.getSuppliers();
      setSuppliers(supps);
      setStep(1);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') return showToast('Solo se permiten archivos PDF', 'error');

    setLoading(true);
    try {
      const data = await api.uploadQuotePDF(file);
      setParsedData(data);
      setOrderForm(f => ({ ...f, custom_ot: data.quoteNumber || '', client_name: data.client || '', net_value: data.netValue || 0 }));
      const supps = await api.getSuppliers();
      setSuppliers(supps);
      setStep(1);
      showToast('PDF procesado correctamente');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
      e.target.value = ''; // Reset input
    }
  };

  const handleGenerateEmails = async () => {
    setLoading(true);
    try {
      const result = await api.generateEmails({ items: parsedData.items, client_name: parsedData.client || orderForm.client_name });
      setEmails(result);
      setStep(2);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    showToast('Correo copiado al portapapeles');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!orderForm.client_name) return showToast('Ingresa el nombre del cliente', 'error');
    setLoading(true);
    try {
      const emailText = emails.map(e => e.email).join('\n\n---\n\n');
      await api.createOrder({
        ...orderForm,
        net_value: Number(orderForm.net_value) || 0,
        profit_margin: Number(orderForm.profit_margin) || 30,
        supplier_id: orderForm.supplier_id || null,
        raw_quote_text: rawText,
        generated_email: emailText,
        items: parsedData.items,
      });
      showToast('Orden guardada exitosamente');
      setTimeout(() => navigate('/dashboard'), 1000);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (idx, field, value) => {
    const updated = [...parsedData.items];
    updated[idx] = { ...updated[idx], [field]: value };
    setParsedData(d => ({ ...d, items: updated }));
  };

  const removeItem = (idx) => {
    setParsedData(d => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  };

  const addItem = () => {
    setParsedData(d => ({ ...d, items: [...d.items, { product_name: '', sku: '', color: '', size: '', quantity: 0, unit_price: 0 }] }));
  };

  return (
    <div className="animate-fade-up">
      <div className="page-header">
        <h2>Nueva Orden de Compra</h2>
        <p>Procesa una cotización y genera órdenes de compra automáticamente</p>
      </div>

      {/* Stepper */}
      <div className="stepper">
        {STEPS.map((label, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`stepper-step ${i === step ? 'active' : i < step ? 'completed' : ''}`} onClick={() => i < step && setStep(i)}>
              <div className="stepper-number">{i < step ? <Check size={14} /> : i + 1}</div>
              <span className="stepper-label">{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`stepper-line ${i < step ? 'completed' : ''}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Paste Quote */}
      {step === 0 && (
        <div className="card animate-fade-up">
          <div className="card-header">
            <h3 className="card-title">📋 Pegar Cotización</h3>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: '1rem' }}>
            Pega aquí el texto de la cotización. El sistema extraerá automáticamente los productos, SKU, colores, tallas y cantidades.
          </p>
          <textarea
            className="quote-textarea"
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            placeholder={`Ejemplo:\nCliente: Empresa ABC\n\nProducto\tSKU\tColor\tTalla\tCantidad\nPolera Piqué\tTN-001\tNegro\tM\t10\nPolera Piqué\tTN-001\tNegro\tL\t15\nCamisa Oxford\tCS-200\tAzul\tM\t8\n\nTotal Neto: $450.000`}
          />
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="upload-section">
              <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                <FileUp size={18} /> Subir PDF
                <input type="file" accept=".pdf" onChange={handleFileUpload} style={{ display: 'none' }} disabled={loading} />
              </label>
              <span style={{ marginLeft: '0.75rem', color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>
                Sube el PDF que generas para tu cliente
              </span>
            </div>
            <button className="btn btn-primary btn-lg" onClick={handleParse} disabled={loading || !rawText.trim()}>
              {loading ? 'Procesando...' : <><Sparkles size={18} /> Procesar Texto</>}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review Data */}
      {step === 1 && (
        <div className="card animate-fade-up">
          <div className="card-header">
            <h3 className="card-title">✅ Datos Extraídos</h3>
            <button className="btn btn-secondary btn-sm" onClick={addItem}><Plus size={14} /> Agregar Item</button>
          </div>

          <div className="form-row" style={{ marginBottom: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Cliente</label>
              <input className="form-input" value={parsedData.client || ''} onChange={e => setParsedData(d => ({ ...d, client: e.target.value }))} placeholder="Nombre del cliente" />
            </div>
            <div className="form-group">
              <label className="form-label">Valor Neto</label>
              <input className="form-input" type="number" value={parsedData.netValue || ''} onChange={e => setParsedData(d => ({ ...d, netValue: Number(e.target.value) }))} placeholder="0" />
            </div>
          </div>

          {parsedData.items.length > 0 ? (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Producto</th><th>SKU</th><th>Color</th><th>Talla</th><th>Cantidad</th><th>Precio Unit.</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.items.map((item, idx) => (
                    <tr key={idx}>
                      <td><input className="form-input" value={item.product_name} onChange={e => updateItem(idx, 'product_name', e.target.value)} /></td>
                      <td><input className="form-input" value={item.sku} onChange={e => updateItem(idx, 'sku', e.target.value)} style={{ width: '100px' }} /></td>
                      <td><input className="form-input" value={item.color} onChange={e => updateItem(idx, 'color', e.target.value)} style={{ width: '100px' }} /></td>
                      <td><input className="form-input" value={item.size} onChange={e => updateItem(idx, 'size', e.target.value)} style={{ width: '70px' }} /></td>
                      <td><input className="form-input" type="number" value={item.quantity} onChange={e => updateItem(idx, 'quantity', Number(e.target.value))} style={{ width: '80px' }} /></td>
                      <td><input className="form-input" type="number" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', Number(e.target.value))} style={{ width: '100px' }} /></td>
                      <td><button className="btn btn-icon btn-danger" onClick={() => removeItem(idx)}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3>No se encontraron productos</h3>
              <p>Agrega items manualmente o vuelve a pegar la cotización</p>
            </div>
          )}

          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-secondary" onClick={() => setStep(0)}><ArrowLeft size={16} /> Volver</button>
            <button className="btn btn-primary" onClick={handleGenerateEmails} disabled={loading || parsedData.items.length === 0}>
              {loading ? 'Generando...' : <><Send size={16} /> Generar Orden de Compra</>}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Email Preview */}
      {step === 2 && (
        <div className="animate-fade-up">
          {emails.map((emailData, idx) => (
            <div className="card" key={idx} style={{ marginBottom: '1rem' }}>
              <div className="card-header">
                <h3 className="card-title">
                  📧 {emailData.supplier ? `Orden para ${emailData.supplier.name}` : 'Orden de Compra'}
                </h3>
                <button className="btn btn-secondary btn-sm" onClick={() => handleCopy(emailData.email)}>
                  <ClipboardCopy size={14} /> {copied ? '¡Copiado!' : 'Copiar'}
                </button>
              </div>
              {emailData.supplier?.email && (
                <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', marginBottom: '0.75rem' }}>
                  Enviar a: <strong style={{ color: 'var(--accent)' }}>{emailData.supplier.email}</strong>
                </p>
              )}
              <div className="email-preview">{emailData.email}</div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}><ArrowLeft size={16} /> Volver</button>
            <button className="btn btn-success btn-lg" onClick={() => setStep(3)}><ArrowRight size={16} /> Continuar a Guardar</button>
          </div>
        </div>
      )}

      {/* Step 4: Save */}
      {step === 3 && (
        <div className="card animate-fade-up">
          <div className="card-header">
            <h3 className="card-title">💾 Guardar Orden</h3>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">N° OT (Opcional)</label>
              <input className="form-input" value={orderForm.custom_ot} onChange={e => setOrderForm(f => ({ ...f, custom_ot: e.target.value }))} placeholder="Ej: 8079" />
            </div>
            <div className="form-group">
              <label className="form-label">Cliente *</label>
              <input className="form-input" value={orderForm.client_name} onChange={e => setOrderForm(f => ({ ...f, client_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Fecha Cotización</label>
              <input className="form-input" type="date" value={orderForm.quote_date} onChange={e => setOrderForm(f => ({ ...f, quote_date: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Valor Neto ($)</label>
              <input className="form-input" type="number" value={orderForm.net_value} onChange={e => setOrderForm(f => ({ ...f, net_value: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">% Utilidad</label>
              <input className="form-input" type="number" value={orderForm.profit_margin} onChange={e => setOrderForm(f => ({ ...f, profit_margin: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Fecha de Pago</label>
              <input className="form-input" type="date" value={orderForm.payment_date} onChange={e => setOrderForm(f => ({ ...f, payment_date: e.target.value }))} />
              <small style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>La fecha límite se calcula automáticamente (10 días hábiles)</small>
            </div>
            <div className="form-group">
              <label className="form-label">N° Orden Proveedor</label>
              <input className="form-input" value={orderForm.supplier_order_number} onChange={e => setOrderForm(f => ({ ...f, supplier_order_number: e.target.value }))} placeholder="Ej: OC-2026-001" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Proveedor</label>
              <select className="form-select" value={orderForm.supplier_id} onChange={e => setOrderForm(f => ({ ...f, supplier_id: e.target.value }))}>
                <option value="">Sin asignar</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Técnica de Personalización *</label>
              <select className="form-select" value={orderForm.logo_technique} onChange={e => setOrderForm(f => ({ ...f, logo_technique: e.target.value }))}>
                <option value="SIN LOGO">SIN LOGO</option>
                <option value="BORDADO">BORDADO</option>
                <option value="ESTAMPADO">ESTAMPADO</option>
                <option value="BORDADO Y ESTAMPADO">BORDADO Y ESTAMPADO</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Notas</label>
              <input className="form-input" value={orderForm.notes} onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notas adicionales..." />
            </div>
            <div className="form-group"></div>
          </div>

          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-secondary" onClick={() => setStep(2)}><ArrowLeft size={16} /> Volver</button>
            <button className="btn btn-success btn-lg" onClick={handleSave} disabled={loading}>
              {loading ? 'Guardando...' : <><Save size={18} /> Guardar Orden</>}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
