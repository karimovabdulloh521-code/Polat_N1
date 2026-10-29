const express = require('express');
const { db, TASHKENT_SQL_OFFSET } = require('../db');
const { getReceipt } = require('../services/orders');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

function dateRange(query) {
  const from = query.from ? String(query.from).trim() : null;
  const to = query.to ? String(query.to).trim() : null;
  return { from, to };
}

router.get('/summary', asyncRoute((req, res) => {
  const { from, to } = dateRange(req.query);

  // Daromad — UCH buyurtma manbasi BIRGALIKDA hisoblanadi:
  //  - dine-in `orders`: status='closed' (hisob-kitob yopilgan), sana closed_at.
  //  - landing `customer_orders`: status='completed' (buyurtma bajarilgan),
  //    sana sifatida created_at ishlatiladi — bu jadvalda alohida "bajarilgan
  //    vaqt" ustuni yo'q (faqat created_at bor), shu sabab taxminiy sana.
  //  - `manual_bills` (kassir "Hisoblash" ekrani) — 2026-10-10'da qo'shildi:
  //    bu HAQIQIY qabul qilingan pul, lekin ilgari bu yerga umuman
  //    kiritilmagan edi, "Bugungi tushum"/hisobot real summadan kam
  //    ko'rsatardi (xavfsizlik auditida topilgan haqiqiy production bug).
  let revenueSql = `
    SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS orders_count FROM (
      SELECT total_amount, closed_at AS revenue_date FROM orders WHERE status = 'closed'
      UNION ALL
      SELECT total_amount, created_at AS revenue_date FROM customer_orders WHERE status = 'completed'
      UNION ALL
      SELECT total_amount, created_at AS revenue_date FROM manual_bills
    ) combined WHERE 1=1
  `;
  const revenueParams = [];
  // Toshkent (UTC+5) bo'yicha kun chegarasi — barcha vaqt ustuni UTC'da
  // saqlangani uchun to'g'ridan-to'g'ri `date(revenue_date)` mahalliy
  // soat 00:00-04:59 oralig'idagi yozuvlarni "kechagi kun"ga yozib
  // qo'yardi (2026-10-10 auditida topilgan, TASHKENT_SQL_OFFSET'ga qarang).
  if (from) { revenueSql += ` AND date(revenue_date, '${TASHKENT_SQL_OFFSET}') >= date(?)`; revenueParams.push(from); }
  if (to) { revenueSql += ` AND date(revenue_date, '${TASHKENT_SQL_OFFSET}') <= date(?)`; revenueParams.push(to); }
  const revenueRow = db.prepare(revenueSql).get(...revenueParams);

  let expenseSql = 'SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE 1=1';
  const expenseParams = [];
  if (from) { expenseSql += ' AND expense_date >= ?'; expenseParams.push(from); }
  if (to) { expenseSql += ' AND expense_date <= ?'; expenseParams.push(to); }
  const expenseRow = db.prepare(expenseSql).get(...expenseParams);

  // Sotilgan taomlarning tan narxi (COGS — cost of goods sold): har bir
  // yopilgan/bajarilgan buyurtma qatorini (bekor qilinmagan, active) shu
  // taomning JORIY tan narxiga (menu_items.cost_price, kiritilmagan bo'lsa 0)
  // ko'paytirib yig'indisi — ikkala buyurtma manbasi birgalikda (yuqoridagi
  // daromad bilan bir xil sabab). Tan narx snapshot emas — sotuv paytidagi
  // emas, HOZIRGI tan narx ishlatiladi (unit_price kabi alohida saqlanmaydi),
  // chunki cost_price funksiyasi 2026-09-08'da qo'shilgan va order_items'da
  // shunga mos ustun yo'q.
  let cogsSql = `
    SELECT COALESCE(SUM(qty * COALESCE(cost_price, 0)), 0) AS cogs FROM (
      SELECT oi.quantity AS qty, mi.cost_price AS cost_price, o.closed_at AS cogs_date
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE o.status = 'closed' AND oi.status = 'active'
      UNION ALL
      SELECT coi.quantity AS qty, mi.cost_price AS cost_price, co.created_at AS cogs_date
      FROM customer_order_items coi
      JOIN customer_orders co ON co.id = coi.customer_order_id
      JOIN menu_items mi ON mi.id = coi.menu_item_id
      WHERE co.status = 'completed'
    ) combined WHERE 1=1
  `;
  const cogsParams = [];
  if (from) { cogsSql += ` AND date(cogs_date, '${TASHKENT_SQL_OFFSET}') >= date(?)`; cogsParams.push(from); }
  if (to) { cogsSql += ` AND date(cogs_date, '${TASHKENT_SQL_OFFSET}') <= date(?)`; cogsParams.push(to); }
  const cogsRow = db.prepare(cogsSql).get(...cogsParams);

  // Qo'lda chek (kassir "Hisoblash") summasi — 2026-10-28 audit: `manual_bills`
  // daromadga (yuqorida) kiradi, lekin `manual_bill_items`da `menu_item_id`/
  // tan narx ustuni UMUMAN yo'q (kassir erkin nom+narx kiritadi, ataylab
  // menyuga bog'lanmagan), shu sabab COGS bu qismni hech qachon hisoblay
  // olmaydi — "Sof foyda" shu summa bo'yicha haqiqatdan ko'proq chiqishi
  // mumkin. Kodni to'g'rilab bo'lmagani uchun (haqiqiy tan narx ma'lumoti
  // yo'q), kamida UI'da ochiq ko'rsatiladi (pastga, reports.js'ga qarang).
  let manualSql = 'SELECT COALESCE(SUM(total_amount), 0) AS total FROM manual_bills WHERE 1=1';
  const manualParams = [];
  if (from) { manualSql += ` AND date(created_at, '${TASHKENT_SQL_OFFSET}') >= date(?)`; manualParams.push(from); }
  if (to) { manualSql += ` AND date(created_at, '${TASHKENT_SQL_OFFSET}') <= date(?)`; manualParams.push(to); }
  const manualRow = db.prepare(manualSql).get(...manualParams);

  // To'lov kutilayotgan (kassaga yuborilgan, lekin kassir hali to'lov turini
  // kiritmagan) dine-in hisoblar — 2026-10-24, "Moliyaviy aniqlik". Bular
  // `revenue`ga kiradi (status='closed'), lekin kassa smenasida ko'rinmaydi,
  // shu sabab alohida ko'rsatiladi. total_amount=0 (bo'sh yopilgan stol) sanalmaydi.
  let unpaidSql = `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS amount
    FROM orders WHERE status = 'closed' AND payment_method IS NULL AND total_amount > 0`;
  const unpaidParams = [];
  if (from) { unpaidSql += ` AND date(closed_at, '${TASHKENT_SQL_OFFSET}') >= date(?)`; unpaidParams.push(from); }
  if (to) { unpaidSql += ` AND date(closed_at, '${TASHKENT_SQL_OFFSET}') <= date(?)`; unpaidParams.push(to); }
  const unpaidRow = db.prepare(unpaidSql).get(...unpaidParams);

  res.json({
    revenue: revenueRow.revenue,
    unpaid_count: unpaidRow.cnt,
    unpaid_amount: unpaidRow.amount,
    paid_revenue: revenueRow.revenue - unpaidRow.amount,
    orders_count: revenueRow.orders_count,
    expenses_total: expenseRow.total,
    cost_of_goods: cogsRow.cogs,
    manual_bills_revenue: manualRow.total,
    net: revenueRow.revenue - cogsRow.cogs - expenseRow.total,
  });
}));

