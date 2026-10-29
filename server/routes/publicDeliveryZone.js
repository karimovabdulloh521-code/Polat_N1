// Ochiq (login shart emas) — mijozlar menyusi (landing) yetkazib berish
// tanlaganda shu endpointdan oshxona nuqtasi va tarif qiymatlarini oladi,
// xaritada doiralarni chizadi va narxni frontendda ham ko'rsatadi (haqiqiy,
// yakuniy narx baribir `POST /api/public/orders`da SERVERDA qayta hisoblanadi).
const express = require('express');
const deliveryZone = require('../services/deliveryZone');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

router.get('/', asyncRoute((req, res) => {
  const s = deliveryZone.getSettings();
  const configured = deliveryZone.isOriginConfigured(s);
  res.json({
    configured,
    origin_lat: configured ? s.origin_lat : null,
    origin_lng: configured ? s.origin_lng : null,
    base_km: s.base_km,
    base_fee: s.base_fee,
    per_km: s.per_km,
    max_km: s.max_km,
    operator_phone: s.operator_phone,
  });
}));

module.exports = router;
