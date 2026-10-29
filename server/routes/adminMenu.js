const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { db, nowIso } = require('../db');
const { asyncRoute } = require('../routeUtils');
const inventory = require('../services/inventory');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

// ---------------- Taom rasmlari (ixtiyoriy — majburiy emas) ----------------
// public/uploads/menu/ — server/index.js'dagi express.static(public/) orqali
// to'g'ridan-to'g'ri "/uploads/menu/<fayl>" manzilida ochiladi, alohida route
// shart emas. Fayl nomi tasodifiy (crypto) — mijoz/admin original nomni
// ko'rmaydi, to'qnashuv ehtimoli yo'q.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'menu');
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

// Eski rasm faylini xavfsiz o'chiradi — faqat bizning UPLOAD_DIR ichidagi
// "/uploads/menu/<nom>" ko'rinishidagi qiymatlarga tegadi (tashqi URL yoki
// boshqa yo'l bo'lsa hech narsa qilmaydi), xato bo'lsa ham (fayl allaqachon
// yo'q va h.k.) butun so'rovni yiqitmaydi.
function deleteOldImageIfLocal(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/menu/')) return;
  const filename = path.basename(imageUrl);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!filePath.startsWith(UPLOAD_DIR)) return; // path traversal himoyasi
  fs.unlink(filePath, () => {}); // xato bo'lsa ham jim — asosiy amalga ta'sir qilmasin
}

router.post('/upload-image', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: describeUploadError(err) });
    if (!req.file) return res.status(400).json({ error: 'Rasm tanlanmagan' });
    res.json({ url: `/uploads/menu/${req.file.filename}` });
  });
});

// ---------------- Kategoriyalar ----------------

// Standart holatda faqat faol (o'chirilmagan) kategoriyalar ko'rsatiladi.
// ?include_inactive=1 bilan so'ralsa — o'chirilganlar ham qaytariladi
// (2026-09-09'da qo'shildi: ilgari o'chirilgan-lekin-tarixi-bor-uchun-faqat-
// is_active=0-qilingan kategoriyalarni admin panelidan qayta tiklashning
// HECH QANDAY yo'li yo'q edi — GET har doim ularni butunlay yashirardi, PUT
// esa is_active qayta yoqishni qabul qilardi, lekin UI hech qachon bunday
// qatorni yuklamas edi, ya'ni yo'l "o'lik" edi. public/admin/menu.js endi
// shu parametr bilan o'chirilganlarni alohida ko'rsatib, tiklash imkonini
// beradi).
router.get('/categories', asyncRoute((req, res) => {
  const includeInactive = req.query.include_inactive === '1';
  const rows = includeInactive
    ? db.prepare('SELECT * FROM menu_categories ORDER BY sort_order, id').all()
    : db.prepare('SELECT * FROM menu_categories WHERE is_active = 1 ORDER BY sort_order, id').all();
  res.json(rows);
}));

