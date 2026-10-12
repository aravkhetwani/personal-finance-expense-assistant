import { Router } from 'express';
import multer from 'multer';
import { HttpError, bad } from '../http.js';
import { parseReceiptText, recognize } from '../ocr.js';

const r = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (['image/jpeg', 'image/png'].includes(file.mimetype) ? cb(null, true) : cb(bad('Please upload a JPG or PNG image'))),
});

// FR-SCAN-001..003: the image is processed in memory (never stored) and the result is returned for
// the user to review/edit — nothing is saved until they confirm via POST /api/transactions.
r.post('/scan', upload.single('receipt'), async (req, res) => {
  if (!req.file) throw bad('Please attach a receipt image');
  const sig = req.file.buffer;
  const isPng = sig[0] === 0x89 && sig[1] === 0x50;
  const isJpg = sig[0] === 0xff && sig[1] === 0xd8;
  if (!isPng && !isJpg) throw bad('That file is not a valid JPG or PNG image');
  try {
    const text = await recognize(req.file.buffer);
    const parsed = parseReceiptText(text);
    res.json({ extracted: parsed, rawText: text.slice(0, 2000), message: 'Please review the details below before saving.' });
  } catch (e) {
    if (e.code === 'OCR_UNAVAILABLE' || e.code === 'OCR_FAILED') throw new HttpError(422, e.message, { manual: true });
    throw e;
  }
});

export default r;
