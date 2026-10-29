// To'lov turisiz yopilgan dine-in hisoblarni sanaydi — FAQAT O'QISH, bazaga
// hech narsa yozmaydi (2026-10-24, "Moliyaviy aniqlik").
// Ishga tushirish (loyiha papkasida):  node scripts/tolanmagan-hisoblar.js
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'data', 'polat.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const base = `FROM orders o JOIN tables t ON t.id = o.table_id
  WHERE o.status = 'closed' AND o.payment_method IS NULL AND o.total_amount > 0`;

const groups = db.prepare(
  `SELECT o.bill_requested AS bill_requested, COUNT(*) AS cnt, SUM(o.total_amount) AS amount,
          MIN(o.closed_at) AS first_at, MAX(o.closed_at) AS last_at ${base}
   GROUP BY o.bill_requested`
).all();

const fmt = (n) => Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";
if (groups.length === 0) {
  console.log("✅ To'lov turisiz yopilgan hisob yo'q.");
} else {
  for (const g of groups) {
    const label = g.bill_requested
      ? "Kassaga yuborilgan, kassir hali to'lamagan"
      : "Eski usulda (to'lov turisiz) yopilgan";
    console.log(`${label}: ${g.cnt} ta, ${fmt(g.amount)} (${g.first_at} — ${g.last_at})`);
  }
  console.log('\nOxirgi 20 tasi:');
  for (const r of db.prepare(`SELECT o.id, t.name AS stol, o.total_amount, o.closed_at, o.bill_requested ${base} ORDER BY o.closed_at DESC LIMIT 20`).all()) {
    console.log(`  #${r.id}  ${r.stol}  ${fmt(r.total_amount)}  ${r.closed_at}  ${r.bill_requested ? 'kassada' : 'eski usul'}`);
  }
}
db.close();
