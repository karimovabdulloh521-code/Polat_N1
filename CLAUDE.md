# Po'lat restorani — buyurtma, hisob-kitob va mijozlar sayti

Mustaqil Node.js (Express 5) + better-sqlite3 veb-ilova: o'z `package.json`, o'z serveri, o'z bazasi (`data/polat.db`). Build bosqichi yo'q — `public/` fayllarini Express to'g'ridan-to'g'ri beradi.

> **To'liq ishlar tarixi** (2026-08-25 … 2026-10-24, har bir o'zgarish sababi va tekshiruvi bilan) — `TARIX.md`. Bu fayl faqat **hozirgi** holat va ishlashdan oldin bilish SHART bo'lgan qoidalar. Biror qismni o'zgartirishdan oldin shu mavzu bo'yicha `TARIX.md`dan qidiring (`grep -n "<kalit so'z>" TARIX.md`).

## Ishga tushirilgan holat

- PM2'da **`polat`** nomi bilan, `.env`: `PORT=3213`, `HOST=127.0.0.1`, `TRUST_PROXY=1`.
- nginx (`/etc/nginx/sites-available/polatuz`, Let's Encrypt) → `127.0.0.1:3213`.
- Mijozlar: https://polatuz.duckdns.org/ (→ `/landing/`). Xodimlar: `/login.html`.
- **2026-10-25'dan qo'shimcha domen:** https://ziyofamily.com/ (va `www.ziyofamily.com`) — xuddi shu `polat` PM2 jarayoniga (`127.0.0.1:3213`) nginx orqali ulangan (`/etc/nginx/sites-available/ziyofamily`, mustaqil Certbot sertifikati). `polatuz.duckdns.org` ESKI manzil sifatida hamon ishlaydi (o'chirilmadi) — ikkalasi bir xil backend/bazaga ulangan, faqat domen nomi farq qiladi.
- Cookie nomi: `polat_session`.
- Qayta ishga tushirish: `pm2 restart polat --update-env`. Faqat `public/` o'zgarsa restart shart emas (lekin `node scripts/versiya.js` SHART — pastga qarang).

## Rollar (6 ta)

| Rol | Uy sahifasi | Vazifasi |
|---|---|---|
| Mijoz (login yo'q) | `/landing/` | Menyu, savat, olib ketish/yetkazib berish buyurtmasi, stol bron, QR-stol menyusi |
| `waiter` | `/waiter/tables.html` | Stolga taom qo'shadi → "Oshxonaga yuborish" → "Hisob-kitob → kassaga" |
| `chef` | `/chef/kitchen.html` | Oshxona ekrani, onlayn buyurtmani tasdiqlash/tayyor |
| `courier` | `/courier/orders.html` | Yetkazib berish buyurtmalari, "🚚 Yetkazildi" |
| `kassir` | `/kassir/tables.html` | Kassaga kelgan hisoblarni to'lov turi bilan to'laydi, qo'lda chek, smena ochish/yopish, mijoz buyurtmalarini ko'rish |
| `admin` | `/admin/index.html` | Hammasi (menyu, stollar, xodimlar, xarajat, bron, buyurtmalar, ombor, hisobot, kassa smenalari, audit, yetkazish hududi) |

Rollar ro'yxatining YAGONA manbasi — `server/roles.js` (auth, CHECK constraint, adminUsers shu yerdan o'qiydi). Client tomonda (`public/admin/waiters.js`, `public/login.js`) qo'lda mos saqlanadi.

## Fayl strukturasi

```
server/
  index.js        — bootstrap, CSP/HSTS, rate-limit, route ulash, statik fayl + kesh siyosati
  auth.js         — HMAC-imzolangan cookie, requireAuth (URL-prefiks bo'yicha rol), requireRole
  roles.js        — rollar ro'yxati + homeForRole()
  db.js           — ulanish (WAL, foreign_keys), schema.sql + barcha idempotent migratsiyalar
  schema.sql      — jadvallar (CREATE TABLE IF NOT EXISTS)
  passwords.js    — scrypt + timingSafeEqual
  routeUtils.js   — asyncRoute (500 tafsiloti faqat logga), createRateLimiter, createIdempotencyGuard
  printer.js      — oshxona printer agenti, WebSocket push (/print-agent, PRINT_TOKEN)
  backup.js       — kunlik db.backup() → data/backups/ + eski bildirishnomalarni tozalash
  migrate.js      — `npm run migrate`: boshlang'ich admin
  services/       — orders, inventory, cashShifts, manualBills, deliveryZone, notifications, auditLog
  routes/         — admin*.js (faqat admin), waiter*.js, chefKitchen.js, courierOrders.js,
                    kassir*.js, deliveryAlerts.js (admin+chef+courier), adminQz.js (/api/qz),
                    public*.js (login shart emas)
  qz-keys/        — QZ Tray sertifikati + MAXFIY kalit (private-key.pem — git'ga/zipga QO'SHILMASIN)
public/
  app.js          — umumiy: api(), escapeHtml(), fmtMoney(), toast(), modallar, nav/logout
  app-print.js    — chek/QZ Tray/oshxona cheki (2026-10-24'da app.js'dan ajratilgan)
  app-notify.js   — afitsiant/admin/yetkazish bildirishnomalari (2026-10-24'da ajratilgan)
  style.css, menu-picker.js, login.html/.js, robots.txt, sitemap.xml
  admin/ waiter/ chef/ courier/ kassir/ — har sahifa .html + .js
  landing/        — MIJOZ sayti (alohida dizayn, app.js'ni ULAMAYDI):
                    index.html+script.js+style.css, menu.html+menu-v2-utils.js+menu-v2.js+menu-v2.css,
                    table-menu.html+table-menu.js+menu.css (QR stol menyusi)
scripts/
  versiya.js                 — HTML'lardagi ?v= versiyani yangilaydi (JS/CSS o'zgargach SHART)
  tolanmagan-hisoblar.js     — to'lov turisiz yopilgan hisoblarni sanaydi (faqat o'qish)
  arxivla-eski-fayllar.sh    — .bak fayllarni _arxiv/'ga ko'chiradi
data/polat.db, data/backups/ — gitignored
_arxiv/                      — eski zaxira fayllar (gitignored)
```

Repo tashqarisida: **`print-agent.js`** (oshxona kompyuteridagi printer agenti, zip sifatida almashiladi, `polat-agent*.zip`/`polat-agent-ws/` gitignored).

## Ma'lumotlar bazasi — asosiy jadvallar

- `users` — hech qachon hard-delete qilinmaydi, `is_active=0`. **`printer` (rol `chef`) — odam emas, print-agent hisobi; O'CHIRMANG** (2026-10-17'da o'chirilib, oshxona printeri to'xtab qolgan).
- `tables`, `table_zones`, `menu_categories`, `menu_items` (`is_active` soft-delete, `is_available` "tugadi", `parent_item_id` variantlar, `cost_price`, `inventory_item_id`).
- `orders` / `order_items` — dine-in. Bitta stolda bitta `open` buyurtma (qisman unikal indeks). `bill_requested=1` + `status='closed'` + `payment_method IS NULL` = **kassada to'lov kutilmoqda**.
- `customer_orders` / `customer_order_items` — landing buyurtmalari. `status`: new/confirmed/completed/cancelled — **`completed` = "oshxonada tayyor", "yetkazildi" EMAS** (`delivered_at` alohida). `delivery_fee` `total_amount`ga kiradi.
- `manual_bills` / `manual_bill_items` — kassir qo'lda chek.
- `cash_shifts` — smena: kutilgan naqd = boshlang'ich + shu smenaga bog'langan `cash_amount`lar.
- `inventory_items` / `inventory_movements` — ombor; menyu bandi bog'langan bo'lsa sotuvda avtomatik ayiriladi.
- `kitchen_tickets` / `kitchen_ticket_items` — oshxona cheklari tarixi (`order_id` YOKI `customer_order_id`).
- `print_jobs` (`server/printer.js` yaratadi) — WS navbati. `printed`: 0 kutilmoqda, 1 chop etildi, 2 muddati o'tdi/urinish tugadi. `sent_count`, `last_sent_at`.
- `print_requests`, `notifications`, `reservations`, `expenses`, `settings`, `audit_log`, `login_attempts`.

