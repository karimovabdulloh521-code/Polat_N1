// Har bir route handler shu bilan o'raladi — better-sqlite3 sinxron ishlagani
// uchun oddiy try/catch yetarli (async/await shart emas). Xizmat qatlamidagi
// xatoliklar (OrderError va shunga o'xshash, `status` maydoni bilan) to'g'ri
// HTTP kod bilan JSON qaytaradi (bu xabarlar ataylab yozilgan, mijozga
// ko'rsatish uchun xavfsiz). Kutilmagan (500) xatolar esa to'liq holda faqat
// serverga logga yoziladi — mijozga ichki tafsilot (masalan real xato matni,
// fayl yo'llari) chiqib ketmasligi uchun umumiy xabar qaytariladi.
function handleRouteError(err, res) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    res.status(status).json({ error: "Server xatosi, birozdan so'ng qayta urinib ko'ring" });
    return;
  }
  res.status(status).json({ error: err.message || 'Xatolik yuz berdi' });
}

// `fn` ba'zi route'larda async bo'lishi mumkin (masalan QR-kod generatsiyasi,
// adminTables.js) — shu holda xato `await`dan KEYIN tashlanadi va oddiy
// sinxron try/catch buni ushlamaydi (promise unhandled rejection bo'lib
// qoladi, Node 15+ esa buni butun jarayonni yiqitish bilan yakunlaydi).
// Shu sabab qaytgan qiymat promise bo'lsa, uning rad etilishi ham ushlanadi.
function asyncRoute(fn) {
  return (req, res) => {
    try {
      const result = fn(req, res);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => handleRouteError(err, res));
      }
    } catch (err) {
      handleRouteError(err, res);
    }
  };
}

// Oddiy IP-asosli rate-limiter — tashqi dependency shart emas (loyihada
// allaqachon bor narsalarga mos, savdo-hisob/asosiy ilova naqshi). Ochiq
// (login shart emas) /api/public/* endpointlar uchun — skript bilan
// minglab soxta buyurtma/bron yuborib bazani "iflos" qilishning yoki
// serverni ortiqcha yuklashning oldini olish uchun (2026-09-04 tekshiruvda
// topilgan kamchilik). `req.ip` `TRUST_PROXY=1` bo'lgani uchun asosiy
// ilovaning nginx orqali yuborgan haqiqiy mijoz IP'sini ko'rsatadi.
// Xotirada saqlanadi (bitta process, cluster emas) — restart bo'lsa
// hisoblagich tozalanadi, bu qabul qilinadi.
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: message || "Juda ko'p so'rov yuborildi, birozdan so'ng qayta urinib ko'ring" });
    }
    // Xotira cheksiz o'smasligi uchun eskirgan yozuvlarni tasodifiy tozalab turamiz.
    if (hits.size > 5000) {
      for (const [key, val] of hits) {
        if (val.resetAt <= now) hits.delete(key);
      }
    }
    next();
  };
}

// Takroriy-yuborish (idempotency) himoyasi — xavfsizlik auditi 2 (2026-10-10,
// "Buyurtma oqimi"): login shart emas yozuvchi endpointlar (checkout/bron/
// qo'lda-chek) faqat klient tomonda (tugma disable) himoyalangan edi, server
// darajasida esa yo'q edi — internet sekinligida so'rov qayta yuborilsa (yoki
// javob yo'qolib, foydalanuvchi qayta bossa) ikki marta yozuv/ombor sarfi
// yuzaga kelishi mumkin edi. Har chaqiruvchi fayl o'zining mustaqil `Map()`
// keshini yaratadi (createRateLimiter'dagi bilan bir xil "xotirada, process
// qayta tiklanganda tozalanadigan" naqsh — cluster emas, bitta jarayon).
function createIdempotencyGuard(ttlMs = 5 * 60_000) {
  const cache = new Map(); // key -> { result, expiresAt }
  return function withIdempotency(key, fn) {
    if (!key || typeof key !== 'string') return fn();
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.result;
    const result = fn();
    cache.set(key, { result, expiresAt: now + ttlMs });
    if (cache.size > 2000) {
      for (const [k, v] of cache) {
        if (v.expiresAt <= now) cache.delete(k);
      }
    }
    return result;
  };
}

module.exports = { asyncRoute, createRateLimiter, createIdempotencyGuard };
