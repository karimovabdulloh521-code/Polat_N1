// Asosiy claude-code-web / savdo-hisob'dagi signed-cookie auth falsafasi
// (HMAC-SHA256 bilan imzolangan HttpOnly cookie, alohida session-store kerak
// emas) — lekin bu yerda BITTA umumiy parol emas, balki ko'p foydalanuvchi
// (admin + afitsiantlar, har biri o'z login/paroli) bor. Shu sabab cookie
// 'ok' emas, foydalanuvchi id'sini imzolaydi, va har so'rovda DB'dan
// `is_active=1` bilan qayta tekshiriladi — afitsiantni faolsizlantirish
// darhol kuchga kiradi (eski cookie ham endi ishlamay qoladi).
const crypto = require('crypto');
const { db } = require('./db');
const { verifyPassword } = require('./passwords');
const { ROLE_NAMES, homeForRole } = require('./roles');

// Cookie nomi ataylab "session"/"savdo_session" EMAS — umumiy nom ishlatilsa
// boshqa ilova bilan to'qnashish ehtimoli bor edi. ESKATMA (2026-09-09'da
// tuzatildi): bu ilova ILGARI asosiy saytning /polat/ ostki yo'lida proksi
// qilingan edi, lekin bu proksi allaqachon olib tashlangan — endi mustaqil
// polatuz.duckdns.org subdomenida ishlaydi (root CLAUDE.md'ga qarang). Nomi
// shunday (o'ziga xos) qoldirilgan — o'zgartirishga hojat yo'q.
const COOKIE_NAME = 'polat_session';

const OPEN_PATHS = new Set([
  '/login.html',
  '/login.js',
  '/api/login',
  '/api/ping',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icon.svg',
  // 2026-10-10, "Oldingi audit tuzatishlari" tekshiruvi: ilgari bu ikkisi
  // mavjud EMAS edi (static fayl ham yo'q edi), shu sabab so'ralganda
  // requireAuth ularni /login.html'ga REDIRECT qilib yuborardi — qidiruv
  // tizimi botiga ("robots.txt" o'rniga login sahifasi ko'rsatilgan) va
  // sitemap botiga ham xuddi shunday noto'g'ri javob berardi.
  '/robots.txt',
  '/sitemap.xml',
  // 2026-10-25, ziyofamily.com uchun Google Search Console egalik
  // tasdiqlash fayli — yuqoridagi robots.txt/sitemap.xml bilan bir xil
  // sabab: login talab qilinsa Google buni /login.html deb o'qib,
  // tasdiqlashni rad etardi.
  '/googlea333966d6ffa2376.html',
]);

// 2026-10-10, "Rollar va ruxsatlar" auditi — "standart holda taqiqlash"
// kuchaytirildi. Ilgari: agar /api/* yo'l biror rol-prefiksiga (masalan
// /api/waiter/) mos kelmasa, areaRole topilmay, requireAuth HECH QANDAY
// cheklov qo'ymasdan next()ga o'tkazib yuborardi — yagona himoya pastroqda
// (server/index.js'da qo'lda yozilgan requireRole()) bo'lardi. Agar
// kelajakda dasturchi yangi route qo'shib requireRole()ni unutsa, u standart
// holda HAR QANDAY login qilgan xodimga (hatto kuryerga ham) ochiq bo'lib
// qolardi. Endi: rol-prefiksiga mos kelmaydigan /api/* yo'l faqat shu
// ro'yxatdagi, atayin ko'p-rolli umumiy endpointlar uchun o'tadi — boshqa
// HAMMASI standart holda 403. Static (CSS/JS) fayllarga tegilmadi — ular
// turli rol papkalari orasida ulashiladigan kod, maxfiy ma'lumot emas.
const SHARED_API_PREFIXES = ['/api/me', '/api/qz', '/api/delivery-alerts'];

