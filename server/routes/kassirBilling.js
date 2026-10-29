// Kassir "Hisoblash" (qo'lda chek) + "Statistika" (yopilgan hisoblar ro'yxati)
// bo'limlari uchun API — 2026-09-09'da qo'shildi. server/index.js'da
// kassirTables.js bilan BIR XIL '/api/kassir' prefiksiga (alohida
// requireRole(['admin','kassir'])) ulanadi — ikkala router ham shu yo'l
// ostida, marshrutlari kesishmaydi (bu yerda /manual-bills* va /bills,
// kassirTables.js'da /tables*).
const express = require('express');
const { db, TASHKENT_SQL_OFFSET } = require('../db');
const { asyncRoute, createIdempotencyGuard } = require('../routeUtils');
const manualBills = require('../services/manualBills');

const router = express.Router();
const withIdempotency = createIdempotencyGuard();

// To'lov turi (naqd/karta/aralash) — kassa smenasi auditi (2026-10-10):
// MAJBURIY, shu sabab har doim (bo'sh bo'lsa ham) obyekt sifatida uzatiladi —
// `manualBills.createManualBill()` ichida `cashShifts.validatePaymentInfo()`
// `payment_method` yo'qligini ko'rib xato qaytaradi.
router.post('/manual-bills', asyncRoute((req, res) => {
  const idempotencyKey = typeof req.body?.idempotency_key === 'string' ? req.body.idempotency_key : null;
  const paymentInfo = {
    payment_method: req.body.payment_method,
    cash_amount: req.body.cash_amount,
    card_amount: req.body.card_amount,
  };
  const receipt = withIdempotency(idempotencyKey, () =>
    manualBills.createManualBill(req.body.items, req.user.id, req.body.customer_phone, req.body.note, req.body.delivery_price, req.body.reason, paymentInfo)
  );
  res.status(201).json(receipt);
}));

router.get('/manual-bills/:id/receipt', asyncRoute((req, res) => {
  res.json(manualBills.getManualBillReceipt(req.params.id));
}));

function dateRange(query) {
  const from = query.from ? String(query.from).trim() : null;
  const to = query.to ? String(query.to).trim() : null;
  return { from, to };
}

// Kassirning "Statistika" ekrani uchun: ikkala yopilgan-hisob manbasi
// (dine-in `orders`, stol hisob-kitobi — afitsiant HAM yopgan bo'lishi
// mumkin — va shu yerdagi `manual_bills`, qo'lda chek) birlashtirilib,
// vaqt bo'yicha kamayish tartibida qaytariladi. Har biri o'z cheki uchun
// (kind='table' -> GET /kassir/orders/:id/receipt, kind='manual' ->
// GET /kassir/manual-bills/:id/receipt) qayta ochilishi mumkin.
router.get('/bills', asyncRoute((req, res) => {
  const { from, to } = dateRange(req.query);

  let tableSql = `
    SELECT o.id AS id, 'table' AS kind, t.name AS label, o.total_amount AS total_amount,
           o.closed_at AS at, COALESCE(cu.full_name, cu.username) AS by_name, NULL AS phone,
           NULL AS reason
    FROM orders o
    JOIN tables t ON t.id = o.table_id
    LEFT JOIN users cu ON cu.id = o.closed_by
    WHERE o.status = 'closed'
  `;
  const tableParams = [];
  // Toshkent (UTC+5) bo'yicha kun chegarasi (2026-10-10 auditida topilgan —
  // TASHKENT_SQL_OFFSET'ga qarang, server/db.js).
  if (from) { tableSql += ` AND date(o.closed_at, '${TASHKENT_SQL_OFFSET}') >= date(?)`; tableParams.push(from); }
  if (to) { tableSql += ` AND date(o.closed_at, '${TASHKENT_SQL_OFFSET}') <= date(?)`; tableParams.push(to); }

  let manualSql = `
    SELECT mb.id AS id, 'manual' AS kind, 'Qo''lda hisoblash' AS label, mb.total_amount AS total_amount,
           mb.created_at AS at, COALESCE(u.full_name, u.username) AS by_name, mb.customer_phone AS phone,
           mb.reason AS reason
    FROM manual_bills mb
    JOIN users u ON u.id = mb.created_by
    WHERE 1=1
  `;
  const manualParams = [];
  if (from) { manualSql += ` AND date(mb.created_at, '${TASHKENT_SQL_OFFSET}') >= date(?)`; manualParams.push(from); }
  if (to) { manualSql += ` AND date(mb.created_at, '${TASHKENT_SQL_OFFSET}') <= date(?)`; manualParams.push(to); }

  const combined = [
    ...db.prepare(tableSql).all(...tableParams),
    ...db.prepare(manualSql).all(...manualParams),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, 300);

  const totalAmount = combined.reduce((sum, r) => sum + (r.total_amount || 0), 0);
  res.json({ bills: combined, total_amount: totalAmount, count: combined.length });
}));

module.exports = router;
