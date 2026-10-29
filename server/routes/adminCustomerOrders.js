const express = require('express');
const { db } = require('../db');
const { asyncRoute } = require('../routeUtils');
const inventory = require('../services/inventory');

const router = express.Router();

router.get('/', asyncRoute((req, res) => {
  const orders = db
    .prepare(
      `SELECT co.*, COALESCE(cu.full_name, cu.username) AS assigned_courier_name
       FROM customer_orders co
       LEFT JOIN users cu ON cu.id = co.assigned_courier_id
       ORDER BY co.id DESC`
    )
    .all();
  const itemsStmt = db.prepare('SELECT * FROM customer_order_items WHERE customer_order_id = ?');
  res.json(orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) })));
}));

// Faol dastavkachilar ro'yxati — admin panelida yetkazib berish buyurtmasiga
// kuryer biriktirish uchun (2026-10-10, xavfsizlik auditi: ilgari biriktirish
// konsepsiyasi umuman yo'q edi, server/routes/courierOrders.js'ga qarang).
router.get('/couriers', asyncRoute((req, res) => {
  res.json(
    db.prepare("SELECT id, username, full_name FROM users WHERE role = 'courier' AND is_active = 1 ORDER BY username").all()
  );
}));

// Yetkazib berish buyurtmasini ma'lum dastavkachiga biriktiradi (yoki `null`
// bilan biriktirishni bekor qiladi — shundan keyin yana BARCHA kuryerga
// ko'rinadi, eski xulq-atvor). Faqat haqiqiy, faol 'courier' foydalanuvchiga
// biriktirish mumkin.
router.put('/:id/assign-courier', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  const courierId = req.body?.courier_id;
  if (courierId === null || courierId === undefined) {
    db.prepare('UPDATE customer_orders SET assigned_courier_id = NULL WHERE id = ?').run(req.params.id);
  } else {
    const courier = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'courier' AND is_active = 1").get(courierId);
    if (!courier) return res.status(400).json({ error: 'Bunday faol dastavkachi topilmadi' });
    db.prepare('UPDATE customer_orders SET assigned_courier_id = ? WHERE id = ?').run(courier.id, req.params.id);
  }
  res.json(db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(req.params.id));
}));

// Ombordan (suv/salfetka va h.k.) sarflangan miqdorni qaytaradi/qayta ayiradi —
// buyurtma qatorlariga bog'langan har bir ombor mahsuloti uchun.
//
// 2026-09-09'da tuzatildi (avval ikkita real bug bor edi):
//  1) Ombor faqat existing.status !== 'cancelled' shartida qaytarilardi — bu
//     DELETE handleridagi (pastda) 'completed' istisnosiga mos kelmasdi, shu
//     sabab allaqachon 'completed' (kuryer yetkazgan/tayyorlangan) buyurtma
//     bekor qilinganda ombor NOTO'G'RI qaytarilardi (real qoldiqdan ko'proq
//     ko'rsatilib, keyinchalik ortiqcha sotish xavfini keltirib chiqarardi).
//  2) Bekor qilingan buyurtma qaytadan faollashtirilganda (masalan xato bosib
//     bekor qilingan buyurtmani "tasdiqlash"ga qaytarish) ombor UMUMAN qayta
//     yechilmasdi — endi consumeStockForCustomerOrder() shu holatni qamrab
//     oladi (yetarli qoldiq bo'lmasa InventoryError otadi, butun status
//     o'zgarishi bekor qilinadi — xuddi yangi buyurtma yaratishdagi kabi).
function returnStockForCustomerOrder(orderId) {
  const items = db
    .prepare(
      `SELECT coi.id AS customer_order_item_id, coi.quantity, m.inventory_item_id
       FROM customer_order_items coi
       JOIN menu_items m ON m.id = coi.menu_item_id
       WHERE coi.customer_order_id = ? AND m.inventory_item_id IS NOT NULL`
    )
    .all(orderId);
  for (const it of items) {
    inventory.release(it.inventory_item_id, it.quantity, { customerOrderItemId: it.customer_order_item_id });
  }
}

