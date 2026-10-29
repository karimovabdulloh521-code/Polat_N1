// { override: true } — savdo-hisob'dagi bilan bir xil sabab: bu jarayon ham
// claudeweb'ning bir nechta boshqa PM2 jarayoni bilan bitta muhitda ishga
// tushirilishi mumkin, shu ilovaning o'z `.env`i har doim g'olib chiqishi kerak.
require('dotenv').config({ override: true });

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const { createAuth } = require('./auth');
const { createRateLimiter } = require('./routeUtils');
const { db } = require('./db');
const { setupKitchenPrinter } = require('./printer');

const PORT = process.env.PORT || 3213;
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by'); // 2026-10-10, "Oldingi audit" tekshiruvi — ilgari har javobda "X-Powered-By: Express" chiqardi
app.use(express.json({ limit: '1mb' }));

// Xavfsizlik sarlavhalari (CSP + HSTS) — 2026-10-10, "Oldingi audit"
// tekshiruvi (ilgari ikkisi ham umuman yo'q edi). CSP qiymatlari haqiqiy
// kod bo'ylab (tashqi manbalar: QZ Tray CDN, Google Fonts, Unsplash
// rasmlar, Google Maps iframe) tekshirib chiqib tuzilgan:
//  - `style-src`da 'unsafe-inline' SHART — bu loyihada ko'p sonli sahifada
//    inline `style="..."` atributi ishlatiladi (masalan hero fon rasmi),
//    ularni butunlay CSS klassga ko'chirish bu auditning doirasidan tashqari.
//  - `script-src`da inline skript YO'Q (login.html'dagi yagona inline
//    skript shu auditda `login.js`ga ko'chirildi) — faqat bitta statik
//    JSON-LD bloki (landing/index.html) qoldi, u aniq SHA-256 "hash" bilan
//    ruxsat etilgan (butunlay boshqa matn CSP'ni o'tolmaydi).
//  - `connect-src`da QZ Tray desktop dasturi UCHUN localhost websocket
//    portlari ochiq — bu FIZIK printerga ulangan, shu muhitda sinab
//    bo'lmaydigan funksiya (polat/CLAUDE.md'ga qarang), shu sabab bu
//    ruxsat ataylab keng qoldirilgan.
// 2026-10-23 — Yetkazish hududi xaritasi (landing/menu.html) uchun Leaflet
// 1.9.4 (cdnjs) + OpenStreetMap tile'lari qo'shildi: script/style-src'da
// cdnjs.cloudflare.com, img-src'da tile.openstreetmap.org subdomenlari.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'sha256-xjvELm8zHu267MhbI8FwS882YKOJgeSkpwtdxowQtwE='",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://images.unsplash.com https://*.tile.openstreetmap.org https://cdnjs.cloudflare.com",
  "frame-src https://www.google.com",
  "connect-src 'self' wss://localhost:* https://localhost:* ws://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  // HSTS faqat haqiqiy HTTPS so'rovda (TRUST_PROXY=1 bo'lgani uchun req.secure
  // nginx'dan kelgan X-Forwarded-Proto'ga qarab to'g'ri aniqlaydi).
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// Unauthenticated health check.
app.get('/api/ping', (req, res) => {
  res.json({ ok: true });
});

// Bosh sahifa (/) — endi to'g'ridan-to'g'ri login so'ramaydi, mijozlar uchun
// ochiq landing sahifasiga yo'naltiradi. Xodimlar (admin/afitsiant) landing
// header'idagi "Kirish" tugmasi orqali /login.html'ga o'tadi.
app.get('/', (req, res) => res.redirect('/landing/'));

const auth = createAuth({ sessionSecret: SESSION_SECRET });

// Login urinishlarini IP bo'yicha cheklaymiz (2026-10-10, xavfsizlik auditi) —
// ilgari /api/login hech qanday limitga ega emas edi, parolni cheksiz avtomatik
// sinab ko'rish (brute-force) mumkin edi. `createRateLimiter` allaqachon
// pastdagi /api/public/* yo'llar uchun ishlatilayotgan umumiy yordamchi.
const loginLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  message: "Juda ko'p urinish qilindi, 1 daqiqadan so'ng qayta urinib ko'ring",
});
app.post('/api/login', loginLimiter, auth.loginRoute);
app.post('/api/logout', auth.logoutRoute);

