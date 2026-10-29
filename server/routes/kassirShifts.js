// Kassir smenasi (ochish/yopish, naqd farqi) — "Moliya va kassa" auditi
// (2026-10-10). Faqat kassir (va admin) uchun, server/index.js'da
// requireRole(['admin','kassir']) bilan '/api/kassir' prefiksiga ulanadi
// (kassirTables.js/kassirBilling.js bilan bir xil yo'l, marshrutlari
// kesishmaydi — bu yerda faqat /shifts*).
const express = require('express');
const { asyncRoute } = require('../routeUtils');
const cashShifts = require('../services/cashShifts');

const router = express.Router();

router.get('/shifts/current', asyncRoute((req, res) => {
  res.json(cashShifts.getCurrentShift(req.user.id));
}));

router.post('/shifts/open', asyncRoute((req, res) => {
  const shift = cashShifts.openShift(req.user.id, req.body?.opening_cash);
  res.status(201).json(shift);
}));

router.post('/shifts/:id/close', asyncRoute((req, res) => {
  const shift = cashShifts.closeShift(req.params.id, req.user.id, req.body?.actual_cash, {
    isAdmin: req.user.role === 'admin',
  });
  res.json(shift);
}));

module.exports = router;
