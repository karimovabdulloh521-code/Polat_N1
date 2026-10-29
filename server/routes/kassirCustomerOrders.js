// Kassir uchun mijoz (landing/onlayn) buyurtmalarini FAQAT O'QISH uchun
// ko'rsatadigan API — 2026-10-18 (3), foydalanuvchi so'rovi: oshxona
// printeridan chiqqan mijoz buyurtmasi haqida kassir ham (dastavkachi kabi)
// o'z ekranida xabardor bo'lsin. Kassir bu yerda hech narsani o'zgartira
// olmaydi (holat/bekor qilish/biriktirish — bularning barchasi admin
// huquqida, server/routes/adminCustomerOrders.js) — faqat ko'radi.
const express = require('express');
const { db } = require('../db');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

router.get('/customer-orders', asyncRoute((req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM customer_orders WHERE status != 'cancelled' ORDER BY id DESC LIMIT 100`
    )
    .all();
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

module.exports = router;
