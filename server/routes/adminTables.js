const express = require('express');
const QRCode = require('qrcode');
const { db, nowIso } = require('../db');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

// ---------------- Joylar (zal/tashqari kabi guruhlash, 2026-10-10) ----------------
// inventory_categories bilan bir xil oddiy naqsh — faqat guruhlash yorlig'i,
// tarix/FK bog'liqligi yo'q, shu sabab is_active shart emas.

router.get('/zones', asyncRoute((req, res) => {
  res.json(db.prepare('SELECT * FROM table_zones ORDER BY sort_order, id').all());
}));

router.post('/zones', asyncRoute((req, res) => {
  const { name, sort_order } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom kiritilishi shart' });
  const info = db
    .prepare('INSERT INTO table_zones (name, sort_order, created_at) VALUES (?, ?, ?)')
    .run(String(name).trim(), Number(sort_order) || 0, nowIso());
  res.json(db.prepare('SELECT * FROM table_zones WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/zones/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM table_zones WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Joy topilmadi' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  if (!name) return res.status(400).json({ error: 'Nom kiritilishi shart' });
  const sortOrder = req.body?.sort_order !== undefined ? Number(req.body.sort_order) : existing.sort_order;
  db.prepare('UPDATE table_zones SET name = ?, sort_order = ? WHERE id = ?').run(name, sortOrder, req.params.id);
  res.json(db.prepare('SELECT * FROM table_zones WHERE id = ?').get(req.params.id));
}));

// Joyning o'zi tarixga ega emas (faqat guruhlash yorlig'i) — shu sabab doim
// hard-delete, unga tegishli stollar zone_id=NULL bo'lib "Joysiz" guruhga
// tushadi (inventory_categories.deleteCategory() bilan bir xil naqsh).
router.delete('/zones/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM table_zones WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Joy topilmadi' });
  const run = db.transaction(() => {
    db.prepare('UPDATE tables SET zone_id = NULL WHERE zone_id = ?').run(req.params.id);
    db.prepare('DELETE FROM table_zones WHERE id = ?').run(req.params.id);
  });
  run();
  res.json({ ok: true });
}));

// ---------------- Stollar ----------------

router.get('/', asyncRoute((req, res) => {
  res.json(db.prepare('SELECT * FROM tables ORDER BY sort_order, id').all());
}));

function resolveZoneId(rawZoneId) {
  if (rawZoneId === undefined) return undefined; // "o'zgartirilmadi" belgisi
  if (rawZoneId === null || rawZoneId === '') return null;
  const zone = db.prepare('SELECT id FROM table_zones WHERE id = ?').get(rawZoneId);
  if (!zone) throw Object.assign(new Error('Joy topilmadi'), { status: 400 });
  return zone.id;
}

router.post('/', asyncRoute((req, res) => {
  const { name, sort_order, zone_id } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom kiritilishi shart' });
  let zoneId;
  try {
    zoneId = resolveZoneId(zone_id);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const info = db
    .prepare('INSERT INTO tables (name, sort_order, is_active, zone_id, created_at) VALUES (?, ?, 1, ?, ?)')
    .run(String(name).trim(), Number(sort_order) || 0, zoneId ?? null, nowIso());
  res.json(db.prepare('SELECT * FROM tables WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Stol topilmadi' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const sortOrder = req.body?.sort_order !== undefined ? Number(req.body.sort_order) : existing.sort_order;
  // O'chirilgan stolni tiklash (2026-10-28 audit — menu.js/adminMenu.js'dagi
  // "♻️ Tiklash" bilan BIR XIL naqsh): ilgari DELETE doim is_active=0
  // qilardi, lekin PUT hech qachon uni qayta 1ga qaytarmasdi — o'chirilgan
  // stol abadiy "o'chirilgan" belgisi bilan ro'yxatda osilib qolardi.
  const isActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
  let zoneId;
  try {
    zoneId = resolveZoneId(req.body?.zone_id);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (zoneId === undefined) zoneId = existing.zone_id;
  db.prepare('UPDATE tables SET name = ?, sort_order = ?, zone_id = ?, is_active = ? WHERE id = ?').run(name, sortOrder, zoneId, isActive, req.params.id);
  res.json(db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id));
}));

router.delete('/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Stol topilmadi' });
  const openOrder = db.prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'open'").get(req.params.id);
  if (openOrder) return res.status(400).json({ error: "Bu stolda ochiq buyurtma bor, avval hisob-kitob qiling" });
  db.prepare('UPDATE tables SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// Har bir stol uchun QR kod (2026-10-10) — mijoz skanerlaganda login-siz
// `/landing/table-menu.html?table=<id>` ochiladi (faqat menyu, savat/buyurtma
// yo'q). Admin shu rasmni istalgan payt qayta yuklab olishi mumkin — hech
// narsa saqlanmaydi, har so'rovda yangidan generatsiya qilinadi.
router.get('/:id/qr', asyncRoute(async (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Stol topilmadi' });
  const url = `${req.protocol}://${req.get('host')}/landing/table-menu.html?table=${table.id}`;
  const buffer = await QRCode.toBuffer(url, { type: 'png', width: 500, margin: 2 });
  // Oddiy (ASCII) fallback nom header'ning asosiy qismi uchun — kirillcha va
  // boshqa non-ASCII belgilar HTTP header qiymatida man etilgan (Node
  // ERR_INVALID_CHAR bilan tashlaydi). Haqiqiy (masalan kirillcha) nom
  // RFC 5987 `filename*=UTF-8''...` qismida saqlanadi, zamonaviy brauzerlar
  // shuni ustun qo'yib asl nomda saqlaydi.
  const asciiName = String(table.name).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'stol';
  const utf8Name = encodeURIComponent(`qr-${table.name}.png`);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="qr-${asciiName}.png"; filename*=UTF-8''${utf8Name}`);
  res.send(buffer);
}));

module.exports = router;
