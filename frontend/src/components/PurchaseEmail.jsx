import { useState, useEffect } from 'react';
import { ClipboardCopy } from 'lucide-react';
import { buildPurchaseEmail } from '../utils/purchaseEmail';

const RECIPIENT_KEY = 'orderflow.purchaseEmail.recipient';

function savedRecipient() {
  try { return localStorage.getItem(RECIPIENT_KEY) || ''; } catch { return ''; }
}

/** Correo de compra de la orden (prendas, colores y tallas), editable y listo para copiar. */
export default function PurchaseEmail({ items, onCopied }) {
  const [recipient, setRecipient] = useState(savedRecipient);
  const [text, setText] = useState('');

  useEffect(() => { setText(buildPurchaseEmail(items, recipient)); }, [items, recipient]);

  const changeRecipient = (value) => {
    setRecipient(value);
    try { localStorage.setItem(RECIPIENT_KEY, value); } catch { /* sin almacenamiento local */ }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onCopied?.('Correo copiado al portapapeles');
    } catch {
      onCopied?.('No se pudo copiar: selecciona el texto y cópialo manualmente', 'error');
    }
  };

  const units = items.reduce((a, i) => a + (Number(i.quantity) || 0), 0);

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 className="card-title">📧 Correo de compra · {units} prendas</h3>
        <button className="btn btn-primary btn-sm" onClick={copy}><ClipboardCopy size={14} /> Copiar correo</button>
      </div>
      <div className="form-group" style={{ maxWidth: 320 }}>
        <label className="form-label">Saludo a</label>
        <input className="form-input" value={recipient} onChange={e => changeRecipient(e.target.value)} placeholder="Ej: Pablo" />
      </div>
      <textarea className="form-textarea" value={text} onChange={e => setText(e.target.value)} rows={Math.min(30, text.split('\n').length + 1)} style={{ fontFamily: 'inherit', whiteSpace: 'pre' }} />
    </div>
  );
}
