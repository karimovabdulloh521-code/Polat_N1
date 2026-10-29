// Ombor (2026-09-07): suv/salfetka va shunga o'xshash sarflanadigan mahsulotlar
// qoldig'ini boshqarish. Menyu taomi (menu_items.inventory_item_id) ixtiyoriy
// ravishda bitta ombor mahsulotiga bog'lanishi mumkin — bog'langan bo'lsa,
// taomning is_available'i endi QO'LDA emas, shu yerdagi syncMenuAvailability()
// orqali qoldiqdan avtomatik hisoblanadi (qoldiq > 0 => mavjud, 0 => "tugadi").
//
// consume()/release() server/services/orders.js (afitsiant buyurtmasi) va
// server/routes/publicCustomerOrders.js (mijoz landing buyurtmasi) tomonidan
// chaqiriladi — ular allaqachon o'z db.transaction() ichida ishlaydi;
// better-sqlite3'da transaction() funksiyalari ichma-ich chaqirilsa avtomatik
// SAVEPOINT orqali ishlaydi, shuning uchun bu yerdagi har bir funksiya ham
// o'zining db.transaction()'i bilan xavfsiz — alohida ham, boshqa
// tranzaksiya ichida ham to'g'ri ishlaydi.
const { db, nowIso } = require('../db');

class InventoryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function getItemRow(id) {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id);
  if (!item) throw new InventoryError('Ombor mahsuloti topilmadi', 404);
  return item;
}

