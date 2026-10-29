// Yetkazish hududi (10/20 km) — 2026-10-23, foydalanuvchi so'rovi (PROMPT.md
// 2-bosqich). Masofa = oshxonadan mijoz nuqtasigacha, haversine formulasi
// (to'g'ri chiziq bo'yicha, tashqi API/yo'l-xizmati ishlatilmaydi). Narx:
//   0-10 km:  base_fee (qat'iy)
//   10-20 km: base_fee + ceil(masofa - base_km) * per_km
//   >20 km:   yetkazish rad etiladi, operator telefon raqami ko'rsatiladi
//
// Barcha 7 qiymat `settings` jadvalida (key/value) saqlanadi — faqat YANGI
// kalitlar, mavjud 'restaurant_name' va boshqalarga tegilmaydi. lat/lng/
// operator_phone administratorга tegishli, kerakli ma'lumot kelmaguncha
// BO'SH qoldiriladi — shu holatda tizim avvalgidek "Operator aytadi"
// rejimida ishlaydi (hech narsa buzilmaydi).
const { db } = require('../db');

const DEFAULTS = {
  delivery_origin_lat: '',
  delivery_origin_lng: '',
  delivery_base_km: '10',
  delivery_base_fee: '5000',
  delivery_per_km: '500',
  delivery_max_km: '20',
  delivery_operator_phone: '',
};

const KEYS = Object.keys(DEFAULTS);

function seedDefaults() {
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  for (const key of KEYS) insert.run(key, DEFAULTS[key]);
}

function getRawSettings() {
  const rows = db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${KEYS.map(() => '?').join(',')})`)
    .all(...KEYS);
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

// Son maydonlari uchun bo'sh/noto'g'ri qiymat bo'lsa `null` qaytaradi (ya'ni
// "sozlanmagan" — chaqiruvchi shu holatda "Operator aytadi" rejimiga tushadi).
function toNumberOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getSettings() {
  const raw = getRawSettings();
  return {
    origin_lat: toNumberOrNull(raw.delivery_origin_lat),
    origin_lng: toNumberOrNull(raw.delivery_origin_lng),
    base_km: toNumberOrNull(raw.delivery_base_km) ?? 10,
    base_fee: toNumberOrNull(raw.delivery_base_fee) ?? 5000,
    per_km: toNumberOrNull(raw.delivery_per_km) ?? 500,
    max_km: toNumberOrNull(raw.delivery_max_km) ?? 20,
    operator_phone: raw.delivery_operator_phone && String(raw.delivery_operator_phone).trim() !== ''
      ? String(raw.delivery_operator_phone).trim()
      : null,
  };
}

// Oshxona koordinatasi ikkalasi ham kiritilgandagina "sozlangan" hisoblanadi
// — faqat bittasi bo'lsa baribir masofani hisoblab bo'lmaydi.
function isOriginConfigured(settings) {
  return settings.origin_lat !== null && settings.origin_lng !== null;
}

const ALLOWED_UPDATE_KEYS = KEYS;

function updateSettings(partial) {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  const run = db.transaction(() => {
    for (const key of ALLOWED_UPDATE_KEYS) {
      if (!(key in partial)) continue;
      const v = partial[key];
      upsert.run(key, v === null || v === undefined ? '' : String(v));
    }
  });
  run();
  return getSettings();
}

// Haversine — ikki nuqta orasidagi to'g'ri chiziqli masofa (km).
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Yer radiusi, km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Narx formulasi. Natija: { fee, overMax } — overMax=true bo'lsa fee=null
// (20 km dan uzoq, saytdan buyurtma qabul qilinmaydi, operator bilan
// kelishiladi).
//
// Masofa avval 2 xona kasr (10 metr) aniqlikkacha yaxlitlanadi — haversine
// trigonometriyasi natijasida butun km chegarasida (masalan haqiqiy 12,0 km
// o'rniga 12.000000000000002) paydo bo'ladigan suzuvchi nuqta shovqini
// `Math.ceil()`ni bir pog'ona yuqoriga ("12" o'rniga "13") burab yuborishi
// mumkin edi — bu xavfsizlik nusxasi orqali (0,0 koordinatasida 12 km'lik
// sinov buyurtmasi) real aniqlangan, tuzatilgan bug.
function computeDeliveryFee(distanceKm, settings) {
  const d = Math.round(distanceKm * 100) / 100;
  if (d > settings.max_km) return { fee: null, overMax: true };
  if (d <= settings.base_km) return { fee: settings.base_fee, overMax: false };
  const extraKm = Math.ceil(d - settings.base_km);
  return { fee: settings.base_fee + extraKm * settings.per_km, overMax: false };
}

// `../db` require qilinganda ensureSchema() allaqachon ishga tushgan
// ('settings' jadvali mavjud) — shu sabab bu modulning o'zi yuklanganda
// standart qiymatlarni bir marta urug'lash xavfsiz (idempotent, ON CONFLICT
// DO NOTHING).
seedDefaults();

module.exports = {
  DEFAULTS,
  KEYS,
  seedDefaults,
  getSettings,
  updateSettings,
  isOriginConfigured,
  haversineKm,
  computeDeliveryFee,
};
