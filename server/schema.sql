-- Po'lat restorani bazasi. Barcha jadvallar CREATE TABLE IF NOT EXISTS —
-- server/db.js har safar ko'tarilishida shu faylni qayta qo'llaydi, mavjud
-- ma'lumotga tegmaydi.

-- Foydalanuvchilar: admin + afitsiantlar + oshpazlar + dastavkachilar. Hech
-- qachon hard-delete qilinmaydi (orders/order_items/expenses ularga FK bilan
-- bog'langan) — faqat is_active=0. ESKATMA: 'chef' roli 2026-08-26'da,
-- 'courier' (Dastavka) roli 2026-09-08'da qo'shildi — mavjud (eski)
-- bazalarda bu CHECK'ni o'zgartirish uchun server/db.js'dagi
-- migrateAddChefRole()/migrateAddCourierRole() ishlatiladi (SQLite'da
-- ustunning CHECK'ini to'g'ridan to'g'ri ALTER qilib bo'lmaydi, shu sabab
-- jadval qayta qurib ko'chiriladi).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'waiter', 'chef', 'courier')),
  full_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Stollar joylashgan zonalar (masalan "Zal", "Tashqari") — faqat guruhlash
-- yorlig'i, inventory_categories bilan bir xil oddiy naqsh (is_active shart
-- emas — zona o'chirilsa shunchaki hard-delete qilinadi, unga tegishli
-- stollar zone_id=NULL bo'lib "Joysiz" guruhga tushadi).
CREATE TABLE IF NOT EXISTS table_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Restoran stollari.
CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  zone_id INTEGER REFERENCES table_zones(id),
  created_at TEXT NOT NULL
);

-- require_inventory_link (2026-09-07) — 1 bo'lsa, shu kategoriyadagi taomlar
-- mijoz (landing)/afitsiant menyusida FAQAT ombor mahsulotiga bog'langan
-- (menu_items.inventory_item_id NOT NULL) bo'lsagina ko'rinadi — bog'lanmagan
-- taomlar (masalan hali ombor bilan sozlanmagan qoralama yozuv) yashirin
-- turadi (server/routes/publicMenu.js, waiterMenu.js). Admin panelida
-- (public/admin/menu.js) BARCHASI hamon ko'rinadi — filtr faqat mijoz/afitsiant
-- tomonida. Masalan "Ichimliklar" kategoriyasi uchun yoqiladi (faqat haqiqiy
-- ombor zaxirasi bor ichimlik ko'rinsin, xayoliy/eskirgan yozuv emas).
CREATE TABLE IF NOT EXISTS menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  require_inventory_link INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES menu_categories(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL, -- so'm — sotuv narxi
  cost_price INTEGER, -- so'm — tan narxi (ixtiyoriy, admin-only, 2026-09-08; ombor bilan
                       -- bog'langan taomda inventory_items.cost_price'dan avtomatik olinadi)
  is_available INTEGER NOT NULL DEFAULT 1, -- tezkor "tugadi" belgisi
  is_active INTEGER NOT NULL DEFAULT 1, -- soft-delete
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- parent_item_id (2026-09-09) — "turi" (variant) funksiyasi: shu taom boshqa
  -- (parent_item_id=NULL) taomning bir turi/o'xshashi bo'lsa shu yerga ota taom
  -- id'si yoziladi. NULL = oddiy/asosiy taom. Faqat BITTA daraja chuqurlikka
  -- ruxsat (variant o'zi ota bo'la olmaydi — server/routes/adminMenu.js
  -- tekshiradi). Mijoz/afitsiant menyusida (publicMenu.js/waiterMenu.js/
  -- kassirMenu.js) faqat ota (parent_item_id IS NULL) taomlar asosiy ro'yxatda
  -- chiqadi, turlar shu taomning "variants" massivida ichma-ich qaytariladi va
  -- frontendda "Turlari (N)" tugmasi bosilgandagina ko'rinadi (2026-09-09,
  -- public/admin/menu.js "+ Turi qo'shish" tugmasi orqali qo'shiladi). FK emas
  -- (SQLite ALTER bilan FK qo'shib bo'lmaydi) — ilova darajasida bog'lanish.
  parent_item_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
-- idx_menu_items_parent SHU YERDA EMAS — server/db.js'dagi migrateAddMenuItemParent()
-- ichida yaratiladi. Sabab xuddi pastdagi idx_notifications_ack izohidagidek: eski
-- (parent_item_id ustuni qo'shilishidan oldingi) bazalarda CREATE TABLE IF NOT EXISTS
-- mavjud jadvalga tegmaydi, shu sabab bu yerda turgan CREATE INDEX ustun hali ALTER
-- bilan qo'shilmasdan turib ishga tushib, "no such column" xatosi bilan butun
-- serverni yiqitadi (2026-09-09'da xuddi shu naqsh bilan sinab ko'rilganda topilgan).

-- Bitta stolda bir vaqtning o'zida faqat bitta 'open' buyurtma bo'lishi mumkin —
-- pastdagi qisman unikal indeks buni DB darajasida kafolatlaydi.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES tables(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  total_amount INTEGER,
  note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_open_per_table
  ON orders(table_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Append-only qatorlar: mehmon ovqat davomida qo'shimcha buyursa, shu ochiq
-- buyurtmaga yangi qator qo'shiladi (eskisi o'zgarmaydi). Narx har doim
-- qo'shilgan paytdagi nusxa (unit_price) — menyu narxi keyin o'zgarsa ham
-- eski buyurtmalar o'zgarmay qoladi.
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
  name_snapshot TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  subtotal INTEGER NOT NULL,
  added_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  ready_at TEXT, -- oshpaz "tayyor" deb belgilagan vaqt (NULL = hali tayyor emas)
  sent_at TEXT, -- afitsiant "Oshxonaga yuborish" bosgan vaqt (NULL = hali yuborilmagan,
                -- oshpaz kitchen ekranida ko'rmaydi — server/routes/chefKitchen.js filtrlaydi)
  picked_up_at TEXT, -- afitsiant "Qabul qildim" bosgach to'ldiriladi (server/routes/waiterNotifications.js) —
                      -- shundan keyin taom oshpaz ekranidan yo'qoladi (chefKitchen.js filtrlaydi)
  note TEXT NOT NULL DEFAULT '', -- afitsiant oshpazga yozgan ixtiyoriy izoh (2026-10-15, "Stollar"/"Buyurtma"
                                  -- sahifalari qayta dizayni) — faqat sent_at IS NULL bo'lganda tahrirlanadi
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount INTEGER NOT NULL,
  expense_date TEXT NOT NULL, -- YYYY-MM-DD
  note TEXT,
  category TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

-- Umumiy key/value sozlamalar (restoran nomi/manzil/telefon — chek sarlavhasi uchun).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Landing sahifadagi "Stol bron qilish" oynasidan kelgan so'rovlar. Mehmon
-- login qilmasdan yuboradi (server/routes/publicReservations.js, ochiq API),
-- admin panelda ko'rib chiqiladi (server/routes/adminReservations.js).
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  party_size INTEGER NOT NULL DEFAULT 2,
  res_date TEXT NOT NULL, -- YYYY-MM-DD
  res_time TEXT NOT NULL, -- HH:MM
  note TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(res_date);

-- Landing sahifadagi menyu + savat orqali kelgan olib ketish/yetkazib berish
-- buyurtmalari. Mehmon login qilmasdan yuboradi (server/routes/publicMenu.js +
-- publicCustomerOrders.js, ochiq API), admin panelda ko'rib chiqiladi
-- (server/routes/adminCustomerOrders.js). Ichki afitsiant `orders` jadvalidan
-- ATAYLAB alohida — u yerda opened_by/table_id majburiy (login qilingan
-- afitsiant + stol talab qiladi), bu yerda esa mehmon hech biriga bog'liq emas.
CREATE TABLE IF NOT EXISTS customer_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  fulfillment TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfillment IN ('pickup', 'delivery')),
  address TEXT,
  location_lat REAL,
  location_lng REAL,
  note TEXT,
  total_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'completed', 'cancelled')),
  -- Dastavkachi (courier roli, 2026-09-08) "🚚 Yetkazildi" bosgan vaqt.
  -- `status`dan ATAYLAB alohida — 'status' allaqachon oshpaz tomonidan
  -- "tayyor" ma'nosida ('completed') ishlatiladi (server/routes/chefKitchen.js),
  -- shu sabab yetkazib berish faktini alohida nullable ustunda kuzatamiz.
  -- NULL = hali yetkazilmagan.
  delivered_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_orders_status ON customer_orders(status);

CREATE TABLE IF NOT EXISTS customer_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_order_id INTEGER NOT NULL REFERENCES customer_orders(id),
  menu_item_id INTEGER REFERENCES menu_items(id),
  name_snapshot TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_order_items_order ON customer_order_items(customer_order_id);

-- Oshpaz dine-in taomni "🏁 Tayyor" deb belgilaganda (server/routes/chefKitchen.js)
-- afitsiantga ko'rsatiladigan bildirishnoma. Afitsiant ekrani (public/app.js)
-- har necha soniyada hali TASDIQLANMAGAN (acknowledged_at IS NULL) yozuvlarni
-- so'rab oladi (poll) va "Qabul qildim" tugmasi bilan ko'rsatadi; bosilgach
-- /api/waiter/notifications/:id/acknowledge shu qatorni kim (acknowledged_by_name)
-- va qachon (acknowledged_at) tasdiqlaganini yozadi. `is_read` eski (admin
-- versiyasidan qolgan, endi ishlatilmaydi) ustun — orqaga moslik uchun saqlangan.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  acknowledged_at TEXT,
  acknowledged_by_name TEXT,
  order_item_id INTEGER REFERENCES order_items(id), -- qaysi taomga tegishli (dine-in "tayyor"
                                                      -- bildirishnomasi uchun) — tasdiqlangach shu
                                                      -- taom order_items.picked_up_at bilan belgilanadi
                                                      -- va oshpaz ekranidan yo'qoladi (chefKitchen.js)
  -- Yangi yetkazib berish (delivery) mijoz buyurtmasi kelganda (2026-09-08,
  -- server/routes/publicCustomerOrders.js) admin+oshpaz+dastavkachiga baravar
  -- ko'rsatiladigan bildirishnoma shu ustun bilan belgilanadi (order_item_id
  -- dine-in'ga xos bo'lgani uchun ATAYLAB alohida). server/routes/deliveryAlerts.js
  -- shu ustun to'ldirilgan qatorlarni o'qiydi/tasdiqlaydi.
  customer_order_id INTEGER REFERENCES customer_orders(id),
  created_at TEXT NOT NULL
);

