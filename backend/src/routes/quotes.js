import { Router } from 'express';
import { parseQuote } from '../services/quoteParser.js';

const router = Router();

// POST /api/quotes/parse — Parse raw quote text
router.post('/parse', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Se requiere el campo "text"' });
  try {
    const result = parseQuote(text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Error al parsear cotización', details: err.message });
  }
});

export default router;
