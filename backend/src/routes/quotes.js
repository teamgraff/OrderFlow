import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseQuote } from '../services/quoteParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Configure multer for PDF uploads
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

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

// POST /api/quotes/upload — Upload a PDF and extract quote data
router.post('/upload', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Se requiere un archivo PDF' });
  }

  try {
    // Extract text from PDF using pdfjs-dist (pure JS, works on Railway without Python)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    // Read the uploaded file as Uint8Array (required by pdfjs)
    const fileBuffer = fs.readFileSync(req.file.path);
    const data = new Uint8Array(fileBuffer);
    
    // Load PDF document
    const doc = await pdfjsLib.getDocument({ data }).promise;
    
    // Extract text from all pages
    let extractedText = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      extractedText += pageText + '\n';
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ error: 'No se pudo extraer texto del PDF' });
    }

    // Parse the extracted text using our existing parser
    const result = parseQuote(extractedText);
    result.rawText = extractedText;
    
    // Debug: log extracted text to file for analysis
    const debugPath = path.join(uploadsDir, 'last_pdf_text.txt');
    fs.writeFileSync(debugPath, extractedText, 'utf-8');
    console.log('📄 PDF text extracted (' + extractedText.length + ' chars), saved to:', debugPath);

    res.json(result);
  } catch (err) {
    console.error('Error procesando PDF:', err);
    res.status(500).json({ error: 'Error al procesar el PDF', details: err.message });
  } finally {
    // Clean up the uploaded file
    try { fs.unlinkSync(req.file.path); } catch (e) {}
  }
});

export default router;

