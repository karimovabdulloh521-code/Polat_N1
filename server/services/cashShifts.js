// Kassir smenasi (ochish/yopish, naqd farqi) — "Moliya va kassa" auditi
// (2026-10-10). Faqat kassir (va admin) tomonidan ishlatiladi. Bitta
// foydalanuvchi bir vaqtda faqat bitta ochiq smenaga ega bo'lishi
// server/services/orders.js'dagi "bitta stolda bitta ochiq buyurtma" bilan
// bir xil naqsh orqali ta'minlanadi: db.transaction() ichida avval SELECT
// bilan tekshirilib, DB unique indeks shart emas (bitta Node jarayon +
// sinxron better-sqlite3 haqiqiy race'ni fizik imkonsiz qiladi).
const { db, nowIso } = require('../db');

class ShiftError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function sanitizeMoney(raw, fieldName) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ShiftError(`${fieldName} noto'g'ri`);
  }
  return Math.round(n);
}

function getCurrentShift(userId) {
  return db.prepare("SELECT * FROM cash_shifts WHERE opened_by = ? AND status = 'open'").get(userId) || null;
}

// Haqiqiy to'lov qabul qilinayotgan har bir joyda (stol yopish, kassadagi
// hisobni to'lash, qo'lda chek) MAJBURIY chaqiriladi — aks holda smena
// ochilmagan holda qabul qilingan naqd/karta pul `cash_shift_id = NULL`
// bilan saqlanib, hech qaysi smenaning kutilgan summasiga kirmay, hech qachon
// kamomad/ortiqcha sifatida ko'rinmasdan "yo'qolib" qolardi (2026-10-28 audit
// bilan topildi — avval bu yerda faqat ixtiyoriy getCurrentShift() bor edi).
function requireOpenShift(userId) {
  const shift = getCurrentShift(userId);
  if (!shift) {
    throw new ShiftError("Avval smena oching (\"Hisoblash\" yoki \"Stollar\" bo'limidagi \"Smena ochish\"), keyin to'lov qabul qiling", 409);
  }
  return shift;
}

function openShift(userId, openingCashRaw) {
  const openingCash = sanitizeMoney(openingCashRaw, 'Boshlang\'ich naqd summa');
  const run = db.transaction(() => {
    const existing = getCurrentShift(userId);
    if (existing) throw new ShiftError('Sizda allaqachon ochiq smena bor');
    const info = db
      .prepare('INSERT INTO cash_shifts (opened_by, opened_at, opening_cash, status) VALUES (?, ?, ?, \'open\')')
      .run(userId, nowIso(), openingCash);
    return info.lastInsertRowid;
  });
  // DIQQAT: avval run()ni chaqirish SHART — `getCurrentShift(userId) || run()`
  // ko'rinishidagi yozuv `||` short-circuit tufayli (agar smena ALLAQACHON
  // ochiq bo'lsa, run() UMUMAN chaqirilmay, xato ham tashlanmay, eski smena
  // "muvaffaqiyatli" qaytib ketadi) xato edi — haqiqiy HTTP testda topildi.
  const id = run();
  return db.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(id);
}

// Shu smenaga biriktirilgan (cash_shift_id) barcha naqd to'lovlar yig'indisi
// + boshlang'ich naqd — "kutilgan" summa. Faqat cash_amount hisoblanadi,
// card_amount jismoniy kassaga ta'sir qilmaydi.
function computeExpectedCash(shift) {
  const fromOrders = db
    .prepare("SELECT COALESCE(SUM(cash_amount), 0) AS s FROM orders WHERE cash_shift_id = ?")
    .get(shift.id).s;
  const fromManualBills = db
    .prepare("SELECT COALESCE(SUM(cash_amount), 0) AS s FROM manual_bills WHERE cash_shift_id = ?")
    .get(shift.id).s;
  return shift.opening_cash + fromOrders + fromManualBills;
}

function closeShift(shiftId, userId, actualCashRaw, { isAdmin = false } = {}) {
  const actualCash = sanitizeMoney(actualCashRaw, 'Haqiqiy naqd summa');
  const run = db.transaction(() => {
    const shift = db.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(shiftId);
    if (!shift) throw new ShiftError('Smena topilmadi', 404);
    // 2026-10-10, "Rollar va ruxsatlar" auditi (IDOR) — ilgari HECH QANDAY
    // egalik tekshiruvi yo'q edi: istalgan kassir istalgan (boshqa kassirning)
    // ochiq smenasini o'z xohlagan "haqiqiy naqd" summasi bilan yopa olardi —
    // naqd kamomadini yashirish uchun ishlatilishi mumkin edi. Admin bundan
    // mustasno (nazorat/tuzatish uchun kerak bo'lishi mumkin).
    if (!isAdmin && shift.opened_by !== userId) {
      throw new ShiftError("Faqat o'zingiz ochgan smenani yopa olasiz", 403);
    }
    if (shift.status !== 'open') throw new ShiftError('Bu smena allaqachon yopilgan');
    const expectedCash = computeExpectedCash(shift);
    const variance = actualCash - expectedCash;
    db.prepare(
      `UPDATE cash_shifts SET status = 'closed', closed_by = ?, closed_at = ?,
       expected_cash = ?, actual_cash = ?, variance = ? WHERE id = ?`
    ).run(userId, nowIso(), expectedCash, actualCash, variance, shiftId);
    return shiftId;
  });
  return db.prepare('SELECT * FROM cash_shifts WHERE id = ?').get(run());
}

function listShifts() {
  return db
    .prepare(
      `SELECT cs.*, COALESCE(ou.full_name, ou.username) AS opened_by_name,
              COALESCE(cu.full_name, cu.username) AS closed_by_name
       FROM cash_shifts cs
       JOIN users ou ON ou.id = cs.opened_by
       LEFT JOIN users cu ON cu.id = cs.closed_by
       ORDER BY cs.id DESC LIMIT 200`
    )
    .all();
}

// Kassir route'laridan (kassirTables.js/kassirBilling.js) chaqiriladi —
// to'lov ma'lumotini tekshiradi va `{payment_method, cash_amount,
// card_amount}` ko'rinishida qaytaradi (yoki ShiftError otadi).
function validatePaymentInfo(total, raw) {
  const method = raw && raw.payment_method;
  if (!['cash', 'card', 'mixed'].includes(method)) {
    throw new ShiftError("To'lov turini tanlang (naqd/karta/aralash)");
  }
  let cashAmount;
  let cardAmount;
  if (method === 'cash') {
    cashAmount = total;
    cardAmount = 0;
  } else if (method === 'card') {
    cashAmount = 0;
    cardAmount = total;
  } else {
    cashAmount = sanitizeMoney(raw.cash_amount, 'Naqd summa');
    cardAmount = sanitizeMoney(raw.card_amount, 'Karta summa');
    if (cashAmount + cardAmount !== total) {
      throw new ShiftError("Naqd va karta summalari jamisi hisob summasiga teng bo'lishi kerak");
    }
  }
  return { payment_method: method, cash_amount: cashAmount, card_amount: cardAmount };
}

module.exports = {
  ShiftError,
  getCurrentShift,
  requireOpenShift,
  openShift,
  closeShift,
  listShifts,
  validatePaymentInfo,
};
