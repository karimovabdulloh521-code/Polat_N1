const express = require('express');
const { db, nowIso } = require('../db');
const { hashPassword } = require('../passwords');
const { asyncRoute } = require('../routeUtils');
const { ROLE_NAMES } = require('../roles');
const { logAudit } = require('../services/auditLog');

const router = express.Router();

const PUBLIC_FIELDS = 'id, username, role, full_name, is_active, created_at, last_login_at, last_login_ip';

// Xodim orders/order_items/expenges jadvallarida FK orqali izi bormi —
// bo'lsa haqiqiy o'chirish (FK buziladi/tarix yo'qoladi) xavfli, shuning
// uchun shunday hollarda faqat is_active=0 (soft-delete) qilinadi.
function userHasActivity(id) {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE opened_by = ? OR closed_by = ?) +
         (SELECT COUNT(*) FROM order_items WHERE added_by = ?) +
         (SELECT COUNT(*) FROM expenses WHERE created_by = ?) AS cnt`
    )
    .get(id, id, id, id);
  return row.cnt > 0;
}

router.get('/', asyncRoute((req, res) => {
  const rows = db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY role, username`).all();
  const withActivity = rows.map((u) => ({ ...u, has_activity: userHasActivity(u.id) }));
  res.json(withActivity);
}));

router.post('/', asyncRoute((req, res) => {
  const { username, password, role, full_name } = req.body || {};
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'Login kiritilishi shart' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Parol kamida 6 belgi bo\'lishi kerak' });
  if (!ROLE_NAMES.includes(role)) return res.status(400).json({ error: "Rol noto'g'ri" });
  const uname = String(username).trim();
  const dup = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (dup) return res.status(400).json({ error: 'Bu login band' });
  const { salt, hash } = hashPassword(password);
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, password_salt, role, full_name, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
    .run(uname, hash, salt, role, full_name ? String(full_name).trim() : null, nowIso());
  // "Audit izi" auditi (2026-10-10): yangi xodim yaratilishi (kim, qaysi
  // login/rol bilan) endi doimiy iz qoldiradi.
  logAudit('user.create', 'user', info.lastInsertRowid, null, { username: uname, role }, req.user.id);
  res.json(db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(info.lastInsertRowid));
}));

router.put('/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  const fullName = req.body?.full_name !== undefined ? String(req.body.full_name).trim() : existing.full_name;
  const role = req.body?.role !== undefined ? req.body.role : existing.role;
  const isActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
  if (!ROLE_NAMES.includes(role)) return res.status(400).json({ error: "Rol noto'g'ri" });
  db.prepare('UPDATE users SET full_name = ?, role = ?, is_active = ? WHERE id = ?').run(
    fullName, role, isActive, req.params.id
  );
  // Rol o'zgarishi — "Audit izi" auditi (2026-10-10): ilgari eski/yangi rol
  // hech qayerga yozilmasdi (masalan "afitsiant" dan "admin"ga ko'tarilishi
  // izsiz qolardi). is_active o'zgarishi ham shu bilan birga loglanadi.
  if (role !== existing.role) {
    logAudit('user.role_change', 'user', existing.id, { role: existing.role }, { role }, req.user.id);
  }
  if (isActive !== existing.is_active) {
    logAudit('user.active_change', 'user', existing.id, { is_active: existing.is_active }, { is_active: isActive }, req.user.id);
  }
  res.json(db.prepare(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`).get(req.params.id));
}));

router.post('/:id/reset-password', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  const { password } = req.body || {};
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Parol kamida 6 belgi bo\'lishi kerak' });
  const { salt, hash } = hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, req.params.id);
  res.json({ ok: true });
}));

router.delete('/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  if (Number(req.params.id) === Number(req.user.id)) {
    return res.status(400).json({ error: "O'zingizni o'chira olmaysiz" });
  }
  // Agar xodimning buyurtma/chek tarixi bo'lsa, haqiqiy o'chirish FK'ni
  // buzadi va tarixni buzadi — shunday hollarda faqat faolsizlantiriladi
  // (is_active=0). Tarixi yo'q bo'lsa (masalan yangi/hech ishlatilmagan
  // xodim) qator butunlay o'chiriladi.
  if (userHasActivity(req.params.id)) {
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.params.id);
    logAudit('user.deactivate', 'user', existing.id, { is_active: 1 }, { is_active: 0 }, req.user.id);
    return res.json({ ok: true, hardDeleted: false });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logAudit('user.delete', 'user', existing.id, { username: existing.username, role: existing.role }, null, req.user.id);
  res.json({ ok: true, hardDeleted: true });
}));

module.exports = router;
