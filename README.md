# OrderFlow — Gestión de Órdenes de Compra

ERP liviano para gestión de órdenes de ropa corporativa.

## Deploy en Railway

1. Conectar este repo a Railway
2. Railway detectará automáticamente Node.js
3. Configurar variables de entorno:
   - `PORT` → Railway lo asigna automáticamente
   - `NODE_ENV` → `production`

## Estructura

```
OrderFlow/
├── frontend/          # React + Vite
│   ├── src/
│   └── package.json
├── backend/           # Express + SQLite
│   ├── src/
│   ├── data/          # SQLite database
│   └── package.json
├── package.json       # Root: install, build, start
└── nixpacks.toml      # Railway build config
```
