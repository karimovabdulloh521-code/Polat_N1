// Ochiq (login shart emas) endpoint — landing sahifadagi "Stol bron qilish"
// oynasidan yuboriladi. server/index.js'da bu router auth.requireAuth'dan
// OLDIN ulanadi, shu sabab mehmon hech qanday sessiyasiz murojaat qila oladi.
const express = require('express');
const { db, nowIso } = require('../db');
const { asyncRoute, createIdempotencyGuard } = require('../routeUtils');

const router = express.Router();
const withIdempotency = createIdempotencyGuard();

// `YYYY-MM-DD` shaklga mos bo'lsa-da haqiqiy kalendar sanasi bo'lmasligi
// mumkin (masalan "2026-13-99") — JS Date bunday qiymatlarni "to'g'rilab"
// boshqa sanaga aylantiradi, shu sabab komponentlarni qayta hosil qilib
// solishtiramiz. Bugungi (Toshkent, UTC+5) kundan oldingi sana ham rad
// etiladi (2026-10-28 audit — ilgari faqat shakl tekshirilardi).
function isValidFutureDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  const todayTashkent = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
  return dateStr >= todayTashkent;
}

function isValidTime(timeStr) {
  const [h, min] = timeStr.split(':').map(Number);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

// Bron telefoni — mehmon formatini erkin qoldiramiz (xorijiy/landline
// bo'lishi mumkin, qo'lda qayta chaqirish uchun faqat tozalik kerak), lekin
// "call me 1234567!!" kabi harf/belgi aralash matn endi xom holda
// saqlanmaydi: faqat raqamlar (+ ixtiyoriy boshida) qoladi.
function sanitizeReservationPhone(raw) {
  const trimmed = String(raw || '').trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (hasPlus ? '+' : '') + digits;
}

router.post('/', asyncRoute((req, res) => {
  const { full_name, phone, party_size, res_date, res_time, note } = req.body || {};

  const name = String(full_name || '').trim();
  const phoneNum = String(phone || '').trim();
  const size = Number(party_size);
  const date = String(res_date || '').trim();
  const time = String(res_time || '').trim();
  const noteText = String(note || '').trim();

  if (!name) return res.status(400).json({ error: 'Ismingizni kiriting' });
  if (name.length > 120) return res.status(400).json({ error: 'Ism juda uzun' });
  const phoneClean = sanitizeReservationPhone(phoneNum);
  if (!phoneClean) {
    return res.status(400).json({ error: "Telefon raqamini to'g'ri kiriting" });
  }
  if (!Number.isFinite(size) || size <= 0 || size > 50) {
    return res.status(400).json({ error: "Kishilar sonini to'g'ri kiriting" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidFutureDate(date)) {
    return res.status(400).json({ error: "Sanani to'g'ri tanlang" });
  }
  if (!/^\d{2}:\d{2}$/.test(time) || !isValidTime(time)) {
    return res.status(400).json({ error: "Vaqtni to'g'ri tanlang" });
  }

  const idempotencyKey = typeof req.body?.idempotency_key === 'string' ? req.body.idempotency_key : null;
  const id = withIdempotency(idempotencyKey, () => {
    const info = db
      .prepare(
        `INSERT INTO reservations (full_name, phone, party_size, res_date, res_time, note, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`
      )
      .run(name, phoneClean, Math.round(size), date, time, noteText || null, nowIso());
    return info.lastInsertRowid;
  });

  res.json({ ok: true, id });
}));

module.exports = router;