-- Afitsiant stolni yopib hisob-kitob qilganda (2026-09-06'dan) chek endi
-- afitsiantning o'z ekranida CHOP ETILMAYDI — termal printer faqat
-- administrator kompyuteriga ulangani uchun bu jadvalga "chop etish kutilmoqda"
-- yozuvi qo'shiladi (server/services/orders.js closeTable()). Admin panelida
-- (public/app.js, initAdminPrintRequests) har necha soniyada printed_at IS NULL
-- bo'lgan yozuvlar so'raladi (poll) va "Chekni chop etish" tugmasi bilan
-- ko'rsatiladi; bosilganda /api/admin/print-requests/:id/printed shu qatorni
-- kim (printed_by) va qachon (printed_at) chop etganini yozadi.
CREATE TABLE IF NOT EXISTS print_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  created_at TEXT NOT NULL,
  printed_at TEXT,
  printed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_print_requests_pending ON print_requests(printed_at);

-- Afitsiant "🍽️ Oshxonaga yuborish" tugmasini bosganda (2026-09-20'dan) har
-- safar bitta "oshxona cheki" yaratiladi — server/services/orders.js'dagi
-- sendPendingItems(). print_requests'dan farqli, bu yerda ADMIN tugma
-- bosishini kutmaydi: oshpaz kompyuteridagi /chef/kitchen.html sahifasi
-- (public/app.js, initChefKitchenTicketPrinting()) buni har necha soniyada
-- so'rab (poll), HECH QANDAY tugma bosilmasdan darhol QZ Tray orqali
-- oshxona printeriga chop etadi, so'ng printed_at'ni belgilaydi. table_name
-- — buyurtma paytidagi stol nomi nusxasi (keyin stol nomi o'zgarsa ham chek
-- matni o'zgarmaydi, order_items.name_snapshot bilan bir xil mantiq).
-- 'customer_order_id' (2026-10-18) — mijoz landing saytidan (olib ketish/
-- yetkazib berish) buyurtma berganda ham xuddi shu navbatga yoziladi, shu
-- sabab 'order_id' endi IXTIYORIY (dine-in buyurtmada to'ldiriladi,
-- mijoz-buyurtmasida bo'sh qoladi) — ikkalasidan aynan bittasi to'ldiriladi.
CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  customer_order_id INTEGER REFERENCES customer_orders(id),
  table_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  printed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_pending ON kitchen_tickets(printed_at);

CREATE TABLE IF NOT EXISTS kitchen_ticket_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kitchen_ticket_id INTEGER NOT NULL REFERENCES kitchen_tickets(id),
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '' -- order_items.note'dan nusxa (2026-10-15) — oshpaz ekranida ko'rinishi uchun
);
CREATE INDEX IF NOT EXISTS idx_kitchen_ticket_items_ticket ON kitchen_ticket_items(kitchen_ticket_id);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read);
-- idx_notifications_ack SHU YERDA EMAS — server/db.js'dagi migrateAddNotificationAck()
-- ichida yaratiladi. Sabab: eski (bu ustun qo'shilishidan oldingi) bazalarda
-- CREATE TABLE IF NOT EXISTS mavjud jadvalga tegmaydi, shu sabab bu yerda turgan
-- CREATE INDEX ustun hali ALTER bilan qo'shilmasdan turib ishga tushib, "no such
-- column" xatosi bilan butun serverni yiqitadi (2026-08-26'da amalda topilgan bug).

-- Ombor mahsuloti TURKUMI (2026-09-26) — masalan "Ichimliklar", "Tozalash
-- vositalari" — FAQAT Ombor sahifasida mahsulotlarni ustunlarga ajratib
-- ko'rsatish uchun. `menu_categories`dan ATAYLAB MUSTAQIL — ombor mahsuloti
-- (masalan salfetka) menyuga umuman bog'lanmasligi ham mumkin.
CREATE TABLE IF NOT EXISTS inventory_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Ombor (2026-09-07): suv/salfetka va shunga o'xshash sotiladigan/sarflanadigan
-- mahsulotlar qoldig'i. `menu_items.inventory_item_id` (server/db.js'dagi
-- migrateAddMenuItemInventoryLink()) orqali ixtiyoriy ravishda bitta menyu
-- taomiga bog'lanadi — bog'langan taomning `is_available`si endi QO'LDA emas,
-- shu ombor mahsulotining qoldig'idan AVTOMATIK hisoblanadi (server/services/inventory.js
-- syncMenuAvailability(): qoldiq > 0 bo'lsa mavjud, 0 bo'lsa "tugadi"). Bir nechta
-- menyu taomi (masalan "Suv 0.5L" va "Suv 1L") bitta ombor mahsulotiga bog'lanishi
-- CHEKLANMAGAN — agar ular haqiqatan bitta jismoniy zaxiradan sarflansa.
-- cost_price (tan narxi — admin necha pulga xarid qilgani) va sale_price (sotuv
-- narxi) 2026-09-07'da qo'shildi. sale_price shu mahsulotga bog'langan HAR BIR
-- menyu taomining `menu_items.price`ini AVTOMATIK belgilaydi (server/services/inventory.js
-- syncMenuPricing()) — admin narxni ikki joyda alohida kiritmaydi, yagona manba
-- shu yerda. cost_price esa faqat Ombor sahifasida (admin/inventory.js, foyda
-- ko'rsatkichi uchun) ko'rinadi — MENYUDA HECH QACHON chiqmaydi (faqat sale_price
-- orqali menu_items.price'ga o'tadi, o'zi emas). category_id/image_url 2026-09-26'da
-- qo'shildi (turkumga ajratish + ixtiyoriy rasm, faqat Ombor sahifasida ko'rinadi).
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'dona', -- o'lchov birligi: dona/litr/kg/quti va h.k. (erkin matn)
  quantity INTEGER NOT NULL DEFAULT 0, -- joriy qoldiq (butun son — kasr birliklar kerak bo'lsa kelajakda o'zgartiriladi)
  low_stock_threshold INTEGER NOT NULL DEFAULT 0, -- shu songa yetsa/kam bo'lsa admin panelida "kam qoldi" belgisi (0 = o'chirilgan)
  cost_price INTEGER NOT NULL DEFAULT 0, -- tan narxi (so'm/birlik) — ixtiyoriy, 0 = kiritilmagan
  sale_price INTEGER NOT NULL DEFAULT 0, -- sotuv narxi (so'm/birlik) — bog'langan menyu taomiga shu narx o'tadi
  volume TEXT, -- hajmi (2026-09-07, masalan suv uchun "0.5L"/"1L"/"5L") — ixtiyoriy, erkin matn, faqat Ombor sahifasida ko'rinadi
  category_id INTEGER REFERENCES inventory_categories(id), -- ixtiyoriy turkum (2026-09-26) — Ombor sahifasida ustunlarga ajratish uchun
  image_url TEXT, -- ixtiyoriy rasm (2026-09-26, admin/inventory.js POST /upload-image orqali yuklanadi)
  is_active INTEGER NOT NULL DEFAULT 1, -- soft-delete (harakatlar tarixi — inventory_movements — bo'lsa hard-delete qilinmaydi)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- idx_inventory_items_category SHU YERDA EMAS — server/db.js'dagi
-- migrateAddInventoryItemCategoryAndImage() ichida yaratiladi. Sabab
-- idx_notifications_ack'dagi bilan bir xil (yuqoridagi izohga qarang): eski
-- bazada bu CREATE INDEX ALTER'dan oldin ishga tushib "no such column"
-- xatosi bilan serverni yiqitardi (2026-08-26'da amalda topilgan bug, shu
-- saboqqa amal qilindi).

-- Har bir ombor harakati (kirim/chiqim) — tarix va hisobot uchun append-only.
-- delta musbat = kirim (admin qo'lda qo'shdi), manfiy = chiqim (buyurtma orqali
-- sarflandi, admin qo'lda ayirdi/chiqindi, yoki bekor qilingan buyurtma qaytardi
-- — bu holda delta musbat bo'ladi, reason='return').
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('restock', 'adjustment', 'waste', 'stocktake', 'order', 'return')),
  note TEXT,
  order_item_id INTEGER REFERENCES order_items(id), -- 'order'/'return' bo'lsa qaysi afitsiant buyurtma qatoriga tegishli (kuzatuv uchun, ixtiyoriy)
  customer_order_item_id INTEGER REFERENCES customer_order_items(id), -- yoki mijoz (landing) buyurtma qatoriga (ikkalasi bir vaqtda to'lmaydi)
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(inventory_item_id);

-- Kassir "Hisoblash" bo'limi (2026-09-09) — stol/menyuga bog'liq bo'lmagan,
-- kassir qo'lda taom nomi/narxi/miqdorini kiritib bir martalik chek chiqaradigan
-- tezkor hisob-kitob (server/services/manualBills.js). `orders`/`order_items`dan
-- ATAYLAB alohida: ular table_id/menu_item_id'ni FK NOT NULL qiladi, bu yerda
-- ikkalasi ham yo'q — kassir hatto menyuda yo'q narsani ham yozib chiqa oladi.
CREATE TABLE IF NOT EXISTS manual_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  total_amount INTEGER NOT NULL,
  customer_phone TEXT,
  note TEXT,
  delivery_price INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manual_bills_created ON manual_bills(created_at);

CREATE TABLE IF NOT EXISTS manual_bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manual_bill_id INTEGER NOT NULL REFERENCES manual_bills(id),
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  subtotal INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manual_bill_items_bill ON manual_bill_items(manual_bill_id);

-- Kassir smenasi (2026-10-10, "Moliya va kassa" auditi) — faqat kassir (va
-- admin) rolidagi pul-hisob yopishlar uchun: kim qachon ishni boshladi/
-- tugatdi, boshida qancha naqd bo'lgan, yopilganda kutilgan (orders/
-- manual_bills.cash_amount yig'indisi + opening_cash) va haqiqiy (kassir
-- qo'lda sanagan) naqd solishtiriladi. Bitta kassir bir vaqtda faqat bitta
-- ochiq smenaga ega bo'lishi server/services/cashShifts.js'da (db.transaction
-- ichida, "bitta stolda bitta ochiq buyurtma" bilan bir xil naqsh) ta'minlanadi.
CREATE TABLE IF NOT EXISTS cash_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL,
  opening_cash INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  expected_cash INTEGER,
  actual_cash INTEGER,
  variance INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_opened_by ON cash_shifts(opened_by);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_status ON cash_shifts(status);

-- Markazlashgan audit jurnali (2026-10-10, "Audit izi" auditi) — HECH QANDAY
-- o'z ustuniga ega bo'lmagan nozik o'zgarishlar uchun (narx o'zgarishi, xodim
-- roli o'zgarishi, xodim yaratish/o'chirish). Boshqa harakatlar (taom bekor
-- qilish, qo'lda chek, smena yopish) allaqachon o'z jadvalida (order_items.
-- cancelled_by, manual_bills.created_by, cash_shifts) kuzatiladi — bu yerga
-- TAKRORLANMAYDI. Ilova darajasida FAQAT INSERT qilinadi — hech qanday route/
-- funksiya bu jadvalga UPDATE/DELETE yozmaydi (server/services/auditLog.js'ga qarang).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL, -- masalan 'menu_item.price_change', 'user.role_change', 'user.create', 'user.deactivate'
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  old_value TEXT, -- JSON
  new_value TEXT, -- JSON
  performed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(performed_by);

-- Login urinishlari (2026-10-10, "Audit izi" auditi) — muvaffaqiyatli VA
-- muvaffaqiyatsiz, ikkalasi ham. `users.last_login_at`dan farqli — bu TARIX
-- (append-only), har safar yangi qator, ustidan yozilmaydi.
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  success INTEGER NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username, created_at);
