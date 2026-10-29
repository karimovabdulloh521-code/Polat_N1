const express = require('express');
const { db, nowIso, TASHKENT_SQL_OFFSET } = require('../db');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

router.get('/', asyncRoute((req, res) => {
  const { from, to } = req.query;
  let sql = 'SELECT e.*, COALESCE(u.full_name, u.username) AS created_by_name FROM expenses e LEFT JOIN users u ON u.id = e.created_by WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND e.expense_date >= ?'; params.push(from); }
  if (to) { sql += ' AND e.expense_date <= ?'; params.push(to); }
  sql += ' ORDER BY e.expense_date DESC, e.id DESC';
  res.json(db.prepare(sql).all(...params));
}));

router.post('/', asyncRoute((req, res) => {
  const { amount, expense_date, note, category } = req.body || {};
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) return res.status(400).json({ error: "Summani to'g'ri kiriting" });
  // Standart sana — ko'rsatilmasa, Toshkent (UTC+5) bo'yicha "bugun" (2026-10-10
  // auditida topilgan: ilgari nowIso().slice(0,10) UTC kunini olardi — mahalliy
  // soat 00:00-04:59 oralig'ida xarajat qo'shilsa, "kechagi kun"ga yozilib qolardi).
  const date = expense_date && String(expense_date).trim()
    ? String(expense_date).trim()
    : db.prepare(`SELECT date('now', '${TASHKENT_SQL_OFFSET}') AS d`).get().d;
  const info = db
    .prepare(
      `INSERT INTO expenses (amount, expense_date, note, category, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(Math.round(amountNum), date, note || null, category || null, req.user.id, nowIso());
  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Xarajat topilmadi' });
  const amount = req.body?.amount !== undefined ? Math.round(Number(req.body.amount)) : existing.amount;
  const date = req.body?.expense_date !== undefined ? String(req.body.expense_date).trim() : existing.expense_date;
  const note = req.body?.note !== undefined ? req.body.note : existing.note;
  const category = req.body?.category !== undefined ? req.body.category : existing.category;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Summani to'g'ri kiriting" });
  db.prepare('UPDATE expenses SET amount = ?, expense_date = ?, note = ?, category = ? WHERE id = ?').run(
    amount, date, note, category, req.params.id
  );
  res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id));
}));

router.delete('/:id', asyncRoute((req, res) => {
  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Xarajat topilmadi' });
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
