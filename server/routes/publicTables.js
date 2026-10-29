// Ochiq (login shart emas) endpoint — QR kod orqali ochiladigan
// table-menu.html sahifasi stol nomini shu yerdan oladi (2026-10-10).
// Faqat id/name qaytaradi — boshqa hech qanday maxfiy/ichki maydon yo'q.
const express = require('express');
const { db } = require('../db');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

router.get('/:id', asyncRoute((req, res) => {
  const table = db.prepare('SELECT id, name FROM tables WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Stol topilmadi' });
  res.json(table);
}));

module.exports = router;