router.get('/orders', asyncRoute((req, res) => {
  const { from, to } = dateRange(req.query);
  const status = req.query.status && ['open', 'closed'].includes(req.query.status) ? req.query.status : null;
  let sql = `
    SELECT o.id, o.status, o.total_amount, o.opened_at, o.closed_at, t.name AS table_name,
           COALESCE(ou.full_name, ou.username) AS opened_by_name,
           COALESCE(cu.full_name, cu.username) AS closed_by_name
    FROM orders o
    JOIN tables t ON t.id = o.table_id
    JOIN users ou ON ou.id = o.opened_by
    LEFT JOIN users cu ON cu.id = o.closed_by
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  if (from) { sql += ` AND date(COALESCE(o.closed_at, o.opened_at), '${TASHKENT_SQL_OFFSET}') >= date(?)`; params.push(from); }
  if (to) { sql += ` AND date(COALESCE(o.closed_at, o.opened_at), '${TASHKENT_SQL_OFFSET}') <= date(?)`; params.push(to); }
  sql += ' ORDER BY o.id DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
}));

// Barcha to'lov kutilayotgan hisoblar (sanadan qat'i nazar) — admin bosh
// sahifasidagi ogohlantirish uchun. `bill_requested=1` — kassaga yuborilgan
// (normal oqim); `bill_requested=0` — eski, to'lov turisiz yopish yo'li
// (2026-10-24'da o'chirilgan) orqali yopilgan tarixiy yozuvlar.
router.get('/unpaid', asyncRoute((req, res) => {
  const rows = db.prepare(
    `SELECT o.id, o.total_amount, o.closed_at, o.bill_requested, t.name AS table_name,
            COALESCE(cu.full_name, cu.username) AS closed_by_name
     FROM orders o
     JOIN tables t ON t.id = o.table_id
     LEFT JOIN users cu ON cu.id = o.closed_by
     WHERE o.status = 'closed' AND o.payment_method IS NULL AND o.total_amount > 0
     ORDER BY o.closed_at ASC LIMIT 200`
  ).all();
  const totals = db.prepare(
    `SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS amount
     FROM orders WHERE status = 'closed' AND payment_method IS NULL AND total_amount > 0`
  ).get();
  res.json({ count: totals.cnt, amount: totals.amount, items: rows });
}));

router.get('/orders/:id/receipt', asyncRoute((req, res) => {
  res.json(getReceipt(req.params.id));
}));

module.exports = router;
