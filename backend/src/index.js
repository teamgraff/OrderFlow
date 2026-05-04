import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function start() {
  await initDB();

  const { default: quotesRouter } = await import('./routes/quotes.js');
  const { default: ordersRouter } = await import('./routes/orders.js');
  const { default: suppliersRouter } = await import('./routes/suppliers.js');
  const { default: dashboardRouter } = await import('./routes/dashboard.js');
  const { errorHandler } = await import('./middleware/errorHandler.js');

  const app = express();
  const PORT = process.env.PORT || 3001;

  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  app.use('/api/quotes', quotesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/dashboard', dashboardRouter);

  // Serve frontend static files from the built dist folder
  const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'), err => { if (err) next(); });
  });

  app.use(errorHandler);

  // Bind to 0.0.0.0 for Railway/cloud deployment
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 OrderFlow API running on port ${PORT}\n`);
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
