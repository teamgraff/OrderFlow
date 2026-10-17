import { decodeMixedEncoding, parseOtListHtml } from './otParsers.js';

/**
 * Cliente de SOLO LECTURA para app-teamgraff.com (no tiene API).
 *
 * Reglas de seguridad (no relajar):
 * - Solo se abren el listado de OT, el detalle de una OT y la portada (login).
 *   El listado y el detalle tienen enlaces que al abrirse ELIMINAN registros o ENVÍAN
 *   correos: cualquier ruta fuera de la lista blanca se rechaza aquí.
 * - Solo dos POST permitidos: el formulario de inicio de sesión y el buscador
 *   "Buscar N° OT" (únicamente con un número).
 * - Como máximo una petición por segundo, con un User-Agent identificable.
 * - Usuario y contraseña solo desde variables de entorno; nunca se registran.
 */

const ALLOWED_GET = [
  /^\/$/,
  /^\/admin\.php$/,
  /^\/Ordenini\/indexOT\.php(\?pagina=\d+)?$/,
  /^\/Ordenini\/imprimirPantalla\.php\?cotizacion=\d+&editar2=\d+$/,
];
const MIN_INTERVAL_MS = 1000;
const USER_AGENT = 'TeamgraffOrderflow/1.0 (sincronizacion de solo lectura)';

export class SyncConfigError extends Error {}
export class SyncAuthError extends Error {}

export function syncConfigured() {
  return Boolean(process.env.TEAMGRAFF_USER && process.env.TEAMGRAFF_PASSWORD);
}

export class TeamgraffClient {
  constructor({ user = process.env.TEAMGRAFF_USER, password = process.env.TEAMGRAFF_PASSWORD, baseUrl = process.env.TEAMGRAFF_BASE_URL || 'https://app-teamgraff.com', fetchImpl = fetch } = {}) {
    if (!user || !password) throw new SyncConfigError('Faltan TEAMGRAFF_USER / TEAMGRAFF_PASSWORD en la configuración del servidor.');
    // Propiedades no enumerables: no aparecen si el objeto se registra o serializa.
    Object.defineProperty(this, 'credentials', { value: { user, password }, enumerable: false });
    this.base = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.cookies = new Map();
    this.lastRequest = 0;
    this.loggedIn = false;
  }

  /** Busca una OT por número con el buscador del listado. Devuelve la fila o null si no existe. */
  async findOt(number) {
    const n = String(number);
    if (!/^\d+$/.test(n)) throw new Error('Número de OT inválido.');
    const html = await this.page('POST', '/Ordenini/indexOT.php', new URLSearchParams({ nombre: n, p_submit1: 'Buscar' }));
    const { rows } = parseOtListHtml(html);
    return rows.find((r) => r.number === n) ?? null;
  }

  async listPage(page) {
    return parseOtListHtml(await this.page('GET', `/Ordenini/indexOT.php?pagina=${Math.max(1, Math.floor(page))}`));
  }

  async detailHtml(ref) {
    if (!/^\d+$/.test(ref?.cotizacion ?? '') || !/^\d+$/.test(ref?.editar2 ?? '')) throw new Error('Referencia de OT inválida.');
    return this.page('GET', `/Ordenini/imprimirPantalla.php?cotizacion=${ref.cotizacion}&editar2=${ref.editar2}`);
  }

  /** Pide una página permitida; si la sesión expiró, vuelve a entrar una vez. */
  async page(method, path, body) {
    if (!this.loggedIn) await this.login();
    let html = await this.request(method, path, body);
    if (looksLoggedOut(html)) {
      this.loggedIn = false;
      await this.login();
      html = await this.request(method, path, body);
      if (looksLoggedOut(html)) throw new SyncAuthError('La sesión en app-teamgraff.com no se mantiene. Revisar el usuario de sincronización.');
    }
    return html;
  }

  async login() {
    this.cookies.clear();
    await this.request('GET', '/');
    const { user, password } = this.credentials;
    await this.request('POST', '/', new URLSearchParams({ usuario: user, password, login: 'Iniciar Sesion' }));
    const home = await this.request('GET', '/admin.php');
    if (!/Cerrar Sesion/i.test(home)) throw new SyncAuthError('No se pudo iniciar sesión en app-teamgraff.com: revisar usuario y contraseña de sincronización.');
    this.loggedIn = true;
  }

  async request(method, path, body, redirects = 0) {
    assertAllowed(method, path, body);

    const wait = this.lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();

    const res = await this.fetch(this.base + path, {
      method,
      body,
      redirect: 'manual',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || redirects > 3) return '';
      const next = new URL(location, this.base + path);
      if (next.origin !== new URL(this.base).origin) throw new Error('Redirección a otro sitio bloqueada.');
      // Tras el login se sigue la redirección solo si va a una página permitida.
      const nextPath = next.pathname + next.search;
      if (!ALLOWED_GET.some((re) => re.test(nextPath))) return '';
      return this.request('GET', nextPath, undefined, redirects + 1);
    }
    if (!res.ok) throw new Error(`app-teamgraff.com respondió ${res.status} en ${path.split('?')[0]}`);
    return decodeMixedEncoding(new Uint8Array(await res.arrayBuffer()));
  }
}

export function assertAllowed(method, path, body) {
  if (method === 'GET') {
    if (!ALLOWED_GET.some((re) => re.test(path))) throw new Error(`Ruta no permitida para la sincronización: ${path}`);
    return;
  }
  if (method === 'POST') {
    const form = body instanceof URLSearchParams ? [...body.keys()].sort().join(',') : '';
    if (path === '/' && form === 'login,password,usuario') return;
    if (path === '/Ordenini/indexOT.php' && /^nombre=\d+&p_submit1=Buscar$/.test(String(body))) return;
  }
  throw new Error(`Petición no permitida para la sincronización: ${method} ${path}`);
}

function looksLoggedOut(html) {
  return /name=["']usuario["']/i.test(html) && /name=["']password["']/i.test(html);
}
