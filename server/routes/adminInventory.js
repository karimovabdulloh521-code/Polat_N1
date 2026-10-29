// Admin "Ombor" bo'limi — suv/salfetka va shunga o'xshash sarflanadigan
// mahsulotlar qoldig'ini boshqarish (server/services/inventory.js'ga qarang).
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const inventory = require('../services/inventory');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

// ---------------- Ombor mahsuloti rasmi (ixtiyoriy, 2026-09-26) ----------------
// Taom rasmi (server/routes/adminMenu.js) bilan bir xil naqsh, lekin alohida
// papka (public/uploads/inventory/) — ikkalasi bir-biriga aralashmasin uchun.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'inventory');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = ALLOWED_EXT[file.mimetype] || path.extname(file.originalname) || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — telefon kamerasi rasmlari ko'pincha 5-10MB bo'ladi
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_EXT[file.mimetype]) return cb(new Error('Faqat rasm fayli (jpg/png/webp/gif) yuklash mumkin'));
    cb(null, true);
  },
});

function describeUploadError(err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') return 'Rasm hajmi juda katta (15MB dan oshmasin)';
  return (err && err.message) || 'Rasm yuklashda xatolik';
}

function deleteOldImageIfLocal(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/inventory/')) return;
  const filename = path.basename(imageUrl);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!filePath.startsWith(UPLOAD_DIR)) return; // path traversal himoyasi
  fs.unlink(filePath, () => {}); // xato bo'lsa ham jim — asosiy amalga ta'sir qilmasin
}

router.post('/upload-image', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: describeUploadError(err) });
    if (!req.file) return res.status(400).json({ error: 'Rasm tanlanmagan' });
    res.json({ url: `/uploads/inventory/${req.file.filename}` });
  });
});

// ---------------- Turkumlar (ustunlarga ajratish uchun, 2026-09-26) ----------------

router.get('/categories', asyncRoute((req, res) => {
  res.json(inventory.listCategories());
}));

router.post('/categories', asyncRoute((req, res) => {
  const { name, sort_order } = req.body || {};
  res.json(inventory.createCategory({ name, sort_order }));
}));

router.put('/categories/:id', asyncRoute((req, res) => {
  const { name, sort_order } = req.body || {};
  res.json(inventory.updateCategory(req.params.id, { name, sort_order }));
}));

router.delete('/categories/:id', asyncRoute((req, res) => {
  res.json(inventory.deleteCategory(req.params.id));
}));

// ---------------- Mahsulotlar ----------------

router.get('/items', asyncRoute((req, res) => {
  res.json(inventory.listItems({ includeInactive: req.query.all === '1' }));
}));

// Ombor sahifasi tepasidagi 4 ta ko'rsatkich kartochkasi uchun — bitta
// agregatsiya so'rovi (server/services/inventory.js, getStats()).
router.get('/stats', asyncRoute((req, res) => {
  res.json(inventory.getStats());
}));

router.post('/items', asyncRoute((req, res) => {
  const { name, unit, quantity, low_stock_threshold, cost_price, sale_price, volume, menu_category_id, category_id, image_url } = req.body || {};
  res.json(inventory.createItem({ name, unit, quantity, low_stock_threshold, cost_price, sale_price, volume, menu_category_id, category_id, image_url }));
}));

router.put('/items/:id', asyncRoute((req, res) => {
  const { name, unit, low_stock_threshold, is_active, cost_price, sale_price, volume, menu_category_id, category_id, image_url } = req.body || {};
  const existing = inventory.getItemRow(req.params.id);
  const result = inventory.updateItem(req.params.id, { name, unit, low_stock_threshold, is_active, cost_price, sale_price, volume, menu_category_id, category_id, image_url });
  if (image_url !== undefined && existing.image_url && existing.image_url !== result.image_url) {
    deleteOldImageIfLocal(existing.image_url);
  }
  res.json(result);
}));

router.delete('/items/:id', asyncRoute((req, res) => {
  const existing = inventory.getItemRow(req.params.id);
  const result = inventory.deleteItem(req.params.id);
  // Faqat HARD-DELETE bo'lganda (harakat tarixi yo'q edi) rasmni ham o'chiramiz
  // — soft-delete (is_active=0) bo'lsa mahsulot hamon "tiklash" uchun mavjud,
  // rasmi ham saqlanib qolishi kerak.
  if (result.hard_deleted && existing.image_url) deleteOldImageIfLocal(existing.image_url);
  res.json(result);
}));

// Qo'lda kirim/chiqim: { delta: +10 } (kirim) yoki { delta: -3 } (chiqim/chiqindi).
// Chiqim uchun ixtiyoriy `reason: 'waste'` — "isrof" (buzilgan/chiqib ketgan)
// bilan oddiy "adjustment" (boshqa sabab)ni ajratish uchun (2026-10-10,
// Ombor auditi). Kirim uchun reason tanlovi yo'q — har doim 'restock'.
router.post('/items/:id/adjust', asyncRoute((req, res) => {
  const { delta, note, reason: rawReason } = req.body || {};
  const reason = Number(delta) > 0 ? 'restock' : (rawReason === 'waste' ? 'waste' : 'adjustment');
  res.json(inventory.adjustStock(req.params.id, delta, { reason, note, userId: req.user.id }));
}));

// Inventarizatsiya (qo'lda fizik sanash): { actual_quantity: 47 } — farq
// avtomatik hisoblanadi, reason='stocktake' bilan yoziladi (2026-10-10, Ombor auditi).
router.post('/items/:id/stocktake', asyncRoute((req, res) => {
  const { actual_quantity, note } = req.body || {};
  res.json(inventory.stocktake(req.params.id, actual_quantity, { note, userId: req.user.id }));
}));

router.get('/items/:id/movements', asyncRoute((req, res) => {
  res.json(inventory.listMovements(req.params.id, req.query.limit));
}));

module.exports = router;