Narx HAR DOIM serverda `menu_items`dan qayta hisoblanadi — mijoz/klient yuborgan narxga ishonilmaydi.

## `.env` kalitlari

| Kalit | Vazifasi |
|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Boshlang'ich admin (`npm run migrate`, mavjud bo'lsa tegilmaydi) |
| `PORT` / `HOST` | `3213` / `127.0.0.1` |
| `SESSION_SECRET` | Cookie HMAC kaliti (bo'sh bo'lsa har restartda sessiyalar bekor) |
| `TRUST_PROXY` | **`1` SHART** (nginx ortida Secure cookie / to'g'ri `req.ip`) |
| `PRINT_TOKEN` | print-agent WS tokeni. Bo'sh bo'lsa server ishlaydi, printer o'chiq |
| `PRINT_JOB_MAX_AGE_MIN` | Navbatdagi chek amal muddati, standart 120 |
| `BACKUP_KEEP` / `BACKUP_INTERVAL_HOURS` | 14 / 24 |

## Ishlashdan oldin bilish SHART bo'lgan qoidalar

1. **SQLite CHECK/NOT NULL o'zgarishi** — ALTER bilan bo'lmaydi; `db.js`dagi "jadvalni qayta qurish" naqshi (`migrateSyncUserRoles`, `migrateKitchenTicketsCustomerOrderId`). Yangi ustun — idempotent `ALTER TABLE ADD COLUMN` (+ `schema.sql`ga ham). Migratsiyani avval baza nusxasida sinang.
2. **`/api/<rol>/*` prefiksi `requireAuth`da rolga yopiladi** (admin hammasiga kiradi). Prefiksga mos kelmaydigan `/api/*` standart holda **403** — ko'p-rolli endpoint uchun `auth.js`dagi `SHARED_API_PREFIXES`ga qo'shing. Shu sabab QZ yo'li `/api/qz` (`/api/admin/qz` emas).
3. **Vaqt** — bazada UTC ISO. Kunlik hisobotda `TASHKENT_SQL_OFFSET` (`db.js`) bilan `date(x, '+5 hours')`.
4. **Global skriptlar bitta lexical scope'da** — `app.js`/`app-print.js`/`app-notify.js` va sahifa skripti bir xil nomli `let`/`const` e'lon qilsa sahifa butunlay ishlamaydi (2026-09-07 "chek yuklanmayapti" incidenti). Ulash tartibi: `app.js` → `app-print.js` → `app-notify.js` → sahifa JS.
5. **CSP** (`server/index.js`) — yangi tashqi manba (CDN, rasm, iframe) qo'shilsa CSP'ga ham qo'shing. Inline `<script>` YO'Q (faqat hash'langan JSON-LD).
6. **Kesh** — `.html` `no-cache`; `?v=` bilan `.js/.css` 7 kun; `/uploads/` 1 yil. **JS/CSS o'zgartirgach: `node scripts/versiya.js`** — aks holda mijozlarda 7 kungacha eski fayl qoladi.
7. **Oshxona printeri** — `server/printer.js` WS push. Afitsiant (`waiterOrders.js` `/send`) va landing (`publicCustomerOrders.js`) ikkalasi `req.app.locals.kitchen.printOrder()` chaqiradi; `kitchen_tickets` faqat tarix. Printer xatosi buyurtmani buzmasligi uchun try/catch ichida.
8. **Afitsiant stolni o'zi yopmaydi** — `/request-bill` → kassir `/pending-bills` → to'lov turi bilan to'laydi. Eski `POST /api/waiter/tables/:id/close` 2026-10-24'dan **410** qaytaradi.
9. **XSS** — `innerHTML`ga boriladigan har qanday ma'lumot `escapeHtml()` orqali.
10. **Test ma'lumotlari** production bazada sinalsa, keyin to'liq tozalanadi (ombor qoldig'i ham tiklanadi) va `integrity_check` qilinadi. Avval `db.backup()` nusxa.
11. **Jismoniy printerda sinash** bu muhitda mumkin emas — "printerda sinalmagan" deb aniq yozing.

## Ochiq masalalar (2026-10-24 holatiga)

- 🔴 QZ Tray maxfiy kaliti zip arxiv orqali tarqalgan bo'lishi mumkin — yangi kalit/sertifikat yaratib, kassa/oshxona kompyuterlaridagi QZ Tray'ga o'rnatish kerak.
- 🔴 `print-agent.js` chop etilgan chek `id`larini eslab, `retry:true` kelganda takror chop etmasligi kerak (agent repo tashqarisida).
- 🟡 Sessiyani bekor qilish yo'q (30 kunlik cookie, parol almashsa ham ishlaydi).
- 🟡 Onlayn buyurtma rate-limit (IP bo'yicha 10 daqiqada 5 ta) umumiy mobil IP ortidagi mijozlarni to'sishi mumkin.
- 🟡 Avtomatik testlar yo'q; tashqi (offsite) zaxira yo'q.
- 🟡 nginx'da `gzip_types` kommentda — CSS/JS siqilmaydi (root huquqi kerak, buyruq `TARIX.md` oxirida).
- 🟢 `public/landing/menu-v2.js` hamon ~900 qator (bitta yopiq `init()` ichida umumiy holat) — chuqurroq bo'lish faqat brauzer testlari bilan.
- 🟢 Standart admin paroli test uchun zaif qoldirilgan (`TARIX.md`, 2026-08-26).

## Oxirgi o'zgarishlar

- **2026-10-24** — printer navbati (muddat, retry, PRINT_TOKEN ixtiyoriy), to'lanmagan hisoblar (admin bosh sahifa/hisobot/kassir smena yopish ogohlantirishi, eski `/close` → 410), kesh siyosati + `?v=` versiyalash, `app.js` 3 faylga, `menu-v2-utils.js` ajratildi, `.bak` fayllar `_arxiv/`ga, `landing/menu.js` (ishlatilmagan) arxivga, ushbu `CLAUDE.md` qisqartirildi. Tafsilot: `TARIX.md` oxirida.
- 2026-10-23 — landing menyuda to'liq ekranli checkout, yetkazish hududi xaritasi (Leaflet).
- 2026-10-18 — landing buyurtmasi oshxona printeriga WS push orqali; kassirga "Buyurtmalar" bo'limi.