function consumeStockForCustomerOrder(orderId) {
  const items = db
    .prepare(
      `SELECT coi.id AS customer_order_item_id, coi.quantity, m.inventory_item_id, m.name AS product_name
       FROM customer_order_items coi
       JOIN menu_items m ON m.id = coi.menu_item_id
       WHERE coi.customer_order_id = ? AND m.inventory_item_id IS NOT NULL`
    )
    .all(orderId);
  for (const it of items) {
    inventory.consume(it.inventory_item_id, it.quantity, {
      customerOrderItemId: it.customer_order_item_id,
      productName: it.product_name,
    });
  }
}

// Qaysi holatdan qaysi holatga o'tish mumkinligi (2026-10-10, "Buyurtma
// oqimi" auditi: ilgari CHECK qiymat ro'yxati tekshirilsa ham, TARTIB
// umuman tekshirilmasdi — masalan 'completed'ni to'g'ridan-to'g'ri 'new'ga
// qaytarish mumkin edi). Ro'yxat production'da haqiqatan ishlatilgan
// o'tishlarga mos (CLAUDE.md tarixi: 'cancelled'->'confirmed' qayta
// faollashtirish ataylab qo'llab-quvvatlanadi).
const ALLOWED_STATUS_TRANSITIONS = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: ['cancelled'],
  cancelled: ['new', 'confirmed'],
};

router.put('/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  const status = req.body?.status;
  if (!['new', 'confirmed', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: "Holatni to'g'ri tanlang" });
  }
  if (status !== existing.status && !ALLOWED_STATUS_TRANSITIONS[existing.status]?.includes(status)) {
    return res.status(400).json({ error: `'${existing.status}'dan '${status}'ga o'tish mumkin emas` });
  }
  const cancelReason = status === 'cancelled'
    ? (String(req.body?.cancel_reason || '').trim() || null)
    : (status === existing.status ? existing.cancel_reason : null);
  const run = db.transaction(() => {
    db.prepare('UPDATE customer_orders SET status = ?, cancel_reason = ? WHERE id = ?').run(status, cancelReason, req.params.id);
    // 'completed' bo'lgan buyurtma (DELETE handleridagi bilan bir xil qoida —
    // taom allaqachon tayyorlangan/sarflangan deb hisoblanadi) bekor qilinsa
    // ombor QAYTARILMAYDI. Faqat hali 'completed'ga yetmagan ('new'/'confirmed')
    // buyurtma bekor qilinganda qaytariladi.
    if (status === 'cancelled' && existing.status !== 'cancelled' && existing.status !== 'completed') {
      returnStockForCustomerOrder(req.params.id);
    } else if (status !== 'cancelled' && existing.status === 'cancelled') {
      // Bekor qilingan buyurtma qayta faollashtirilmoqda — avval qaytarilgan
      // ombor endi qayta sarflanadi (yetarli qoldiq bo'lmasa InventoryError
      // butun tranzaksiyani bekor qiladi, status ham o'zgarmaydi).
      consumeStockForCustomerOrder(req.params.id);
    }
  });
  run();
  res.json(db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(req.params.id));
}));

// 2026-10-10 ("Buyurtma oqimi" auditi, foydalanuvchi tasdig'i bilan): endi
// FAQAT avval 'cancelled' qilingan buyurtmani o'chirish mumkin — "bekor
// qilingan buyurtma o'chirilmaydi, holat+sabab bilan saqlanadi" tamoyiliga
// mos bo'lsin uchun yangi/tasdiqlangan/tayyor buyurtma to'g'ridan-to'g'ri
// o'chirilib, tarixi yo'qolib ketmasin deb (avval `PUT /:id` bilan
// `status:'cancelled'` qilinishi, sabab bilan birga, talab qilinadi).
router.delete('/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (existing.status !== 'cancelled') {
    return res.status(400).json({ error: "Faqat avval \"Bekor qilish\" bilan bekor qilingan buyurtmani o'chirish mumkin" });
  }
  const run = db.transaction(() => {
    // 'cancelled' holatida ombor allaqachon qaytarilgan bo'lishi kerak (PUT
    // /:id'dagi mantiq), shu sabab bu yerda qayta qaytarilmaydi.
    db.prepare('DELETE FROM customer_order_items WHERE customer_order_id = ?').run(req.params.id);
    db.prepare('DELETE FROM customer_orders WHERE id = ?').run(req.params.id);
  });
  run();
  res.json({ ok: true });
}));

module.exports = router;