function createAuth({ sessionSecret }) {
  function sign(value) {
    const h = crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
    return `${value}.${h}`;
  }

  function verify(signed) {
    if (!signed) return null;
    const idx = signed.lastIndexOf('.');
    if (idx < 0) return null;
    const value = signed.slice(0, idx);
    const sig = signed.slice(idx + 1);
    const expected = crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    return crypto.timingSafeEqual(sigBuf, expBuf) ? value : null;
  }

  function parseCookies(req) {
    const header = req.headers.cookie;
    const out = {};
    if (!header) return out;
    header.split(';').forEach((part) => {
      const idx = part.indexOf('=');
      if (idx < 0) return;
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return out;
  }

  const getUserById = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1');

  function currentUser(req) {
    const raw = parseCookies(req)[COOKIE_NAME];
    const value = verify(raw);
    if (!value) return null;
    const id = Number(value);
    if (!Number.isFinite(id)) return null;
    const user = getUserById.get(id);
    return user || null;
  }

  function setCookie(res, req, token, maxAgeSeconds) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`
    );
  }

  function requireAuth(req, res, next) {
    // /landing/* — mijozlar uchun ochiq marketing-sahifa (login shart emas).
    // /uploads/* — admin panelda taomga (ixtiyoriy) biriktirilgan rasmlar
    // (server/routes/adminMenu.js POST /upload-image) — bular ochiq landing
    // menyusida ham ko'rsatiladi, shu sabab login qilmagan mijoz brauzeri ham
    // (cookie'siz) shu rasmlarni yuklay olishi kerak (2026-09-07, rasm
    // qo'shilganda ochiq bo'lmagani sababli login sahifasiga 302 qilib
    // yuborilishi kuzatilgan bug'i tuzatildi).
    if (
      OPEN_PATHS.has(req.path) ||
      req.path === '/landing' || req.path.startsWith('/landing/') ||
      req.path.startsWith('/uploads/')
    ) {
      return next();
    }
    const user = currentUser(req);
    if (!user) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
      return res.redirect('/login.html');
    }
    req.user = user;

    // Rol bo'yicha ajratish: /admin/*, /chef/*, /waiter/*, /courier/* — har biri
    // faqat o'z roliga (admin esa hammasiga) ochiq. Har bir rol o'z nomi bilan
    // bir xil URL segmentiga ega bo'lgani uchun (masalan 'chef' -> /chef/),
    // qo'lda yozilgan ternary zanjiri o'rniga server/roles.js'dagi yagona
    // ro'yxat bo'ylab qidiramiz — yangi rol qo'shilganda bu joy o'zgarishsiz
    // qoladi (faqat roles.js'ga qo'shish kifoya).
    const areaRole = ROLE_NAMES.find(
      (r) => req.path.startsWith(`/${r}/`) || req.path.startsWith(`/api/${r}/`)
    ) || null;

    if (areaRole) {
      if (user.role !== areaRole && user.role !== 'admin') {
        if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'forbidden' });
        return res.redirect(homeForRole(user.role));
      }
    } else if (req.path.startsWith('/api/')) {
      const shared = SHARED_API_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`));
      if (!shared) return res.status(403).json({ error: 'forbidden' });
    }
    next();
  }

  // `roles` bitta satr ("admin") yoki massiv (['admin', 'chef']) bo'lishi mumkin.
  function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return (req, res, next) => {
      if (!req.user || !allowed.includes(req.user.role)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      next();
    };
  }

  // Login urinishlari tarixi (2026-10-10, "Audit izi" auditi) — muvaffaqiyatli
  // VA muvaffaqiyatsiz, ikkalasi ham. `users.last_login_at`dan farqli (u faqat
  // ENG OXIRGISINI saqlaydi, ustidan yoziladi) — bu APPEND-ONLY tarix.
  function logLoginAttempt(username, success, req) {
    db.prepare('INSERT INTO login_attempts (username, success, ip, created_at) VALUES (?, ?, ?, ?)')
      .run(username, success ? 1 : 0, req.ip || null, new Date().toISOString());
  }

  function loginRoute(req, res) {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: "Login va parol kiritilishi shart" });
    }
    const uname = username.trim();
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(uname);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      logLoginAttempt(uname, false, req);
      return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
    }
    const token = sign(String(user.id));
    setCookie(res, req, token, 2592000);
    // Kim qachon, qaysi IP'dan kirgani (2026-10-10, xavfsizlik auditi) —
    // umumiy login ulashilayotganini keyinchalik admin "Xodimlar" sahifasida
    // payqash uchun (texnik cheklov emas, faqat kuzatuv).
    db.prepare('UPDATE users SET last_login_at = ?, last_login_ip = ? WHERE id = ?')
      .run(new Date().toISOString(), req.ip || null, user.id);
    logLoginAttempt(uname, true, req);
    res.json({ ok: true, role: user.role, full_name: user.full_name || user.username });
  }

  function logoutRoute(req, res) {
    setCookie(res, req, '', 0);
    res.json({ ok: true });
  }

  function meRoute(req, res) {
    const { id, username, role, full_name } = req.user;
    res.json({ id, username, role, full_name });
  }

  return { requireAuth, requireRole, loginRoute, logoutRoute, meRoute, currentUser };
}

module.exports = { createAuth, COOKIE_NAME };
