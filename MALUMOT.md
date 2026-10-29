# Po'lat / Ziyo Famliy — loyiha haqida to'liq ma'lumot

(2026-10-15'da tayyorlangan, foydalanuvchi so'rovi bilan)

---

## 1. Ma'lumotlar bazasi

SQLite (`better-sqlite3`), fayl: `data/polat.db`. Jami **23 ta jadval**. Eng muhimlari:

### Stollar va zallar

```sql
CREATE TABLE table_zones (          -- ZALLAR
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,               -- "Katta zal", "Kichik zal" va h.k.
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE tables (                -- STOLLAR
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                -- stol raqami/nomi (masalan "1", "2")
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  zone_id INTEGER,                   -- qaysi zalga tegishli (table_zones.id)
  created_at TEXT NOT NULL
);
```

**Diqqat:** stol raqami (`name`) HAR ZALDA alohida — ya'ni "Katta zal"da ham, "Tashqari"da ham "1"-stol bo'lishi mumkin. Shuning uchun stollar har doim `zone_id` bo'yicha guruhlab ko'rsatilishi kerak (aks holda "1,1,1,2,2,2" bo'lib aralashib ko'rinadi — bu muammo 2026-10-15'da afitsiant "Stollar" sahifasida tuzatilgan edi).

### Menyu

```sql
CREATE TABLE menu_categories (       -- KATEGORIYALAR (Taomlar, Ichimliklar...)
  id, name, sort_order, is_active, require_inventory_link, created_at
);

CREATE TABLE menu_items (             -- TAOMLAR
  id, category_id, name,
  price INTEGER,                      -- sotuv narxi (so'm)
  cost_price INTEGER,                 -- tan narxi (faqat admin ko'radi)
  is_available, is_active, sort_order,
  description, image_url, volume,
  inventory_item_id,                  -- ombor mahsuloti bilan bog'lanish (ixtiyoriy)
  parent_item_id,                     -- "turi/variant" (masalan "Osh"ning "Qovurma osh" turi)
  created_at, updated_at
);
```

"Taom turlari" alohida jadval EMAS — `menu_items.parent_item_id` orqali o'zi-o'ziga bog'lanadi (bitta daraja chuqurlik, faqat).

### Buyurtmalar (ikki XIL, bir-biridan mustaqil)

**A) Afitsiant/kassir — stolga (dine-in) buyurtma:**
```sql
CREATE TABLE orders (
  id, table_id,
  status TEXT CHECK (status IN ('open','closed')),
  opened_by, opened_at, closed_by, closed_at,
  total_amount,
  note,
  payment_method TEXT,   -- 'cash' / 'card' / 'mixed'
  cash_amount INTEGER,
  card_amount INTEGER,
  cash_shift_id INTEGER, -- qaysi kassir smenasiga tegishli
  bill_requested INTEGER DEFAULT 0  -- "mijoz hisob so'radi" belgisi
);

CREATE TABLE order_items (
  id, order_id, menu_item_id,
  name_snapshot, unit_price,   -- narx SNAPSHOT (menyu keyin o'zgarsa ham eski buyurtma o'zgarmaydi)
  quantity, subtotal,
  added_by,
  status TEXT CHECK (status IN ('active','cancelled')),
  ready_at,      -- oshpaz "tayyor" degan vaqt
  sent_at,       -- afitsiant oshxonaga yuborgan vaqt
  picked_up_at,  -- afitsiant "qabul qildim" degan vaqt
  cancelled_by, cancelled_at, cancel_reason,
  created_at
);
```

Bitta stolda bir vaqtda faqat BITTA `open` buyurtma bo'lishi mumkin (baza darajasida kafolatlangan).

