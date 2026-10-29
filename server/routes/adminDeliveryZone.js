// Admin-only — "Yetkazish hududi" sozlamalari (2026-10-23). Faqat shu 7
// `settings` kaliti bilan ishlaydi (server/services/deliveryZone.js), boshqa
// hech qanday kalitga tegmaydi.
const express = require('express');
const deliveryZone = require('../services/deliveryZone');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

router.get('/', asyncRoute((req, res) => {
  res.json(deliveryZone.getSettings());
}));

function parseOptionalNumber(raw, field, { min, max } = {}) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: `${field} noto'g'ri son` };
  if (min !== undefined && n < min) return { error: `${field} ${min} dan kichik bo'lmasligi kerak` };
  if (max !== undefined && n > max) return { error: `${field} ${max} dan katta bo'lmasligi kerak` };
  return { value: n };
}

router.put('/', asyncRoute((req, res) => {
  const body = req.body || {};
  const update = {};

  if ('origin_lat' in body || 'origin_lng' in body) {
    const lat = parseOptionalNumber(body.origin_lat, 'Kenglik (lat)', { min: -90, max: 90 });
    if (lat.error) return res.status(400).json({ error: lat.error, field: 'origin_lat' });
    const lng = parseOptionalNumber(body.origin_lng, 'Uzunlik (lng)', { min: -180, max: 180 });
    if (lng.error) return res.status(400).json({ error: lng.error, field: 'origin_lng' });
    // Ikkalasi birga keladi yoki ikkalasi ham bo'sh — yarim-sozlangan holat
    // (faqat bittasi bor) masofani hisoblashda chalkashlik keltirib chiqaradi.
    if ((lat.value === null) !== (lng.value === null)) {
      return res.status(400).json({ error: 'Kenglik va uzunlikning ikkalasi ham kiritilishi (yoki ikkalasi ham bo\'sh qolishi) kerak', field: 'origin_lat' });
    }
    update.delivery_origin_lat = lat.value;
    update.delivery_origin_lng = lng.value;
  }
  if ('base_km' in body) {
    const r = parseOptionalNumber(body.base_km, 'Asosiy hudud (km)', { min: 0, max: 1000 });
    if (r.error) return res.status(400).json({ error: r.error, field: 'base_km' });
    if (r.value === null) return res.status(400).json({ error: 'Asosiy hudud (km) bo\'sh bo\'lishi mumkin emas', field: 'base_km' });
    update.delivery_base_km = r.value;
  }
  if ('base_fee' in body) {
    const r = parseOptionalNumber(body.base_fee, 'Asosiy narx', { min: 0, max: 100000000 });
    if (r.error) return res.status(400).json({ error: r.error, field: 'base_fee' });
    if (r.value === null) return res.status(400).json({ error: 'Asosiy narx bo\'sh bo\'lishi mumkin emas', field: 'base_fee' });
    update.delivery_base_fee = r.value;
  }
  if ('per_km' in body) {
    const r = parseOptionalNumber(body.per_km, 'Har km narxi', { min: 0, max: 10000000 });
    if (r.error) return res.status(400).json({ error: r.error, field: 'per_km' });
    if (r.value === null) return res.status(400).json({ error: 'Har km narxi bo\'sh bo\'lishi mumkin emas', field: 'per_km' });
    update.delivery_per_km = r.value;
  }
  if ('max_km' in body) {
    const r = parseOptionalNumber(body.max_km, 'Maksimal masofa (km)', { min: 0, max: 1000 });
    if (r.error) return res.status(400).json({ error: r.error, field: 'max_km' });
    if (r.value === null) return res.status(400).json({ error: 'Maksimal masofa (km) bo\'sh bo\'lishi mumkin emas', field: 'max_km' });
    update.delivery_max_km = r.value;
  }
  if ('operator_phone' in body) {
    const phone = String(body.operator_phone || '').trim();
    if (phone && (phone.length < 7 || phone.length > 30)) {
      return res.status(400).json({ error: 'Telefon raqami noto\'g\'ri', field: 'operator_phone' });
    }
    update.delivery_operator_phone = phone;
  }

  const result = deliveryZone.updateSettings(update);
  res.json(result);
}));

module.exports = router;
