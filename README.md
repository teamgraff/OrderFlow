# OrderFlow — Gestión de Órdenes de Compra

ERP liviano para gestión de órdenes de ropa corporativa. Recibe automáticamente las órdenes de trabajo (OT)
que se generan en el sistema de cotizaciones Teamgraff (app-teamgraff.com) y también permite cargarlas a mano.

## Deploy en Railway

Proyecto Railway **`harmonious-dream`**, servicio `OrderFlow`. Se despliega con el `Dockerfile` en cada push a `main`.

Variables de entorno:

| Variable | Valor | Para qué |
|---|---|---|
| `PORT` | (Railway lo asigna) | Puerto HTTP |
| `NODE_ENV` | `production` | Oculta detalles de errores |
| `DATA_PATH` | `/data` | Carpeta del volumen persistente (base `orderflow.db` y `backups/`) |
| `SYNC_ENABLED` | `true` / `false` | Activa la sincronización automática con Teamgraff |
| `TEAMGRAFF_USER` / `TEAMGRAFF_PASSWORD` | (secretos) | Usuario de **solo lectura** en app-teamgraff.com. Nunca en el código ni en el repositorio |
| `SYNC_INTERVAL_MINUTES` | `3` | Cada cuántos minutos se revisa Teamgraff |
| `SYNC_START_OT` | p. ej. `3711` | Primer N° de OT que se importa automáticamente (las anteriores no se importan). Se fija en la primera ejecución |
| `TEAMGRAFF_BASE_URL` | (opcional) | Por defecto `https://app-teamgraff.com` |

Debe correr **una sola instancia** del servicio (la base SQLite es un archivo en el volumen).

## Sincronización con Teamgraff

Teamgraff no tiene API: Orderflow inicia sesión con un usuario de solo lectura y lee las mismas páginas que
usaría una persona (`backend/src/sync/`).

- **Detección:** el listado de Teamgraff está ordenado por N° de *cotización*, no de OT, así que una OT nueva
  de una cotización antigua puede quedar muchas páginas abajo. Por eso, como los N° de OT son correlativos,
  cada ciclo busca "última OT + 1, + 2, …" con el buscador *Buscar N° OT*, y además revisa las primeras
  páginas del listado como red de seguridad.
- **Lectura:** se abre el detalle de la OT (`imprimirPantalla.php`, el mismo documento que antes se imprimía
  a PDF y se subía a mano) y se crea la orden con una fila por talla, posición de logo e indicaciones.
- **Valor neto:** se toma el "Total Neto" (sin IVA) de la cotización en pantalla
  (`CotizacionPantalla.php?cotizacion=<N° cotización>`, página de solo lectura). Solo se completa si el campo está
  vacío: nunca reemplaza un valor ingresado a mano. Si la cotización no se puede leer o está en $0, la OT se importa
  igual con el neto vacío. Al activarse por primera vez rellena una sola vez las órdenes existentes con neto vacío.
- **Seguridad:** el cliente tiene una lista blanca de páginas (`teamgraffClient.js`). Varias acciones del
  listado eliminan registros o envían correos al abrirse: nunca se abren. Máximo 1 petición por segundo.
- **Sin duplicados:** el N° de OT es único en la base (`orders.teamgraff_ot`). Una OT ya existente —importada
  o cargada a mano— nunca se vuelve a crear.
- **N° interno OF-0001…:** se asigna en la misma transacción que crea la orden (carga manual o automática),
  por lo que no se repite ni se consume si algo falla.
- **Errores:** si una OT existe pero su detalle no se puede leer, la orden se registra igual como *Pendiente*
  y se reintenta en los siguientes ciclos (hasta 5 veces); luego queda en *Error sync* con el botón
  **Reprocesar**. Las incidencias e historial se ven en la página **Sincronización**.
- **Revisión humana:** lo que la OT no trae no se inventa. Las líneas sin tallas o sin técnica identificable
  dejan la orden *Incompleta* con el motivo, hasta que alguien la marque como revisada.
- **Reinicios:** todo el estado vive en la base de datos; un reinicio o redespliegue continúa donde quedó.

## Base de datos

SQLite (sql.js) en `DATA_PATH/orderflow.db`. Las migraciones son versionadas (`PRAGMA user_version`, ver
`backend/src/database.js`), solo agregan columnas o tablas, y antes de aplicar una se guarda una copia en
`DATA_PATH/backups/`.

## Pruebas

```
cd backend && npm test
```

## Estructura

```
OrderFlow/
├── frontend/          # React + Vite
├── backend/           # Express + SQLite
│   ├── src/sync/      # Conector Teamgraff (cliente, lectores HTML, ciclo, programador)
│   ├── src/services/  # orderStore (creación de órdenes + N° OF), parser de PDF, Excel
│   └── test/          # Pruebas (node:test) con HTML ficticio
└── Dockerfile
```
