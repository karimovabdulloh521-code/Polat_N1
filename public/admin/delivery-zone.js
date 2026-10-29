// Admin "Yetkazish hududi" sozlamasi (2026-10-23) — server/routes/
// adminDeliveryZone.js bilan ishlaydi. escapeHtml()/api() — ../app.js'dan
// global. Leaflet CDN yuklanmasa ham sahifa buzilmasin uchun har bir
// xarita-bog'liq chaqiruv `window.L` borligini tekshiradi.
let dzMap = null;
let dzMarker = null;

function setLatLngInputs(lat, lng) {
  document.getElementById('dzLat').value = lat === null || lat === undefined ? '' : lat;
  document.getElementById('dzLng').value = lng === null || lng === undefined ? '' : lng;
}

function placeMarker(lat, lng) {
  if (!dzMap || typeof window.L === 'undefined') return;
  if (dzMarker) dzMap.removeLayer(dzMarker);
  dzMarker = window.L.marker([lat, lng]).addTo(dzMap);
}

function initMap(initialLat, initialLng) {
  if (typeof window.L === 'undefined') {
    document.getElementById('dzMap').innerHTML = '<p class="dim" style="padding:12px;">Xarita yuklanmadi (internet/CDN yo\'q) — lat/lng maydonlariga qo\'lda kiriting.</p>';
    return;
  }
  const centerLat = initialLat !== null ? initialLat : 41.3775;
  const centerLng = initialLng !== null ? initialLng : 64.5853; // O'zbekiston markazi, taxminan
  dzMap = window.L.map('dzMap').setView([centerLat, centerLng], initialLat !== null ? 14 : 6);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  }).addTo(dzMap);
  if (initialLat !== null && initialLng !== null) placeMarker(initialLat, initialLng);
  dzMap.on('click', (e) => {
    placeMarker(e.latlng.lat, e.latlng.lng);
    setLatLngInputs(e.latlng.lat.toFixed(6), e.latlng.lng.toFixed(6));
  });
}

async function loadSettings() {
  const msg = document.getElementById('dzMsg');
  try {
    const s = await api('/admin/delivery-zone');
    setLatLngInputs(s.origin_lat, s.origin_lng);
    document.getElementById('dzBaseKm').value = s.base_km;
    document.getElementById('dzBaseFee').value = s.base_fee;
    document.getElementById('dzPerKm').value = s.per_km;
    document.getElementById('dzMaxKm').value = s.max_km;
    document.getElementById('dzOperatorPhone').value = s.operator_phone || '';
    document.getElementById('dzBaseKmLabel').textContent = s.base_km;
    initMap(s.origin_lat, s.origin_lng);
  } catch (err) {
    msg.textContent = err.message;
    initMap(null, null);
  }
}

async function saveSettings() {
  const msg = document.getElementById('dzMsg');
  msg.textContent = 'Saqlanmoqda...';
  try {
    const body = {
      origin_lat: document.getElementById('dzLat').value.trim(),
      origin_lng: document.getElementById('dzLng').value.trim(),
      base_km: document.getElementById('dzBaseKm').value,
      base_fee: document.getElementById('dzBaseFee').value,
      per_km: document.getElementById('dzPerKm').value,
      max_km: document.getElementById('dzMaxKm').value,
      operator_phone: document.getElementById('dzOperatorPhone').value.trim(),
    };
    const s = await api('/admin/delivery-zone', { method: 'PUT', body });
    document.getElementById('dzBaseKmLabel').textContent = s.base_km;
    msg.textContent = "Saqlandi.";
  } catch (err) {
    msg.textContent = err.message;
  }
}

// Brauzer GPS'i orqali oshxonaning joriy joylashuvini avtomatik oladi
// (admin shu tugmani oshxonaning o'zida, telefon/noutbukdan bosishi
// ko'zda tutilgan) — `landing/menu-v2.js`dagi mijoz-lokatsiya tugmasi
// bilan bir xil naqsh (navigator.geolocation, xato xabarlari).
function autoLocateOrigin() {
  const btn = document.getElementById('dzAutoLocate');
  const msg = document.getElementById('dzMsg');
  if (!navigator.geolocation) {
    msg.textContent = "Bu qurilma/brauzer joylashuvni aniqlay olmaydi — lat/lng maydonlariga qo'lda kiriting.";
    return;
  }
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Aniqlanmoqda…';
  msg.textContent = '';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      setLatLngInputs(latitude.toFixed(6), longitude.toFixed(6));
      placeMarker(latitude, longitude);
      if (dzMap) dzMap.setView([latitude, longitude], 16);
      msg.textContent = 'Joriy joylashuv olindi. Saqlashni unutmang.';
      btn.disabled = false;
      btn.textContent = originalText;
    },
    (err) => {
      msg.textContent = err && err.code === 1
        ? "Ruxsat berilmadi — brauzer sozlamalaridan joylashuvga ruxsat berib, qayta urinib ko'ring."
        : "Joylashuvni aniqlab bo'lmadi — xaritada bosib yoki qo'lda kiriting.";
      btn.disabled = false;
      btn.textContent = originalText;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('delivery-zone');
  loadSettings();
  document.getElementById('dzSaveBtn').addEventListener('click', saveSettings);
  document.getElementById('dzAutoLocate').addEventListener('click', autoLocateOrigin);
  document.getElementById('dzClearOrigin').addEventListener('click', () => {
    setLatLngInputs(null, null);
    if (dzMarker && dzMap) { dzMap.removeLayer(dzMarker); dzMarker = null; }
  });
});