router.post('/categories', asyncRoute((req, res) => {
  const { name, sort_order, require_inventory_link } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom kiritilishi shart' });
  const ts = nowIso();
  const info = db
    .prepare('INSERT INTO menu_categories (name, sort_order, is_active, require_inventory_link, created_at) VALUES (?, ?, 1, ?, ?)')
    .run(String(name).trim(), Number(sort_order) || 0, require_inventory_link ? 1 : 0, ts);
  res.json(db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/categories/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Kategoriya topilmadi' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const sortOrder = req.body?.sort_order !== undefined ? Number(req.body.sort_order) : existing.sort_order;
  const isActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
  const requireInventoryLink = req.body?.require_inventory_link !== undefined
    ? (req.body.require_inventory_link ? 1 : 0)
    : existing.require_inventory_link;
  db.prepare('UPDATE menu_categories SET name = ?, sort_order = ?, is_active = ?, require_inventory_link = ? WHERE id = ?').run(
    name, sortOrder, isActive, requireInventoryLink, req.params.id
  );
  res.json(db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(req.params.id));
}));

// Kategoriyaga (faol yoki allaqachon o'chirilgan) hech qanday taom bog'liq
// bo'lmasa — demak buyurtma tarixiga ham aloqasi yo'q — bazadan butunlay
// o'chiriladi. Aks holda (taomlar hali bor, ular esa buyurtma tarixi tufayli
// o'chirilmagan bo'lishi mumkin) faqat is_active=0 qilinadi — bari bir GET
// /categories bunday yozuvni endi qaytarmaydi (ro'yxatdan g'oyib bo'ladi),
// lekin FK/tarix buzilmaydi.
router.delete('/categories/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Kategoriya topilmadi' });
  const hasItems = db.prepare('SELECT 1 FROM menu_items WHERE category_id = ? LIMIT 1').get(req.params.id);
  if (!hasItems) {
    db.prepare('DELETE FROM menu_categories WHERE id = ?').run(req.params.id);
    return res.json({ ok: true });
  }
  db.prepare('UPDATE menu_categories SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------------- Taomlar ----------------

// Faqat faol (o'chirilmagan) taomlar — categories bilan bir xil mantiq
// (pastdagi DELETE handler'ga qarang).
// Ombor bilan bog'langan taomlar uchun qoldiq/birlik ma'lumotini ham (LEFT JOIN)
// qo'shib qaytaramiz — admin panelida alohida so'rovsiz ko'rsatish uchun
// (public/admin/menu.js). Bog'lanmagan taomlarda bu ustunlar NULL bo'ladi.
const ITEMS_SELECT = `
  SELECT m.*, inv.name AS inventory_name, inv.unit AS inventory_unit, inv.quantity AS inventory_quantity, inv.volume AS inventory_volume
  FROM menu_items m
  LEFT JOIN inventory_items inv ON inv.id = m.inventory_item_id
`;

// ?include_inactive=1 — categories bilan bir xil sabab (soft-delete'ni
// admin panelidan ko'rish/tiklash imkonini berish, 2026-09-09).
router.get('/items', asyncRoute((req, res) => {
  const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
  const includeInactive = req.query.include_inactive === '1';
  const clauses = [];
  const params = [];
  if (categoryId) { clauses.push('m.category_id = ?'); params.push(categoryId); }
  if (!includeInactive) clauses.push('m.is_active = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`${ITEMS_SELECT} ${where} ORDER BY m.category_id, m.sort_order, m.id`).all(...params);
  res.json(rows);
}));

function resolveInventoryItemId(raw) {
  if (raw === undefined) return undefined; // o'zgartirilmagan
  if (raw === null || raw === '') return null; // uzish
  const id = Number(raw);
  if (!Number.isFinite(id)) throw Object.assign(new Error("Ombor mahsuloti noto'g'ri"), { status: 400 });
  const row = getInventoryRow(id);
  if (!row) throw Object.assign(new Error('Ombor mahsuloti topilmadi'), { status: 404 });
  return row;
}

// Bog'langan taomning narxi/mavjudligi ombordan olinishi kerak bo'lgani uchun
// har doim FRESH (joriy) qatorni qaytaradi — POST'da yangi bog'langanda ham,
// PUT'da avvalgi bog'lanish saqlanganda ham bir xil manba ishlatilishi uchun.
// FAQAT faol (is_active=1) ombor mahsulotlari qaytariladi (2026-09-09'da
// tuzatildi — ilgari filtr yo'q edi, shu sabab to'g'ridan-to'g'ri API
// chaqiruvi bilan taomni o'chirilgan/soft-delete qilingan ombor mahsulotiga
// bog'lash mumkin edi, natijada taom doimiy "tugadi" holatida qolib, buni
// admin UI orqali tuzatib bo'lmasdi, chunki o'chirilgan mahsulot endi
// bog'lash uchun tanlanmaydi).
function getInventoryRow(id) {
  return db.prepare('SELECT id, quantity, is_active, sale_price, cost_price FROM inventory_items WHERE id = ? AND is_active = 1').get(id);
}

// ---------------- "Turi" (variant) — parent_item_id (2026-09-09) ----------------
// Admin menyuda taom qo'shganda/tahrirlaganda "+ Turi qo'shish" tugmasi bilan
// shu taomga o'xshash turlar (masalan "Osh" -> "Qovurma osh", "To'y oshi")
// qo'shilishi mumkin. Faqat BITTA daraja chuqurlikka ruxsat beriladi — variant
// o'zi yana ota bo'la olmaydi (frontend ham buni taqdim qilmaydi, lekin server
// to'g'ridan-to'g'ri API chaqiruvi bilan chetlab o'tishning oldini oladi).
// Variant har doim ota taom bilan bir xil kategoriyada bo'ladi — so'rovda
// yuborilgan category_id shu holatda e'tiborga olinmaydi, ota taomnikiga
// almashtiriladi (nested render mantiqi — public/admin/menu.js — shuni talab
// qiladi: variant faqat o'z ota taomi ostida, o'sha kategoriya ichida chiqadi).
function resolveParentItemId(raw, selfId) {
  if (raw === undefined) return undefined; // o'zgartirilmagan
  if (raw === null || raw === '') return null; // ota bilan bog'lanish uzilyapti (oddiy taomga aylanadi)
  const id = Number(raw);
  if (!Number.isFinite(id)) throw Object.assign(new Error("Ota taom noto'g'ri"), { status: 400 });
  if (selfId !== undefined && id === Number(selfId)) {
    throw Object.assign(new Error("Taom o'zini o'ziga tur qilib bog'lay olmaydi"), { status: 400 });
  }
  const parent = db.prepare('SELECT id, category_id, parent_item_id, is_active FROM menu_items WHERE id = ?').get(id);
  if (!parent || !parent.is_active) throw Object.assign(new Error('Ota taom topilmadi'), { status: 404 });
  if (parent.parent_item_id) {
    throw Object.assign(new Error("Bu taom o'zi biror taomning turi — unga yana tur qo'shib bo'lmaydi"), { status: 400 });
  }
  return parent;
}

// Taom o'zi (kamida bitta faol) turga ega bo'lsa — uni boshqa taomning turiga
// aylantirib bo'lmaydi (ikki darajali ichma-ichlikning oldini olish uchun).
function hasActiveChildren(id) {
  return !!db.prepare('SELECT 1 FROM menu_items WHERE parent_item_id = ? AND is_active = 1 LIMIT 1').get(id);
}

// Tan narx (cost_price) — IXTIYORIY: admin har doim ham bilmasligi mumkin, shu sabab
// bo'sh/berilmagan qoldirilsa NULL bo'lib qoladi (narx kabi majburiy emas). Ombor bilan
// bog'langan taomda esa (narx kabi) yagona manba — qo'lda yuborilgan qiymatga ishonilmaydi,
// har doim inventory_items.cost_price'dan olinadi (chaqiruvchi joyda hal qilinadi).
function parseOptionalCostPrice(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error("Tan narx noto'g'ri"), { status: 400 });
  return n;
}

// image_url — IXTIYORIY (majburiy emas): bo'sh/berilmagan qoldirilsa NULL
// bo'lib qoladi, frontend rasmsiz (faqat nom/narx) ko'rsatadi.
router.post('/items', asyncRoute((req, res) => {
  const { category_id, name, price, cost_price, sort_order, description, image_url, volume, inventory_item_id, parent_item_id } = req.body || {};
  const priceNum = Number(price);
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom kiritilishi shart' });
  if (!Number.isFinite(priceNum) || priceNum < 0) return res.status(400).json({ error: "Narx noto'g'ri" });
  // Tur (variant) qo'shilayotgan bo'lsa — kategoriya ota taomnikidan olinadi
  // (yuborilgan category_id e'tiborga olinmaydi, izoh yuqorida).
  const parentRow = resolveParentItemId(parent_item_id, undefined);
  const categoryId = parentRow ? parentRow.category_id : Number(category_id);
  if (!Number.isFinite(categoryId)) return res.status(400).json({ error: 'Kategoriya tanlanmagan' });
  const category = db.prepare('SELECT id, require_inventory_link FROM menu_categories WHERE id = ?').get(categoryId);
  if (!category) return res.status(404).json({ error: 'Kategoriya topilmadi' });
  // Ombor bilan bog'langan bo'lsa — narx VA mavjudlik ombordan olinadi (mijoz/admin
  // yuborgan narxga ISHONILMAYDI — yagona manba ombordagi sotuv narxi), aks holda
  // odatdagidek qo'lda kiritilgan narx va doim mavjud (1) bilan boshlanadi.
  const invRow = resolveInventoryItemId(inventory_item_id);
  // require_inventory_link=1 bo'lgan bo'limda ombor bilan bog'lanmagan taom
  // yaratib bo'lmaydi — ilgari bu qoida faqat frontendda (public/admin/menu.js)
  // tekshirilardi, to'g'ridan-to'g'ri API chaqiruvi bilan chetlab o'tish mumkin
  // edi, natijada yaratilgan taom waiterMenu.js/publicMenu.js filtridan o'tolmay
  // hech qayerda ko'rinmaydigan "arvoh" yozuv bo'lib qolardi (2026-09-09'da
  // serverga ham qo'shildi).
  if (category.require_inventory_link && !invRow) {
    return res.status(400).json({ error: "Bu bo'lim faqat ombor bilan bog'langan taomlarni qabul qiladi" });
  }
  const finalPrice = invRow ? invRow.sale_price : Math.round(priceNum);
  // Tan narx ham xuddi shunday — bog'langan bo'lsa ombordan, aks holda admin qo'lda
  // kiritgan (ixtiyoriy, bo'sh qoldirilsa NULL) qiymat.
  const finalCostPrice = invRow ? invRow.cost_price : parseOptionalCostPrice(cost_price);
  const isAvailable = invRow ? inventory.computeAvailability(invRow) : 1;
  const ts = nowIso();
  const info = db
    .prepare(
      `INSERT INTO menu_items (category_id, name, price, cost_price, is_available, is_active, sort_order, description, image_url, volume, inventory_item_id, parent_item_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      categoryId, String(name).trim(), finalPrice, finalCostPrice, isAvailable, Number(sort_order) || 0,
      description ? String(description).trim() : null,
      image_url ? String(image_url).trim() : null,
      volume ? String(volume).trim() : null,
      invRow ? invRow.id : null,
      parentRow ? parentRow.id : null,
      ts, ts
    );
  res.json(db.prepare(`${ITEMS_SELECT} WHERE m.id = ?`).get(info.lastInsertRowid));
}));

router.put('/items/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Taom topilmadi' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const priceRaw = req.body?.price !== undefined ? Math.round(Number(req.body.price)) : existing.price;
  // Ota taom (parent_item_id) o'zgartirilayotgan bo'lsa — bog'lanish qoidalari
  // POST'dagi bilan bir xil (resolveParentItemId), qo'shimcha: taomning o'zi
  // hozir kamida bitta faol turga ega bo'lsa, uni boshqa taomning turiga
  // aylantirib bo'lmaydi (ikki darajali ichma-ichlik oldini olinadi).
  const parentRowChange = resolveParentItemId(req.body?.parent_item_id, req.params.id);
  if (parentRowChange && hasActiveChildren(existing.id)) {
    return res.status(400).json({ error: "Bu taomning o'zi turlarga ega — uni boshqa taomning turiga aylantirib bo'lmaydi" });
  }
  const parentItemId = parentRowChange === undefined ? existing.parent_item_id : (parentRowChange ? parentRowChange.id : null);
  // Tur (variant) bo'lsa — kategoriya har doim ota taomnikiga tenglashtiriladi.
  const categoryId = parentRowChange
    ? parentRowChange.category_id
    : (req.body?.category_id !== undefined ? Number(req.body.category_id) : existing.category_id);
  const sortOrder = req.body?.sort_order !== undefined ? Number(req.body.sort_order) : existing.sort_order;
  const isActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
  const description = req.body?.description !== undefined ? (String(req.body.description).trim() || null) : existing.description;
  const imageUrl = req.body?.image_url !== undefined ? (String(req.body.image_url).trim() || null) : existing.image_url;
  const volume = req.body?.volume !== undefined ? (String(req.body.volume).trim() || null) : existing.volume;
  if (!Number.isFinite(priceRaw) || priceRaw < 0) return res.status(400).json({ error: "Narx noto'g'ri" });
  const costPriceRaw = req.body?.cost_price !== undefined ? parseOptionalCostPrice(req.body.cost_price) : existing.cost_price;

  const category = db.prepare('SELECT id, require_inventory_link FROM menu_categories WHERE id = ?').get(categoryId);
  if (!category) return res.status(404).json({ error: 'Kategoriya topilmadi' });

  const invRowChange = resolveInventoryItemId(req.body?.inventory_item_id);
  const inventoryItemId = invRowChange === undefined ? existing.inventory_item_id : (invRowChange ? invRowChange.id : null);
  // Taom (yangi yoki avvaldan) omborga bog'langan bo'lsa — har doim JORIY ombor
  // qatorini qayta o'qiymiz (invRowChange faqat SHU so'rovda link o'zgargan
  // bo'lsagina to'ldirilgan bo'ladi — avvalgi bog'lanish saqlanganda ham narx/
  // mavjudlik yangilanib turishi uchun bu yerda alohida so'rov shart).
  const effectiveInvRow = inventoryItemId ? getInventoryRow(inventoryItemId) : null;
  // POST'dagi bilan bir xil server-tomon qoida (2026-09-09) — require_inventory_link
  // bo'limida ombor bilan bog'lanmagan taom qoldirib bo'lmaydi. FAQAT bog'lanish
  // yoki bo'lim HAQIQATDA shu so'rovda o'zgartirilganda tekshiriladi (categoryChanged/
  // linkChanged) — aks holda eski (qoida qo'shilishidan oldingi yoki ombor
  // mahsuloti o'chirilib avtomatik "uzilgan", server/services/inventory.js
  // deleteItem()'ga qarang) bog'lanmagan taomni oddiy tahrirlash (masalan
  // nomini o'zgartirish yoki ♻️ Tiklash bilan is_active qaytarish) ham
  // bloklanib qolar edi — bu haqiqiy yangi buzilish emas, faqat mavjud holat.
  const categoryChanged = categoryId !== existing.category_id;
  const linkChanged = req.body?.inventory_item_id !== undefined;
  if (category.require_inventory_link && !effectiveInvRow && (categoryChanged || linkChanged)) {
    return res.status(400).json({ error: "Bu bo'lim faqat ombor bilan bog'langan taomlarni qabul qiladi" });
  }
  const price = effectiveInvRow ? effectiveInvRow.sale_price : priceRaw;
  const costPrice = effectiveInvRow ? effectiveInvRow.cost_price : costPriceRaw;
  const isAvailable = effectiveInvRow ? inventory.computeAvailability(effectiveInvRow) : existing.is_available;

  db.prepare(
    'UPDATE menu_items SET name = ?, price = ?, cost_price = ?, category_id = ?, sort_order = ?, is_active = ?, description = ?, image_url = ?, volume = ?, inventory_item_id = ?, parent_item_id = ?, is_available = ?, updated_at = ? WHERE id = ?'
  ).run(name, price, costPrice, categoryId, sortOrder, isActive, description, imageUrl, volume, inventoryItemId, parentItemId, isAvailable, nowIso(), req.params.id);
  // Narx o'zgarishi — "Audit izi" auditi (2026-10-10): ilgari eski narx
  // hech qayerga yozilmasdi, narxni "vaqtincha" o'zgartirib qaytarib qo'yish
  // izsiz qolardi.
  if (price !== existing.price) {
    logAudit('menu_item.price_change', 'menu_item', existing.id, { price: existing.price }, { price }, req.user.id);
  }
  // Rasm almashtirilgan/olib tashlangan bo'lsa — eski faylni diskdan tozalaymiz
  // (bo'sh joy to'planib qolmasin uchun).
  if (existing.image_url && existing.image_url !== imageUrl) deleteOldImageIfLocal(existing.image_url);
  res.json(db.prepare(`${ITEMS_SELECT} WHERE m.id = ?`).get(req.params.id));
}));

router.patch('/items/:id/availability', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Taom topilmadi' });
  if (existing.inventory_item_id) {
    return res.status(400).json({
      error: "Bu taom omborga bog'langan — mavjudligi ombor qoldig'idan avtomatik hisoblanadi (Ombor bo'limidan boshqaring)",
    });
  }
  const isAvailable = req.body?.is_available ? 1 : 0;
  db.prepare('UPDATE menu_items SET is_available = ?, updated_at = ? WHERE id = ?').run(
    isAvailable, nowIso(), req.params.id
  );
  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id));
}));

// Taom hech qanday buyurtma tarixida (ichki afitsiant order_items HAM mijozlar
// customer_order_items) ishlatilmagan bo'lsa — bazadan butunlay o'chiriladi.
// Ishlatilgan bo'lsa (eski chek/hisobotlar shu qatorga FK bilan bog'liq)
// haqiqiy o'chirish mumkin emas — faqat is_active=0, lekin GET /items uni
// baribir ro'yxatda ko'rsatmaydi.
router.delete('/items/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Taom topilmadi' });
  // Bu taomning (kamida bitta faol) turi bo'lsa — avval o'shalarni o'chirish
  // kerak, aks holda ular "yetim" (mavjud bo'lmagan ota taomga bog'langan)
  // bo'lib qolib, hech qayerda (mijoz/afitsiant menyusida ham) ko'rinmay
  // qoladi (izoh yuqorida, resolveParentItemId/hasActiveChildren).
  if (hasActiveChildren(existing.id)) {
    return res.status(400).json({ error: "Avval bu taomning turlarini o'chiring" });
  }
  const usedInOrders =
    db.prepare('SELECT 1 FROM order_items WHERE menu_item_id = ? LIMIT 1').get(req.params.id) ||
    db.prepare('SELECT 1 FROM customer_order_items WHERE menu_item_id = ? LIMIT 1').get(req.params.id);
  if (!usedInOrders) {
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
    if (existing.image_url) deleteOldImageIfLocal(existing.image_url);
    return res.json({ ok: true });
  }
  db.prepare('UPDATE menu_items SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
