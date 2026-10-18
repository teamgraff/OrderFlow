import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowed, TeamgraffClient } from '../src/sync/teamgraffClient.js';
import { parseOtHtml, decodeMixedEncoding, decodeCfEmail } from '../src/sync/otParsers.js';
import { detailHtml } from './helpers.js';

test('Lista blanca: solo login, listado, detalle y el buscador por número', () => {
  assert.doesNotThrow(() => assertAllowed('GET', '/Ordenini/indexOT.php?pagina=3'));
  assert.doesNotThrow(() => assertAllowed('GET', '/Ordenini/imprimirPantalla.php?cotizacion=10807&editar2=10946'));
  assert.doesNotThrow(() => assertAllowed('GET', '/Ordenini/CotizacionPantalla.php?cotizacion=10946'));
  assert.throws(() => assertAllowed('GET', '/Ordenini/CotizacionPantalla.php?cotizacion=1&borrar=1'));
  assert.throws(() => assertAllowed('GET', '/Ordenini/cotizacionOrdenT.php?cotizacion=10625'), /no permitida/);
  assert.doesNotThrow(() => assertAllowed('POST', '/', new URLSearchParams({ usuario: 'u', password: 'p', login: 'Iniciar Sesion' })));
  assert.doesNotThrow(() => assertAllowed('POST', '/Ordenini/indexOT.php', new URLSearchParams({ nombre: '3706', p_submit1: 'Buscar' })));
  // Enlaces del listado que eliminan registros o envían correos:
  for (const p of ['/Ordenini/cuadernoEot.php?check=10625', '/Ordenini/cuadernoEliminarTalla.php?articulo=1&editar2=2', '/Ordenini/correoToque.php?toque=1&editar2=2', '/Ordenini/cotizacionOrdenT.php?cotizacion=1']) {
    assert.throws(() => assertAllowed('GET', p), /no permitida/);
  }
  assert.throws(() => assertAllowed('POST', '/Ordenini/indexOT.php', new URLSearchParams({ nombre: "1' OR 1=1", p_submit1: 'Buscar' })));
  assert.throws(() => assertAllowed('POST', '/Ordenini/indexOT.php', new URLSearchParams({ nombre: '1', p_submit1: 'Buscar', borrar: '1' })));
  assert.throws(() => assertAllowed('POST', '/Ordenini/otra.php', new URLSearchParams({ nombre: '1', p_submit1: 'Buscar' })));
});

test('El cliente no expone la contraseña al registrarlo o serializarlo', () => {
  const c = new TeamgraffClient({ user: 'usuario-sync', password: 'clave-secreta', fetchImpl: async () => { throw new Error('sin red'); } });
  assert.ok(!JSON.stringify(c).includes('clave-secreta'));
  assert.ok(!Object.keys(c).includes('credentials'));
});

test('Inicio de sesión fallido: error claro y sin la contraseña en el mensaje', async () => {
  const fetchImpl = async () => new Response('<form><input name="usuario"><input name="password"></form>', { status: 200 });
  const c = new TeamgraffClient({ user: 'u', password: 'clave-secreta', fetchImpl });
  c.request = async function (method, path, body) { assertAllowed(method, path, body); return (await fetchImpl()).text(); };
  await assert.rejects(() => c.findOt(3706), (err) => /No se pudo iniciar sesión/.test(err.message) && !err.message.includes('clave-secreta'));
});

test('Detalle: lee cabecera, tallas, notas y avisa líneas sin tallas', () => {
  const ot = parseOtHtml(detailHtml({
    number: '3706', quote: '9946', empresa: '76.543.210-K EMPRESA DEMO SPA.',
    lines: [
      { article: 'PANTALON CARGO GABARDINA', qty: 12, color: 'AZUL MARINO', pos: 'Tapeta izquierda', sizes: [[10, 'M'], [2, 'XXL']], note: 'bordado: logo' },
      { article: 'Gorro Gabardina 5P', qty: 20, color: 'AZUL MARINO', pos: 'Al frente', sizes: [], note: 'BORDADO: letras' },
    ],
  }));
  assert.equal(ot.number, '3706');
  assert.equal(ot.quoteNumber, '9946');
  assert.equal(ot.clientRut, '76.543.210-K');
  assert.equal(ot.clientName, 'EMPRESA DEMO SPA.');
  assert.equal(ot.issuedAt, '16/10/2026');
  assert.deepEqual(ot.lines[0].sizes, [{ qty: 10, size: 'M' }, { qty: 2, size: 'XXL' }]);
  assert.equal(ot.lines[0].note, 'bordado: logo');
  assert.deepEqual(ot.lines[1].sizes, [{ size: null, qty: 20 }]);
  assert.equal(ot.warnings.length, 1);
});

test('Cotización: lee N° y "Total Neto" en formato chileno', async () => {
  const { quoteHtml } = await import('./helpers.js');
  const { parseQuoteNet } = await import('../src/sync/otParsers.js');
  assert.deepEqual(parseQuoteNet(quoteHtml({ number: '9946', net: 217280 })), { quoteNumber: '9946', net: 217280 });
  assert.deepEqual(parseQuoteNet(quoteHtml({ number: '9946', net: null })), { quoteNumber: '9946', net: null });
  assert.deepEqual(parseQuoteNet('<html>otra página</html>'), { quoteNumber: null, net: null });
});

test('Codificación mixta UTF-8 / Latin-1 y correos ocultos por Cloudflare', () => {
  assert.equal(decodeMixedEncoding(new Uint8Array([0x72, 0x65, 0x70, 0x6f, 0x73, 0x69, 0x63, 0x69, 0xf3, 0x6e])), 'reposición');
  assert.equal(decodeMixedEncoding(new TextEncoder().encode('Tamaño')), 'Tamaño');
  const key = 0x1e;
  const hex = key.toString(16) + [...'a@b.cl'].map((ch) => (ch.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  assert.equal(decodeCfEmail(hex), 'a@b.cl');
});