// Landing sahifadagi bron oynasi va menyu/savat/buyurtma — mehmon login
// qilmasdan yuboradi, shu sabab requireAuth'dan OLDIN ulanadi (boshqa
// /api/admin, /api/waiter kabi emas). Login shart emasligi sababli, spam/DoS
// oldini olish uchun yozuvchi (POST) yo'llarga IP-asosli rate-limit qo'yiladi
// (2026-09-04 tekshiruvda topilgan kamchilik — o'qish uchun /menu limitsiz).
const publicWriteLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  message: "Juda ko'p so'rov yuborildi, birozdan so'ng qayta urinib ko'ring",
});
app.use('/api/public/reservations', publicWriteLimiter, require('./routes/publicReservations'));
app.use('/api/public/menu', require('./routes/publicMenu'));
// Buyurtma uchun ALOHIDA, kengroq oynali limiter (10 daqiqada 5 ta) — 2026-10-15,
// "menyu + savat" qayta dizayni. Ilgari bron bilan BIR XIL `publicWriteLimiter`
// (1 daqiqa/5 ta) ishlatilardi — checkout tabiatan bronga qaraganda sekinroq
// (savat yig'ish, forma to'ldirish) jarayon, shu sabab mustaqil hisoblagich
// bilan ajratildi (bron limiti o'zgarishsiz qoladi).
const ordersLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  max: 5,
  message: "Juda ko'p buyurtma urinishi, birozdan so'ng qayta urinib ko'ring",
});
app.use('/api/public/orders', ordersLimiter, require('./routes/publicCustomerOrders'));
// Stol QR kodi ochadigan /landing/table-menu.html shu yerdan stol nomini
// oladi (login shart emas, 2026-10-10).
app.use('/api/public/tables', require('./routes/publicTables'));
app.use('/api/public/delivery-zone', require('./routes/publicDeliveryZone'));

app.use(auth.requireAuth);
app.get('/api/me', auth.meRoute);

app.use('/api/admin/menu', auth.requireRole('admin'), require('./routes/adminMenu'));
app.use('/api/admin/inventory', auth.requireRole('admin'), require('./routes/adminInventory'));
app.use('/api/admin/users', auth.requireRole('admin'), require('./routes/adminUsers'));
app.use('/api/admin/tables', auth.requireRole('admin'), require('./routes/adminTables'));
app.use('/api/admin/expenses', auth.requireRole('admin'), require('./routes/adminExpenses'));
app.use('/api/admin/reports', auth.requireRole('admin'), require('./routes/adminReports'));
app.use('/api/admin/reservations', auth.requireRole('admin'), require('./routes/adminReservations'));
app.use('/api/admin/customer-orders', auth.requireRole('admin'), require('./routes/adminCustomerOrders'));
app.use('/api/admin/print-requests', auth.requireRole('admin'), require('./routes/adminPrintRequests'));
app.use('/api/admin/audit', auth.requireRole('admin'), require('./routes/adminAudit'));
// '/api/admin/qz' EMAS, '/api/qz' — 2026-09-09'da topilgan bug: kassir
// sahifasi (public/kassir/*) chek chop etishda public/app.js'dagi UMUMIY
// printReceiptView()/setupQzSecurity() orqali shu yerga murojaat qiladi, lekin
// kassir 'admin' emas. requireRole(['admin','kassir']) yetarli emas edi —
// auth.js'dagi requireAuth() O'ZI, bu router'ga yetib kelishdan OLDIN, HAR
// QANDAY '/api/admin/*' yo'lni faqat 'admin' roliga yopib qo'yadi (areaRole
// tekshiruvi, URL prefiksiga qarab). Shu sabab yo'l butunlay '/api/admin/'
// prefiksidan tashqariga ('/api/qz') ko'chirildi — endi faqat pastdagi
// requireRole(['admin','kassir']) ishlaydi. Bu endpointlar faqat ochiq
// sertifikat + imzolash (yozish/o'qish huquqi bermaydi, faqat printer
// ulanishini tasdiqlaydi) — kassirga ham ochish xavfsiz. 'chef' 2026-09-20'da
// qo'shildi — oshpaz kompyuteri endi oshxona cheklarini avtomatik QZ Tray
// orqali chop etadi (public/app.js, initChefKitchenTicketPrinting()).
app.use('/api/qz', auth.requireRole(['admin', 'kassir', 'chef']), require('./routes/adminQz'));

