// Kassir (kassa/hisob-kitob) ekrani uchun API — 2026-09-09'da qo'shildi.
// Faqat 'kassir' va 'admin' roliga ochiq (server/index.js'da
// requireRole(['admin','kassir']) bilan ulanadi). Afitsiantdan farqli —
// kassir taom QO'SHA OLMAYDI (menyuni ko'rmaydi), faqat: stollar ro'yxatini
// ko'radi, joriy buyurtmani (o'qish uchun) ko'radi, hisob-kitob qilib
// (stolni yopish) chek chiqaradi. Bularning barchasi allaqachon mavjud
// server/services/orders.js xizmat qatlamidan foydalanadi — afitsiant bilan
// bir xil ma'lumot/mantiq, faqat "taom qo'shish" yo'q.
const express = require('express');
const { db } = require('../db');
const {
  listTablesOverview,
  getOpenOrderForTable,
  closeTable,
  cancelEmptyOrder,
  getReceipt,
  listPendingCashierBills,
  payPendingBill,
} = require('../services/orders');
const { asyncRoute } = require('../routeUtils');
const cashShifts = require('../services/cashShifts');

const router = express.Router();

router.get('/tables', asyncRoute((req, res) => {
  res.json(listTablesOverview());
}));

router.get('/tables/:id/order', asyncRoute((req, res) => {
  const view = getOpenOrderForTable(req.params.id);
  res.json(view); // null bo'lishi mumkin — frontend "ochiq buyurtma yo'q" holatini shunday biladi
}));

// To'lov turi (naqd/karta/aralash) — kassa smenasi auditi (2026-10-10):
// kassir uchun MAJBURIY (afitsiant `waiterOrders.js` orqali yopsa, bu
// ustun umuman so'ralmaydi — eski xulq-atvor o'zgarishsiz). Jami summa
// avval (hali yopilmagan buyurtmadan) olinib, naqd+karta shunga teng
// bo'lishi tekshiriladi.
router.post('/tables/:id/close', asyncRoute((req, res) => {
  const view = getOpenOrderForTable(req.params.id);
  if (!view) return res.status(404).json({ error: "Bu stolda ochiq buyurtma yo'q" });
  const paymentInfo = cashShifts.validatePaymentInfo(view.total, req.body || {});
  const receipt = closeTable(req.params.id, req.user.id, paymentInfo);
  res.json(receipt);
}));

// Faol taomi qolmagan (afitsiant hammasini bekor qilgan) ochiq buyurtmani
// hisob-kitobsiz yopib, stolni bo'shatadi — closeTable() bo'sh chekni rad
// etgani uchun, aks holda stol abadiy "band" bo'lib qolar edi va kassir buni
// hech qanday tuzata olmasdi (services/orders.js'dagi cancelEmptyOrder()
// izohiga qarang).
router.post('/tables/:id/cancel-order', asyncRoute((req, res) => {
  const view = cancelEmptyOrder(req.params.id, req.user.id);
  res.json(view);
}));

// Afitsiant yuborgan, hali to'lanmagan hisoblar ("Hisob-kitob → kassaga"
// oqimi, 2026-10-15) — server/services/orders.js'dagi requestBillToCashier()
// shu navbatga yozadi (orders.status='closed' AND bill_requested=1 AND
// payment_method IS NULL).
router.get('/pending-bills', asyncRoute((req, res) => {
  res.json(listPendingCashierBills());
}));

router.post('/bills/:orderId/pay', asyncRoute((req, res) => {
  const order = db.prepare('SELECT total_amount FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Hisob topilmadi' });
  const paymentInfo = cashShifts.validatePaymentInfo(order.total_amount, req.body || {});
  const receipt = payPendingBill(req.params.orderId, req.user.id, paymentInfo);
  res.json(receipt);
}));

router.get('/tables/:id/receipt/latest', asyncRoute((req, res) => {
  const order = db
    .prepare('SELECT id FROM orders WHERE table_id = ? ORDER BY id DESC LIMIT 1')
    .get(req.params.id);
  if (!order) return res.status(404).json({ error: "Bu stol uchun hali buyurtma bo'lmagan" });
  res.json(getReceipt(order.id));
}));

router.get('/orders/:id/receipt', asyncRoute((req, res) => {
  res.json(getReceipt(req.params.id));
}));

module.exports = router;
