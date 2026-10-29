// Dastavkachi (courier) ekrani uchun o'qish-og'irlikli API. Faqat 'courier' va
// 'admin' roliga ochiq (server/index.js'da requireRole(['admin','courier'])
// bilan ulanadi). Faqat "yetkazib berish" (fulfillment='delivery') turidagi
// mijoz buyurtmalari bilan ishlaydi — dine-in `orders` jadvaliga umuman
// tegmaydi (afitsiant/oshpaz hududi).
//
// MUHIM: `customer_orders.status` maydoni allaqachon oshpaz tomonidan
// "tayyor" ma'nosida ishlatiladi (server/routes/chefKitchen.js, 'completed' =
// taom tayyor). Shu sabab dastavkachining "yetkazdim" belgisi ATAYLAB alohida
// `delivered_at` ustunida saqlanadi (status'ga tegilmaydi) — ikkalasi bir xil
// qiymatni ikki xil ma'noda band qilib qolmasin uchun.
const express = require('express');
const { db, nowIso } = require('../db');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

// 2026-09-09'da tuzatildi: ilgari har bir buyurtma uchun alohida items
// so'rovi yuborilardi (N+1) — bu ekran har 15 soniyada poll qilingani uchun
// buyurtmalar soni ortgan sari DB'ga ketma-ket so'rovlar soni ham
// proporsional o'sib borardi. Endi items bitta IN(...) so'rov bilan olinib,
// JS tomonida guruhlanadi — buyurtmalar soni qancha bo'lmasin doim 2 ta so'rov.
router.get('/orders', asyncRoute((req, res) => {
  // 2026-10-10 (xavfsizlik auditi): kuryer endi FAQAT o'ziga biriktirilgan
  // YOKI hali hech kimga biriktirilmagan (assigned_courier_id IS NULL)
  // buyurtmalarni ko'radi — admin esa (bu yo'lga ham kira oladi) hamon
  // barchasini ko'radi, chunki boshqarish/biriktirish ishi uning o'zida.
  // Admin hech qachon biriktirmasa (NULL qoladi) — eski xulq-atvor (hamma
  // kuryer hammasini ko'radi) saqlanib qoladi, hech narsa buzilmaydi.
  const isAdmin = req.user.role === 'admin';
  const rows = db
    .prepare(
      `SELECT * FROM customer_orders
       WHERE fulfillment = 'delivery' AND status != 'cancelled'
         ${isAdmin ? '' : 'AND (assigned_courier_id IS NULL OR assigned_courier_id = ?)'}
       ORDER BY (delivered_at IS NOT NULL), id DESC`
    )
    .all(...(isAdmin ? [] : [req.user.id]));
  if (rows.length === 0) return res.json([]);
  const ids = rows.map((o) => o.id);
  const placeholders = ids.map(() => '?').join(',');
  const allItems = db
    .prepare(`SELECT * FROM customer_order_items WHERE customer_order_id IN (${placeholders})`)
    .all(...ids);
  const itemsByOrder = new Map();
  for (const it of allItems) {
    if (!itemsByOrder.has(it.customer_order_id)) itemsByOrder.set(it.customer_order_id, []);
    itemsByOrder.get(it.customer_order_id).push(it);
  }
  res.json(rows.map((o) => ({ ...o, items: itemsByOrder.get(o.id) || [] })));
}));

router.put('/orders/:id/deliver', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (existing.fulfillment !== 'delivery') {
    return res.status(400).json({ error: "Bu buyurtma yetkazib berish turida emas" });
  }
  // 2026-10-10, "Rollar va ruxsatlar" auditi (IDOR) — yuqoridagi GET /orders
  // ro'yxati allaqachon boshqa kuryerga biriktirilgan buyurtmani yashiradi
  // (2026-10-10 (1) tuzatishi), lekin bu YAKKA amal ID orqali chaqirilsa
  // (ro'yxatda ko'rinmasa ham) tekshiruvsiz edi — boshqa kuryerga
  // biriktirilgan buyurtmani ham "yetkazdim" deb belgilab qo'yish mumkin edi.
  if (req.user.role !== 'admin' && existing.assigned_courier_id && existing.assigned_courier_id !== req.user.id) {
    return res.status(403).json({ error: 'Bu buyurtma boshqa kuryerga biriktirilgan' });
  }
  if (existing.status !== 'completed') {
    return res.status(400).json({ error: "Buyurtma hali tayyor emas (oshxona tomonidan tasdiqlanmagan)" });
  }
  if (existing.delivered_at) {
    return res.status(400).json({ error: 'Bu buyurtma allaqachon yetkazilgan deb belgilangan' });
  }
  db.prepare('UPDATE customer_orders SET delivered_at = ? WHERE id = ?').run(nowIso(), req.params.id);
  res.json(db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(req.params.id));
}));

module.exports = router;