**B) Mijoz (landing/QR-menyu) — olib ketish/yetkazib berish buyurtmasi:**
```sql
CREATE TABLE customer_orders (
  id, full_name, phone,
  fulfillment TEXT CHECK (fulfillment IN ('pickup','delivery')),
  address, note, total_amount,
  status TEXT CHECK (status IN ('new','confirmed','completed','cancelled')),
  location_lat, location_lng,      -- mijoz GPS (ixtiyoriy)
  delivered_at,                     -- dastavkachi yetkazgan vaqt
  assigned_courier_id,              -- qaysi dastavkachiga biriktirilgan
  cancel_reason, created_at
);
CREATE TABLE customer_order_items (id, customer_order_id, menu_item_id, name_snapshot, unit_price, quantity, subtotal);
```

### Kassa — SAVOLINGIZGA JAVOB

**Kassa alohida jadvalda EMAS — ikki joydan "yig'iladi":**

1. **`orders`** jadvalining o'zida — `payment_method`/`cash_amount`/`card_amount`/`cash_shift_id` ustunlari orqali (stol yopilganda kassir to'lov turini kiritsa shu yerga yoziladi).
2. **`manual_bills`** — kassirning "Hisoblash" (qo'lda chek, menyu tashqarisidagi erkin chek) ekranidan:
   ```sql
   CREATE TABLE manual_bills (
     id, created_by, total_amount, created_at,
     customer_phone, note, delivery_price, reason,
     payment_method, cash_amount, card_amount, cash_shift_id
   );
   CREATE TABLE manual_bill_items (id, manual_bill_id, name, unit_price, quantity, subtotal);
   ```

**Kassir smenasi** uchun alohida jadval bor:
```sql
CREATE TABLE cash_shifts (
  id, opened_by, opened_at, opening_cash,   -- smena boshida qancha naqd bo'lgan
  closed_by, closed_at,
  expected_cash,   -- tizim hisoblagan (boshlang'ich + barcha naqd to'lovlar)
  actual_cash,     -- kassir qo'lda sanagan
  variance,        -- farq (kamomad/ortiqcha)
  status TEXT CHECK (status IN ('open','closed')), note
);
```
Ya'ni kunlik hisobot (`/api/admin/reports/summary`) uchirma summa **3 manbadan** qo'shiladi: `orders` (stol) + `customer_orders` (onlayn) + `manual_bills` (qo'lda chek).

### Boshqa muhim jadvallar (qisqacha)
- `users` — xodimlar (pastda, 4-bo'limda).
- `inventory_items` / `inventory_movements` / `inventory_categories` — ombor (suv, salfetka va h.k.), kirim/chiqim tarixi.
- `expenses` — kunlik xarajatlar.
- `reservations` — mijozning "stol bron qilish" so'rovi.
- `notifications` — afitsiantga "taom tayyor" bildirishnomasi.
- `print_requests` — admin/kassir chek chop etish navbati.
- `kitchen_tickets` / `kitchen_ticket_items` — oshxona printeriga avtomatik chop etiladigan zakaz-cheklari.
- `print_jobs` — tashqi (repo'dan tashqarida, zip orqali tarqatiladigan) oshxona printer-agenti uchun navbat.
- `audit_log` — kim/qachon narx o'zgartirgan, xodim yaratgan/o'chirgan (moliyaviy hisobdorlik uchun).
- `login_attempts` — har login urinishi (muvaffaqiyatli/muvaffaqiyatsiz).

To'liq, so'zma-so'z sxema kerak bo'lsa:
```bash
node -e "const db=require('better-sqlite3')('data/polat.db');console.log(db.prepare(\"SELECT sql FROM sqlite_master WHERE type='table'\").all().map(r=>r.sql).join(';\n\n'))"
```

---

## 2. Fayl tuzilishi

**EJS YO'Q.** Sahifalar — **oddiy HTML + vanilla JS** (hech qanday frontend framework/build bosqichi yo'q), Express ularni `public/` papkadan to'g'ridan-to'g'ri diskdan xizmat qiladi.

```
server/
  index.js          — Express bootstrap, barcha route'larni ulaydi
  db.js             — SQLite ulanish + barcha migratsiyalar
  schema.sql        — boshlang'ich jadval ta'riflari
  auth.js           — login/logout/sessiya (pastda, 4-bo'lim)
  roles.js          — rollar ro'yxati (yagona manba)
  printer.js        — oshxona printer-agenti bilan WebSocket aloqa
  backup.js         — kunlik avtomatik baza zaxirasi
  routeUtils.js     — umumiy yordamchi (xato ushlash)
  services/         — biznes-mantiq (orders.js, inventory.js, cashShifts.js, manualBills.js...)
  routes/           — har bir rol uchun alohida fayl:
    waiterTables.js, waiterOrders.js, waiterMenu.js       — afitsiant
    chefKitchen.js                                         — oshpaz
    courierOrders.js                                       — dastavkachi
    kassirTables.js, kassirBilling.js, kassirMenu.js, kassirShifts.js — kassir
    adminTables.js, adminMenu.js, adminUsers.js, adminInventory.js,
    adminExpenses.js, adminReports.js, adminReservations.js,
    adminCustomerOrders.js, adminAudit.js, adminCashShifts.js, adminQz.js — admin
    publicMenu.js, publicReservations.js, publicCustomerOrders.js, publicTables.js — mijoz (login shart emas)

public/
  app.js, style.css           — barcha xodim sahifalari uchun UMUMIY (fetch wrapper, toast, modal, chek/QZ Tray)
  menu-picker.js               — menyu-tanlash kartochkasi komponenti (afitsiant+kassir umumiy)
  login.html, login.js         — yagona kirish sahifasi (barcha rol uchun)
  landing/                     — mijozlar uchun (login shart emas): bosh sahifa, menyu+savat, QR-menyu
  waiter/   — tables.html/js (stollar), order.html/js (taom qo'shish/yopish), receipt.html/js
  chef/     — kitchen.html/js (oshxona ekrani)
  courier/  — orders.html/js (yetkazib berish)
  kassir/   — tables.html/js, order.html/js, manual.html/js (qo'lda chek), stats.html/js
  admin/    — index/menu/tables/waiters/expenses/reservations/customer-orders/inventory/reports/audit/cash-shifts (+layout.js, theme.css)
```

---

## 3. Mavjud oqim

### "+" bosilganda (afitsiant, menyudan taom tanlaganda)
- Frontend: `public/waiter/order.js` → `addItem(menuItemId)`
- So'rov: `POST /api/waiter/tables/:id/items` body: `{menu_item_id, quantity}`
- Backend: `server/routes/waiterOrders.js` → `services/orders.js`ning `addItemToTable()`
- Nima yoziladi: agar stolda ochiq buyurtma yo'q bo'lsa — avval `orders`ga yangi qator (status='open'), keyin `order_items`ga yangi qator (`sent_at=NULL` — hali oshxonaga yuborilmagan, "Kutilmoqda" belgisi bilan turadi).
- **Muhim:** taom qo'shilgani bilanoq oshxonaga ko'rinmaydi! Afitsiant barcha taomni yig'ib bo'lgach, alohida **"🍽️ Oshxonaga yuborish"** tugmasini bosishi kerak (`POST /tables/:id/send`) — shundan keyingina oshpaz ekranida chiqadi va bir vaqtda avtomatik oshxona printeriga chek (`kitchen_tickets`) yaratiladi.

### "Hisob-kitob" tugmasi
- **Afitsiant** tomondan: `POST /api/waiter/tables/:id/close` (`waiterOrders.js` → `closeTable()`). Narxni afitsiant chop ETMAYDI — `print_requests` jadvaliga yoziladi, **admin** panelida bildirishnoma chiqadi, admin "Chekni chop etish"ni bosganda modal ichida QZ Tray orqali printerga chiqadi.
- **Kassir** tomondan: `POST /api/kassir/tables/:id/close` (`kassirTables.js`) — avval to'lov turi (naqd/karta/aralash) so'raladi (`shift-ui.js`dagi modal), shundan keyin xuddi shu `closeTable()` chaqiriladi, lekin to'lov ma'lumoti bilan birga — va chek **kassirning o'zida** (yoki tashqi printer-agenti orqali) chiqadi, admin navbatiga tushmaydi.

### Oshxona qanday ko'radi
- **Alohida sahifa:** `/chef/kitchen.html` — oshpaz login qilib kiradi, 15 soniyada avtomatik yangilanadi, band stollar + onlayn (olib ketish/yetkazib berish) buyurtmalarni ko'radi, "✅ Tasdiqlash"/"🏁 Tayyor" tugmalari bilan.
- **Printerda ham:** `sendPendingItems()` chaqirilganda `kitchen_tickets`/`kitchen_ticket_items`ga yoziladi — bu yoki (a) oshpaz kompyuteridagi brauzerning o'zi (QZ Tray orqali, "Oshxona-Printer"/"Kassa-Printer" nomli) chop etadi, yoki (b) repo'dan TASHQARIDA (`print-agent.js`, zip fayl sifatida tarqatiladi) ishlaydigan mustaqil Node.js skript tarmoq orqali ulangan termal printerga chop etadi (`print_jobs` jadvali orqali navbat).
- **Telegram bot YO'Q** — bu loyihada oshxona/kassa bildirishnomasi faqat veb-sahifa + termal printer orqali, Telegram bilan aloqasi yo'q.

### Kassir qaysi sahifadan foydalanadi
- `/kassir/tables.html` — stollar ro'yxati (afitsiantnikiga o'xshash, lekin taom qo'sha olmaydi).
- `/kassir/order.html` — bitta stolning joriy buyurtmasi, FAQAT ko'rish + "💳 Hisob-kitob qilish".
- `/kassir/manual.html` — "Hisoblash" — stolga bog'liq bo'lmagan, erkin qo'lda chek (mijoz kelib picha/pivo olsa, stol band qilmasdan).
- `/kassir/stats.html` — kunlik qo'lda-chek statistikasi.

---

## 4. Foydalanuvchilar

**5 ta rol:** `admin`, `waiter` (afitsiant), `chef` (oshpaz), `courier` (dastavkachi), `kassir`.

Hozirgi production'da: 1 admin, 2 afitsiant, 2 oshpaz, 1 dastavkachi, 1 kassir (jami 7 ta faol hisob).

**Login — signed HttpOnly cookie, JWT EMAS:**
- Cookie nomi: `polat_session`.
- Parolni (scrypt + tuz bilan xeshlangan) tekshirgandan so'ng, foydalanuvchi `id`'si `HMAC-SHA256` bilan imzolanib cookie'ga yoziladi (`${userId}.${imzo}` ko'rinishida).
- Har so'rovda cookie qayta tekshiriladi VA foydalanuvchi bazadan `is_active=1` bilan qayta o'qiladi — demak xodimni "faolsizlantirish" darhol kuchga kiradi, eski cookie ham ishlamay qoladi (standart JWT'dan farqli — JWT muddati tugamaguncha serverga qarab o'tirmaydi).
- Har bir rol faqat o'z sahifalariga (`/waiter/*`, `/chef/*` va h.k.) kira oladi, **admin — hammasiga**.
- Login urinishlari (muvaffaqiyatli/muvaffaqiyatsiz) `login_attempts` jadvaliga yoziladi + 5-urinishdan keyin 1 daqiqaga bloklanadi (brute-force himoyasi).

---

## 5. Real ma'lumot (production, hozirgi holat)

**4 ta zal, jami 24 ta stol:**

| Zal | Stollar soni | Stol raqamlari |
|---|---|---|
| Katta zal | 9 | 1–9 |
| Kichik zal | 7 | 1–7 |
| Oilaviy hona | 3 | 1–3 |
| Tashqari | 5 | 1–5 |

**Menyu kategoriyalari:** Taomlar, Shirinliklar, Ichimliklar, Muzqaymoq.

**Xodimlar (rol bo'yicha):** 1 admin, 2 afitsiant, 2 oshpaz, 1 dastavkachi, 1 kassir.
