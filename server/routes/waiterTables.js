const express = require('express');
const { listTablesOverview, listTablesOverviewByHall, setBillRequested } = require('../services/orders');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

router.get('/tables', asyncRoute((req, res) => {
  res.json(listTablesOverview());
}));

// "Stollar" ekrani qayta dizayni (2026-10-15) — zal (table_zones) bo'yicha
// guruhlangan ro'yxat. Eski GET /tables ATAYLAB o'zgartirilmadi (admin bosh
// sahifa va waiter/order.js hamon flat shaklni kutadi).
router.get('/tables/overview', asyncRoute((req, res) => {
  res.json(listTablesOverviewByHall());
}));

router.patch('/tables/:id/bill-request', asyncRoute((req, res) => {
  const view = setBillRequested(req.params.id, !!(req.body && req.body.requested));
  res.json(view);
}));

module.exports = router;