app.use('/api/waiter', require('./routes/waiterTables'));
app.use('/api/waiter', require('./routes/waiterMenu'));
app.use('/api/waiter', require('./routes/waiterOrders'));
app.use('/api/waiter/notifications', require('./routes/waiterNotifications'));

app.use('/api/chef', auth.requireRole(['admin', 'chef']), require('./routes/chefKitchen'));

app.use('/api/courier', auth.requireRole(['admin', 'courier']), require('./routes/courierOrders'));

app.use('/api/kassir', auth.requireRole(['admin', 'kassir']), require('./routes/kassirTables'));
app.use('/api/kassir', auth.requireRole(['admin', 'kassir']), require('./routes/kassirBilling'));
app.use('/api/kassir', auth.requireRole(['admin', 'kassir']), require('./routes/kassirMenu'));
app.use('/api/kassir', auth.requireRole(['admin', 'kassir']), require('./routes/kassirShifts'));
app.use('/api/kassir', auth.requireRole(['admin', 'kassir']), require('./routes/kassirCustomerOrders'));

app.use('/api/admin/cash-shifts', auth.requireRole('admin'), require('./routes/adminCashShifts'));
app.use('/api/admin/delivery-zone', auth.requireRole('admin'), require('./routes/adminDeliveryZone'));

app.use('/api/delivery-alerts', auth.requireRole(['admin', 'chef', 'courier']), require('./routes/deliveryAlerts'));

// Keshlash siyosati (2026-10-24, "Tezlik"). Ilgari hamma narsa
// `max-age=0` bilan berilardi — har sahifa ochilganda barcha CSS/JS qayta
// so'ralardi.
//  - .html — `no-cache`: har doim serverdan tekshiriladi (ETag bo'yicha 304),
//    shuning uchun yangi versiya havolalari darhol ko'rinadi.
//  - ?v=... bilan so'ralgan .js/.css — 7 kun. Versiya `scripts/versiya.js`
//    bilan HTML'larga qo'yiladi; fayl o'zgarsa versiya o'zgaradi -> yangi URL.
//  - versiyasiz .js/.css/manifest — `no-cache` (eski xatti-harakat, xavfsiz).
//  - /uploads/* — 1 yil, immutable: fayl nomlari tasodifiy, hech qachon
//    ustidan yozilmaydi (server/routes/adminMenu.js, multer filename).
//  - boshqa rasm/shrift (svg/png/jpg/webp/woff2) — 7 kun.
const WEEK = 7 * 24 * 60 * 60;
const STATIC_ASSET_RE = /\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|ttf)$/i;
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    const req = res.req;
    const urlPath = req ? req.path : '';
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (urlPath.startsWith('/uploads/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (/\.(?:js|css)$/i.test(filePath)) {
      const versioned = req && req.query && typeof req.query.v === 'string' && req.query.v !== '';
      res.setHeader('Cache-Control', versioned ? `public, max-age=${WEEK}` : 'no-cache');
    } else if (STATIC_ASSET_RE.test(filePath)) {
      res.setHeader('Cache-Control', `public, max-age=${WEEK}`);
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Auth middleware'dan o'tgan (yoki OPEN_PATHS'dagi) hamma narsa uchun SPA-style
// fallback shart emas — har sahifa o'zining .html fayli, static middleware
// buni allaqachon hal qiladi. 404'larni ham shunchaki Expressning standart
// handleriga qoldiramiz.

// `require.main === module` — faqat `node server/index.js` sifatida to'g'ridan-to'g'ri
// ishga tushirilganda (production/PM2) real portda tinglaydi. Boshqa skript
// `require('./index.js')` qilsa, faqat `app` obyekti eksport qilinadi.
if (require.main === module) {
  require('./backup').startBackupSchedule();
  const server = app.listen(PORT, HOST, () => {
    console.log(`polat http://${HOST}:${PORT} manzilida ishga tushdi`);
  });
  // Oshxona printer agenti (WebSocket, wss://<domen>/print-agent) — agent
  // Authorization: Bearer <PRINT_TOKEN> bilan ulanadi, {type:"job",...} oladi,
  // {type:"printed",...} bilan javob qaytaradi (server/printer.js).
  const kitchen = setupKitchenPrinter(server, db, process.env.PRINT_TOKEN);
  app.locals.kitchen = kitchen;
}

module.exports = app;
