// Kassir "Hisoblash" (qo'lda chek) xizmat qatlami — 2026-09-09'da qo'shildi.
// server/services/orders.js'ga o'xshab db.transaction() bilan atomik ishlaydi,
// lekin stol/menyuga hech qanday bog'liqligi yo'q: kassir har bir qatorga
// erkin nom + narx + miqdor kiritadi, server faqat qiymatlarni tekshiradi va
// subtotal/jamini o'zi hisoblaydi (mijoz tomonidan yuborilgan jamiga ishonilmaydi).
const { db, nowIso } = require('../db');
const cashShifts = require('./cashShifts');

class ManualBillError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function validateItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ManualBillError('Kamida bitta taom qatori kiriting');
  }
  if (rawItems.length > 100) {
    throw new ManualBillError("Bitta chekda ko'pi bilan 100 qator bo'lishi mumkin");
  }
  return rawItems.map((raw) => {
    const name = String((raw && raw.name) || '').trim();
    const unitPrice = Number(raw && raw.unit_price);
    const quantity = Number(raw && raw.quantity);
    if (!name) throw new ManualBillError("Taom nomi kiritilmagan qator bor");
    if (name.length > 200) throw new ManualBillError(`"${name.slice(0, 30)}..." nomi juda uzun`);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new ManualBillError(`"${name}" uchun narx noto'g'ri`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      throw new ManualBillError(`"${name}" uchun miqdor noto'g'ri`);
    }
    return { name, unit_price: unitPrice, quantity, subtotal: unitPrice * quantity };
  });
}

// Mijoz raqami ixtiyoriy — kiritilmasa NULL saqlanadi, formati qat'iy
// tekshirilmaydi, chunki bu shunchaki eslatma/qidiruv uchun, to'lov/SMS uchun
// ishlatilmaydi. Kassir mamlakat kodisiz (masalan "901234567" yoki "0901234567")
// kiritsa, avtomatik "+998" qo'yiladi (2026-09-26, foydalanuvchi so'rovi) —
// lekin agar kassir o'zi biror "+" bilan boshlangan kodni kiritgan bo'lsa
// (masalan boshqa mamlakat raqami), unga tegilmaydi.
function sanitizePhone(raw) {
  let phone = String(raw || '').trim();
  if (!phone) return null;
  if (phone.length > 30) throw new ManualBillError("Mijoz raqami juda uzun");
  if (!phone.startsWith('+')) {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('998')) digits = digits.slice(3);
    else if (digits.startsWith('0')) digits = digits.slice(1);
    phone = `+998${digits}`;
  }
  return phone;
}

// Izoh — mijoz raqami yonidagi ixtiyoriy erkin matn (2026-09-27, foydalanuvchi
// so'rovi). Formati tekshirilmaydi, faqat uzunlik cheklanadi.
function sanitizeNote(raw) {
  const note = String(raw || '').trim();
  if (!note) return null;
  if (note.length > 300) throw new ManualBillError('Izoh juda uzun');
  return note;
}

// Yetkazib berish narxi — ixtiyoriy, standart qiymat (5000) frontendda
// (public/kassir/manual.js) qo'yiladi, bu yerda faqat kelgan qiymat
// tekshiriladi (2026-09-27, foydalanuvchi so'rovi). Berilmasa/bo'sh bo'lsa 0,
// manfiy bo'lsa xato. Taomlar summasiga qo'shilib umumiy "Jami"ni tashkil qiladi.
function sanitizeDeliveryPrice(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0) {
    throw new ManualBillError("Yetkazib berish narxi noto'g'ri");
  }
  return Math.round(price);
}

// Sabab — "nima uchun qo'lda yozildi" (ixtiyoriy, `note`dan ATAYLAB alohida —
// `note` mijoz uchun erkin izoh, `reason` esa ichki/hisobot uchun).
function sanitizeReason(raw) {
  const reason = String(raw || '').trim();
  if (!reason) return null;
  if (reason.length > 300) throw new ManualBillError('Sabab juda uzun');
  return reason;
}

// `rawPaymentInfo` — IXTIYORIY, kassa smenasi auditi (2026-10-10):
// `{payment_method, cash_amount, card_amount}` (xom, hali tekshirilmagan —
// jami summa shu funksiya ichida hisoblangach, `cashShifts.validatePaymentInfo()`
// bilan shu yerda tekshiriladi). Berilmasa — eski xulq-atvor, barchasi NULL.
function createManualBill(rawItems, userId, rawPhone, rawNote, rawDeliveryPrice, rawReason, rawPaymentInfo) {
  const items = validateItems(rawItems);
  const itemsTotal = items.reduce((sum, it) => sum + it.subtotal, 0);
  const customerPhone = sanitizePhone(rawPhone);
  const note = sanitizeNote(rawNote);
  const deliveryPrice = sanitizeDeliveryPrice(rawDeliveryPrice);
  const reason = sanitizeReason(rawReason);
  const total = itemsTotal + deliveryPrice;
  const paymentInfo = rawPaymentInfo ? cashShifts.validatePaymentInfo(total, rawPaymentInfo) : null;

  const run = db.transaction(() => {
    const ts = nowIso();
    let info;
    if (paymentInfo) {
      const shift = cashShifts.requireOpenShift(userId);
      info = db
        .prepare(
          `INSERT INTO manual_bills (created_by, total_amount, customer_phone, note, delivery_price, reason,
           payment_method, cash_amount, card_amount, cash_shift_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId, total, customerPhone, note, deliveryPrice, reason,
          paymentInfo.payment_method, paymentInfo.cash_amount, paymentInfo.card_amount, shift.id, ts
        );
    } else {
      info = db
        .prepare('INSERT INTO manual_bills (created_by, total_amount, customer_phone, note, delivery_price, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(userId, total, customerPhone, note, deliveryPrice, reason, ts);
    }
    const billId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO manual_bill_items (manual_bill_id, name, unit_price, quantity, subtotal)
       VALUES (?, ?, ?, ?, ?)`
    );
    items.forEach((it) => insertItem.run(billId, it.name, it.unit_price, it.quantity, it.subtotal));
    return billId;
  });

  return getManualBillReceipt(run());
}

// public/app.js'dagi receipt modal (renderReceiptBox/buildEscPosReceipt)
// `view.kind` bo'yicha ajratadi — 'manual' shu yerda, 'customer' esa
// customer_orders uchun (app.js'da mavjud) ishlatiladi.
function getManualBillReceipt(billId) {
  const bill = db
    .prepare(
      `SELECT mb.*, COALESCE(u.full_name, u.username) AS created_by_name
       FROM manual_bills mb JOIN users u ON u.id = mb.created_by WHERE mb.id = ?`
    )
    .get(billId);
  if (!bill) throw new ManualBillError('Hisob topilmadi', 404);
  const items = db
    .prepare('SELECT * FROM manual_bill_items WHERE manual_bill_id = ? ORDER BY id ASC')
    .all(billId);
  return {
    kind: 'manual',
    order: {
      heading: "Qo'lda hisoblash",
      created_at: bill.created_at,
      created_by_name: bill.created_by_name,
      customer_phone: bill.customer_phone,
      note: bill.note,
      reason: bill.reason,
      delivery_price: bill.delivery_price,
    },
    items: items.map((it) => ({
      name_snapshot: it.name,
      unit_price: it.unit_price,
      quantity: it.quantity,
      subtotal: it.subtotal,
    })),
    total: bill.total_amount,
  };
}

module.exports = { ManualBillError, createManualBill, getManualBillReceipt };