// Admin panelida ro'yxat — har bir mahsulotga bog'langan menyu taomlari nomini
// ham (GROUP_CONCAT bilan) qo'shib qaytaradi, frontend alohida so'rov
// yubormasin uchun.
function listItems({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE i.is_active = 1';
  return db
    .prepare(
      `SELECT i.*, c.name AS category_name,
              (SELECT GROUP_CONCAT(m.name, ', ') FROM menu_items m WHERE m.inventory_item_id = i.id AND m.is_active = 1) AS linked_menu_items,
              (SELECT COUNT(*) FROM menu_items m WHERE m.inventory_item_id = i.id AND m.is_active = 1) AS linked_menu_count
       FROM inventory_items i
       LEFT JOIN inventory_categories c ON c.id = i.category_id
       ${where}
       ORDER BY i.name COLLATE NOCASE`
    )
    .all();
}

// ---------------- Turkumlar (2026-09-26, faqat Ombor sahifasida ustunlarga
// ajratish uchun — menu_categories'dan mustaqil, pastdagi izohga qarang) ----------------

function listCategories() {
  return db.prepare('SELECT * FROM inventory_categories ORDER BY sort_order, id').all();
}

function createCategory({ name, sort_order }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new InventoryError('Turkum nomi kiritilishi shart');
  const ts = nowIso();
  const info = db
    .prepare('INSERT INTO inventory_categories (name, sort_order, created_at) VALUES (?, ?, ?)')
    .run(trimmed, Number(sort_order) || 0, ts);
  return db.prepare('SELECT * FROM inventory_categories WHERE id = ?').get(info.lastInsertRowid);
}

function updateCategory(id, { name, sort_order }) {
  const existing = db.prepare('SELECT * FROM inventory_categories WHERE id = ?').get(id);
  if (!existing) throw new InventoryError('Turkum topilmadi', 404);
  const trimmed = name !== undefined ? String(name).trim() : existing.name;
  if (!trimmed) throw new InventoryError('Turkum nomi kiritilishi shart');
  const sortOrder = sort_order !== undefined ? Number(sort_order) || 0 : existing.sort_order;
  db.prepare('UPDATE inventory_categories SET name = ?, sort_order = ? WHERE id = ?').run(trimmed, sortOrder, id);
  return db.prepare('SELECT * FROM inventory_categories WHERE id = ?').get(id);
}

// Turkumning o'zi harakat tarixiga ega emas (faqat guruhlash yorlig'i) — shu
// sabab boshqa jadvallardan (menu_categories/inventory_items) farqli o'laroq
// soft-delete kerak emas: unga bog'langan mahsulotlar avval "turkumsiz"
// (category_id=NULL) qilinadi, so'ng turkum bazadan butunlay o'chiriladi.
function deleteCategory(id) {
  const existing = db.prepare('SELECT * FROM inventory_categories WHERE id = ?').get(id);
  if (!existing) throw new InventoryError('Turkum topilmadi', 404);
  const run = db.transaction(() => {
    db.prepare('UPDATE inventory_items SET category_id = NULL, updated_at = ? WHERE category_id = ?').run(nowIso(), id);
    db.prepare('DELETE FROM inventory_categories WHERE id = ?').run(id);
  });
  run();
  return { ok: true };
}

// Manfiy bo'lmagan butun narx (so'm) — berilmagan/noto'g'ri bo'lsa fallback qaytadi.
function parseNonNegativeInt(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

// "Mavjudmi?" formulasi — bitta manba, avval bu yerda, adminMenu.js'da va
// syncMenuAvailability()/ensureMenuLink()'da 4 marta mustaqil takrorlangan
// edi (2026-09-09'da birlashtirildi). Ombor mahsuloti faol VA qoldiq
// musbat bo'lsagina bog'langan taom "mavjud" hisoblanadi.
function computeAvailability(item) {
  return item.is_active && item.quantity > 0 ? 1 : 0;
}

// Ombor mahsuloti menyuda hali hech qanday taomga bog'lanmagan bo'lsa — shu
// mahsulot asosida (nomi/hajmi/sotuv narxi) YANGI menyu taomini avtomatik
// yaratib, darhol bog'laydi. Allaqachon bog'langan bo'lsa (bitta yoki bir nechta
// taomga) — HECH NARSA QILMAYDI (jim o'tkazib yuboradi), takroriy/dublikat taom
// yaratilmasin uchun — bunday holatda admin taomni Menyu bo'limidan qo'lda
// boshqaradi (masalan bir nechta hajmga bo'lib sotish kerak bo'lsa).
function ensureMenuLink(inventoryItemId, categoryId) {
  const catId = Number(categoryId);
  if (!Number.isFinite(catId)) throw new InventoryError("Menyu bo'limi tanlanmagan");
  const category = db.prepare('SELECT id FROM menu_categories WHERE id = ?').get(catId);
  if (!category) throw new InventoryError("Menyu bo'limi topilmadi", 404);

  const alreadyLinked = db
    .prepare('SELECT 1 FROM menu_items WHERE inventory_item_id = ? AND is_active = 1 LIMIT 1')
    .get(inventoryItemId);
  if (alreadyLinked) return;

  const item = getItemRow(inventoryItemId);
  const ts = nowIso();
  const isAvailable = computeAvailability(item);
  // cost_price ham shu yerda darhol o'tkaziladi (2026-09-09'da tuzatildi —
  // ilgari bu ustun umuman kiritilmasdi, avtomatik yaratilgan taomning tan
  // narxi doim NULL bo'lib qolar, "foyda" ko'rsatkichi chiqmas edi, admin
  // buni Menyu bo'limidan qo'lda qayta saqlamaguncha).
  db.prepare(
    `INSERT INTO menu_items (category_id, name, price, cost_price, is_available, is_active, sort_order, volume, inventory_item_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`
  ).run(catId, item.name, item.sale_price, item.cost_price, isAvailable, item.volume, inventoryItemId, ts, ts);
}

// category_id — ixtiyoriy, Ombor sahifasida ustunlarga ajratish uchun
// (inventory_categories, MENU_category_id'dan MUSTAQIL — chalkashtirmaslik
// uchun parametr nomi ataylab boshqacha). image_url — ixtiyoriy, admin
// panelidagi POST /upload-image orqali oldindan yuklab olingan yo'l.
function createItem({ name, unit, quantity, low_stock_threshold, cost_price, sale_price, volume, menu_category_id, category_id, image_url }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new InventoryError('Nom kiritilishi shart');
  const unitVal = String(unit || '').trim() || 'dona';
  const qty = Number(quantity);
  const qtyVal = Number.isFinite(qty) && qty >= 0 ? Math.round(qty) : 0;
  const thresholdNum = Number(low_stock_threshold);
  const thresholdVal = Number.isFinite(thresholdNum) && thresholdNum >= 0 ? Math.round(thresholdNum) : 0;
  const costVal = parseNonNegativeInt(cost_price, 0);
  const saleVal = parseNonNegativeInt(sale_price, 0);
  const volumeVal = volume ? String(volume).trim() || null : null;
  const categoryIdVal = category_id ? Number(category_id) : null;
  const imageUrlVal = image_url ? String(image_url).trim() || null : null;
  const ts = nowIso();

  const run = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO inventory_items (name, unit, quantity, low_stock_threshold, cost_price, sale_price, volume, category_id, image_url, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(trimmedName, unitVal, qtyVal, thresholdVal, costVal, saleVal, volumeVal, categoryIdVal, imageUrlVal, ts, ts);
    // Boshlang'ich qoldiq bo'lsa ham harakat tarixida ko'rinishi uchun 'restock' yozuvi.
    if (qtyVal > 0) {
      db.prepare(
        `INSERT INTO inventory_movements (inventory_item_id, delta, reason, note, created_at)
         VALUES (?, ?, 'restock', ?, ?)`
      ).run(info.lastInsertRowid, qtyVal, "Boshlang'ich qoldiq", ts);
    }
    return info.lastInsertRowid;
  });

  const newId = run();
  // Admin "Menyu bo'limi" tanlagan bo'lsa — shu mahsulotni darhol menyuda
  // ko'rinadigan qilib qo'yamiz (qo'lda Menyu bo'limiga o'tib qayta yaratish
  // shart emas) — aynan shu narsa yo'qligi "omborga qo'shilgan ichimlik
  // menyuda chiqmayapti" muammosining sababi edi.
  //
  // ATAYLAB yuqoridagi asosiy tranzaksiyadan TASHQARIDA chaqiriladi
  // (2026-09-09'da tuzatildi) — ilgari bitta tranzaksiya ichida edi, shu
  // sabab menu_category_id eskirgan/noto'g'ri bo'lsa (masalan admin ekranida
  // kategoriya dropdown boshqa oynada o'chirilgan bo'lsa) ensureMenuLink()
  // otgan 404 xatosi ombor mahsulotining O'ZINI ham (allaqachon muvaffaqiyatli
  // yaratilgan) yo'qqa chiqarardi — admin kiritgan barcha ma'lumot yo'qolib,
  // faqat tushunarsiz "Menyu bo'limi topilmadi" xatosi qolardi. Endi mahsulot
  // har doim saqlanadi; bog'lash muvaffaqiyatsiz bo'lsa faqat ogohlantirish
  // (_link_warning) qaytariladi, admin buni ko'rib keyin qo'lda bog'lay oladi.
  let linkWarning = null;
  if (menu_category_id !== undefined && menu_category_id !== null && menu_category_id !== '') {
    try {
      ensureMenuLink(newId, menu_category_id);
    } catch (err) {
      linkWarning = err.message;
    }
  }
  const item = getItemRow(newId);
  return linkWarning ? { ...item, _link_warning: linkWarning } : item;
}

function updateItem(id, { name, unit, low_stock_threshold, is_active, cost_price, sale_price, volume, menu_category_id, category_id, image_url }) {
  const existing = getItemRow(id);
  const trimmedName = name !== undefined ? String(name).trim() : existing.name;
  if (!trimmedName) throw new InventoryError('Nom kiritilishi shart');
  const unitVal = unit !== undefined ? (String(unit).trim() || 'dona') : existing.unit;
  const thresholdNum = low_stock_threshold !== undefined ? Number(low_stock_threshold) : existing.low_stock_threshold;
  const thresholdVal = Number.isFinite(thresholdNum) && thresholdNum >= 0 ? Math.round(thresholdNum) : 0;
  const isActiveVal = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active;
  const costVal = cost_price !== undefined ? parseNonNegativeInt(cost_price, existing.cost_price) : existing.cost_price;
  const saleVal = sale_price !== undefined ? parseNonNegativeInt(sale_price, existing.sale_price) : existing.sale_price;
  const volumeVal = volume !== undefined ? (String(volume).trim() || null) : existing.volume;
  const categoryIdVal = category_id !== undefined ? (category_id ? Number(category_id) : null) : existing.category_id;
  const imageUrlVal = image_url !== undefined ? (String(image_url).trim() || null) : existing.image_url;

  const run = db.transaction(() => {
    db.prepare(
      'UPDATE inventory_items SET name = ?, unit = ?, low_stock_threshold = ?, is_active = ?, cost_price = ?, sale_price = ?, volume = ?, category_id = ?, image_url = ?, updated_at = ? WHERE id = ?'
    ).run(trimmedName, unitVal, thresholdVal, isActiveVal, costVal, saleVal, volumeVal, categoryIdVal, imageUrlVal, nowIso(), id);
    // is_active o'zgargan bo'lishi mumkin (o'chirilgan mahsulotga bog'langan taom
    // ham "tugadi" deb ko'rsatilishi kerak) — bog'liq taomlarni qayta sinxronlaymiz.
    syncMenuAvailability(id);
    // sale_price/cost_price o'zgargan bo'lishi mumkin — bog'langan taom(lar)ning
    // menyu narxi VA tan narxini shu yangi qiymatlarga moslaymiz (yagona manba —
    // menu.js'da qo'lda kiritilmaydi, adminMenu.js'da ham majburan shu yerdan
    // olinadi).
    syncMenuPricing(id);
  });
  run();
  // Hali hech qanday taomga bog'lanmagan (masalan avval "Menyu bo'limi"
  // tanlanmasdan yaratilgan) eski mahsulotni retroaktiv bog'lash imkoniyati —
  // ATAYLAB yuqoridagi tranzaksiyadan TASHQARIDA (createItem()'dagi bilan bir
  // xil sabab, 2026-09-09'da tuzatildi: eskirgan/noto'g'ri menu_category_id
  // endi mahsulotning boshqa (haqiqiy) o'zgarishlarini rad etib qo'ymaydi).
  let linkWarning = null;
  if (menu_category_id !== undefined && menu_category_id !== null && menu_category_id !== '') {
    try {
      ensureMenuLink(id, menu_category_id);
    } catch (err) {
      linkWarning = err.message;
    }
  }
  const item = getItemRow(id);
  return linkWarning ? { ...item, _link_warning: linkWarning } : item;
}

// Mahsulotga hech qanday harakat tarixi (inventory_movements) bo'lmasa — bazadan
// butunlay o'chiriladi (boshqa jadvallar bilan bir xil naqsh: categories/menu_items).
// Aks holda faqat is_active=0 (tarix saqlanadi). Ikkala holatda ham unga bog'langan
// menyu taomlari avtomatik "uzilib" (inventory_item_id=NULL) qo'yiladi — taom
// o'zi o'chirilmaydi, faqat endi qo'lda (PATCH /availability) boshqariladigan bo'lib
// qoladi, joriy mavjudlik holati o'zgarishsiz qoladi (admin keyin qo'lda tuzatadi).
function deleteItem(id) {
  const existing = getItemRow(id);
  let wasHardDeleted = false;
  const run = db.transaction(() => {
    const hasMovements = db.prepare('SELECT 1 FROM inventory_movements WHERE inventory_item_id = ? LIMIT 1').get(id);
    db.prepare('UPDATE menu_items SET inventory_item_id = NULL, updated_at = ? WHERE inventory_item_id = ?').run(nowIso(), id);
    if (!hasMovements) {
      db.prepare('DELETE FROM inventory_items WHERE id = ?').run(id);
      wasHardDeleted = true;
    } else {
      db.prepare('UPDATE inventory_items SET is_active = 0, updated_at = ? WHERE id = ?').run(nowIso(), id);
    }
  });
  run();
  // ESLATMA: `hard_deleted` maydoni ilgari (2026-09-26'gacha) chalkash tarzda
  // har doim `existing` snapshot'ini o'zi qaytarardi (ya'ni har doim "haqiqiy"
  // edi, soft-delete bo'lganda ham) — buni ombor rasmini o'chirish logikasi
  // (adminInventory.js) ishlatganda, soft-delete qilingan (hali "tiklash"
  // mumkin) mahsulotning rasmi ham noto'g'ri o'chib ketardi. Endi haqiqiy
  // boolean, snapshot esa alohida `item` maydonida.
  return { ok: true, hard_deleted: wasHardDeleted, item: existing };
}

// Bog'langan menyu taom(lar)ining is_available'ini joriy qoldiqdan qayta hisoblaydi.
function syncMenuAvailability(inventoryItemId) {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(inventoryItemId);
  if (!item) return;
  const available = computeAvailability(item);
  db.prepare('UPDATE menu_items SET is_available = ?, updated_at = ? WHERE inventory_item_id = ?').run(
    available, nowIso(), inventoryItemId
  );
}

// Bog'langan menyu taom(lar)ining narxini shu mahsulotning joriy sotuv narxiga
// tenglashtiradi — sale_price o'zgargan har safar (updateItem) chaqiriladi.
// server/routes/adminMenu.js ham taom omborga (qayta) bog'langanda shu qiymatni
// to'g'ridan-to'g'ri ishlatadi (mijoz/admin tomonidan yuborilgan narxga
// ISHONMASDAN) — bitta manba shu yerda.
function syncMenuPricing(inventoryItemId) {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(inventoryItemId);
  if (!item) return;
  // cost_price ham price bilan BIRGA yangilanadi (2026-09-09'da tuzatildi —
  // ilgari faqat price/sale_price yangilanardi, tan narx o'zgarganda menyudagi
  // "foyda" ko'rsatkichi/hisobotdagi COGS eskirgan qiymat bilan qolib ketardi).
  db.prepare('UPDATE menu_items SET price = ?, cost_price = ?, updated_at = ? WHERE inventory_item_id = ?').run(
    item.sale_price, item.cost_price, nowIso(), inventoryItemId
  );
}

// Admin qo'lda kirim/chiqim qiladi (masalan yangi partiya suv keldi, yoki
// buzilib chiqindiga ketdi). delta musbat = kirim, manfiy = chiqim. Chiqim
// natijada qoldiqni manfiyga tushirolmaydi.
function adjustStock(id, delta, { reason = 'adjustment', note, userId } = {}) {
  const deltaNum = Number(delta);
  if (!Number.isFinite(deltaNum) || !Number.isInteger(deltaNum) || deltaNum === 0) {
    throw new InventoryError("Miqdorni to'g'ri kiriting");
  }
  const run = db.transaction(() => {
    const item = getItemRow(id);
    const nextQty = item.quantity + deltaNum;
    if (nextQty < 0) {
      throw new InventoryError(`Yetarli qoldiq yo'q (hozir: ${item.quantity} ${item.unit})`);
    }
    const ts = nowIso();
    db.prepare('UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?').run(nextQty, ts, id);
    db.prepare(
      `INSERT INTO inventory_movements (inventory_item_id, delta, reason, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, deltaNum, reason, note || null, userId || null, ts);
    syncMenuAvailability(id);
  });
  run();
  return getItemRow(id);
}

// Inventarizatsiya (qo'lda fizik sanash) — Ombor auditi (2026-10-10): admin
// avval (qo'lda hisoblab) FARQNI o'zi kiritishi SHART emas, to'g'ridan-to'g'ri
// "haqiqatda nechta bor" sonini kiritadi, farq (`delta`) shu yerda avtomatik
// hisoblanadi va `reason='stocktake'` bilan yoziladi — oddiy qo'lda
// kirim/chiqimdan (adjustStock, reason='restock'/'adjustment'/'waste')
// ANIQ ajratilgan bo'lishi uchun.
function stocktake(id, actualQtyRaw, { note, userId } = {}) {
  const actualQty = Number(actualQtyRaw);
  if (!Number.isFinite(actualQty) || !Number.isInteger(actualQty) || actualQty < 0) {
    throw new InventoryError("Haqiqiy qoldiqni to'g'ri kiriting");
  }
  const item = getItemRow(id);
  const delta = actualQty - item.quantity;
  if (delta === 0) return item; // farq yo'q — yozuv shart emas
  return adjustStock(id, delta, { reason: 'stocktake', note, userId });
}

// Buyurtma (afitsiant yoki mijoz) shu ombor mahsulotidan `qty` dona sarflaydi.
// Yetarli qoldiq bo'lmasa OrderError-ga o'xshash InventoryError otadi (chaqiruvchi
// buni o'z transaction()i ichida ushlab, butun amalni bekor qiladi).
function consume(inventoryItemId, qty, { orderItemId, customerOrderItemId, userId, productName } = {}) {
  const qtyNum = Number(qty);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) return; // 0/manfiy — hech narsa qilinmaydi
  const run = db.transaction(() => {
    const item = getItemRow(inventoryItemId);
    if (item.quantity < qtyNum) {
      const label = productName || item.name;
      throw new InventoryError(`"${label}" omborda faqat ${item.quantity} ${item.unit} qoldi`);
    }
    const ts = nowIso();
    db.prepare('UPDATE inventory_items SET quantity = quantity - ?, updated_at = ? WHERE id = ?').run(qtyNum, ts, inventoryItemId);
    db.prepare(
      `INSERT INTO inventory_movements (inventory_item_id, delta, reason, order_item_id, customer_order_item_id, created_by, created_at)
       VALUES (?, ?, 'order', ?, ?, ?, ?)`
    ).run(inventoryItemId, -qtyNum, orderItemId || null, customerOrderItemId || null, userId || null, ts);
    syncMenuAvailability(inventoryItemId);
  });
  run();
}

// Bekor qilingan/kamaytirilgan buyurtma qatori uchun avval sarflangan qoldiqni
// omborga qaytaradi.
function release(inventoryItemId, qty, { orderItemId, customerOrderItemId, userId } = {}) {
  const qtyNum = Number(qty);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) return;
  const run = db.transaction(() => {
    const ts = nowIso();
    db.prepare('UPDATE inventory_items SET quantity = quantity + ?, updated_at = ? WHERE id = ?').run(qtyNum, ts, inventoryItemId);
    db.prepare(
      `INSERT INTO inventory_movements (inventory_item_id, delta, reason, order_item_id, customer_order_item_id, created_by, created_at)
       VALUES (?, ?, 'return', ?, ?, ?, ?)`
    ).run(inventoryItemId, qtyNum, orderItemId || null, customerOrderItemId || null, userId || null, ts);
    syncMenuAvailability(inventoryItemId);
  });
  run();
}

// Ombor sahifasi tepasidagi 4 ta ko'rsatkich — bitta SQL agregatsiya so'rovi
// (JS siklida emas), faqat faol mahsulotlar bo'yicha.
function getStats() {
  return db
    .prepare(
      `SELECT
         COUNT(*) AS item_count,
         COUNT(DISTINCT CASE WHEN category_id IS NOT NULL THEN category_id END) AS category_count,
         COALESCE(SUM(quantity * cost_price), 0) AS total_value,
         COALESCE(SUM(quantity * (sale_price - cost_price)), 0) AS expected_profit,
         COALESCE(SUM(CASE WHEN quantity <= 0 OR (low_stock_threshold > 0 AND quantity <= low_stock_threshold) THEN 1 ELSE 0 END), 0) AS low_stock_count
       FROM inventory_items
       WHERE is_active = 1`
    )
    .get();
}

function listMovements(inventoryItemId, limit = 50) {
  getItemRow(inventoryItemId); // 404 bo'lsa shu yerda otadi
  const lim = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 200) : 50;
  return db
    .prepare(
      `SELECT mv.*, COALESCE(u.full_name, u.username) AS created_by_name
       FROM inventory_movements mv
       LEFT JOIN users u ON u.id = mv.created_by
       WHERE mv.inventory_item_id = ?
       ORDER BY mv.id DESC
       LIMIT ?`
    )
    .all(inventoryItemId, lim);
}

module.exports = {
  InventoryError,
  listItems,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getItemRow,
  createItem,
  updateItem,
  deleteItem,
  syncMenuAvailability,
  syncMenuPricing,
  ensureMenuLink,
  computeAvailability,
  getStats,
  adjustStock,
  stocktake,
  consume,
  release,
  listMovements,
};
