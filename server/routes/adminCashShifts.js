// Admin uchun kassir smenalari tarixi (faqat o'qish) — "Moliya va kassa"
// auditi (2026-10-10). Kim qachon ochdi/yopdi, boshlang'ich/kutilgan/
// haqiqiy naqd va ulardagi farq (kamomad/ortiqcha) ko'rinadi.
const express = require('express');
const { asyncRoute } = require('../routeUtils');
const cashShifts = require('../services/cashShifts');

const router = express.Router();

router.get('/', asyncRoute((req, res) => {
  res.json(cashShifts.listShifts());
}));

module.exports = router;
