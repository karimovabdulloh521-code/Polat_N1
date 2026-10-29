// Mijoz menyusi (menu-v2.js) uchun sof yordamchi funksiyalar — 2026-10-24'da
// menu-v2.js'dan ajratildi ("Kod sifati"). DOM'ga bog'liq emas, shuning
// uchun Node'da ham test qilinadi (yetkazish narxi formulasi serverdagi
// server/services/deliveryZone.js bilan bir xil ekanini tekshirish uchun).
// Kod O'ZGARTIRILMAGAN, faqat ko'chirildi. menu-v2.js'dan OLDIN ulanadi.
(function (root) {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtSom(n) {
    return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";
  }
  // Yetkazish masofasi/narxi (2026-10-23) — server/services/deliveryZone.js
  // bilan AYNAN bir xil formula (haversine + bosqichli narx). Bu yerda
  // faqat KO'RSATISH uchun hisoblanadi, mijoz savatini checkout qilganda
  // haqiqiy narx serverda qayta hisoblanadi — bu hisob-kitobga ishonilmaydi.
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function computeDeliveryFee(distanceKm, zone) {
    const d = Math.round(distanceKm * 100) / 100;
    if (d > zone.max_km) return { fee: null, overMax: true, distanceKm: d };
    if (d <= zone.base_km) return { fee: zone.base_fee, overMax: false, distanceKm: d };
    const extraKm = Math.ceil(d - zone.base_km);
    return { fee: zone.base_fee + extraKm * zone.per_km, overMax: false, distanceKm: d };
  }
  // Apostrof variantlari (o'/oʻ/o') farqisiz qidiruv.
  function normalizeSearch(s) {
    return String(s || '').toLowerCase().replace(/[ʻʼ'’`]/g, '');
  }
  function itemMatchesSearch(it, q) {
    if (normalizeSearch(it.name).includes(q)) return true;
    return (it.variants || []).some((v) => normalizeSearch(v.name).includes(q));
  }

  const api = { escapeHtml, fmtSom, haversineKm, computeDeliveryFee, normalizeSearch, itemMatchesSearch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZfdUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
