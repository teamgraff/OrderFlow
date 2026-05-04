const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error de red' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.headers.get('content-type')?.includes('application/json')) {
    return res.json();
  }
  return res;
}

export const api = {
  parseQuote: (text) => request('/quotes/parse', { method: 'POST', body: JSON.stringify({ text }) }),
  
  uploadQuotePDF: (file) => {
    const formData = new FormData();
    formData.append('pdf', file);
    return request('/quotes/upload', { 
      method: 'POST', 
      body: formData,
      headers: {} // Let browser set Content-Type with boundary
    });
  },
  getOrders: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v)).toString();
    return request(`/orders${qs ? '?' + qs : ''}`);
  },
  getOrderStats: () => request('/orders/stats'),
  getOrder: (id) => request(`/orders/${id}`),
  createOrder: (data) => request('/orders', { method: 'POST', body: JSON.stringify(data) }),
  updateOrder: (id, data) => request(`/orders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOrder: (id) => request(`/orders/${id}`, { method: 'DELETE' }),
  generateEmails: (data) => request('/orders/generate-emails', { method: 'POST', body: JSON.stringify(data) }),

  getSuppliers: () => request('/suppliers'),
  getSupplier: (id) => request(`/suppliers/${id}`),
  createSupplier: (data) => request('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  updateSupplier: (id, data) => request(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSupplier: (id) => request(`/suppliers/${id}`, { method: 'DELETE' }),

  exportExcel: () => `${BASE}/dashboard/export`,
};
