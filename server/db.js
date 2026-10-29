const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { ROLE_NAMES } = require('./roles');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'polat.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function ensureSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
}

// Oddiy "ustun bormi? bo'lmasa ALTER TABLE bilan qo'sh" naqshi — ilgari har bir
// migrateAdd*() funksiyasi shu 5 qatorni (tekshir/log/ALTER/log) mustaqil qo'lda
// takrorlagan edi (2026-09-09'da birlashtirildi, pastdagi migratsiyalarning
// ko'pchiligi endi shu yordamchidan foydalanadi — bir nechta ustun qo'shadigan
// yoki indeks yaratadigan murakkabroqlari hamon o'zining to'liq funksiyasida
// qoladi).
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return;
  console.log(`Migratsiya: '${table}' jadvaliga '${column}' ustuni qo'shilmoqda...`);
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`Migratsiya tugadi: '${column}' qo'shildi.`);
}

// SQLite'da mavjud ustunning CHECK constraint'ini to'g'ridan-to'g'ri ALTER
// qilib bo'lmaydi — shu sabab 'users.role' CHECK'iga yangi rol qo'shilishi
// kerak bo'lganda ('chef' 2026-08-26'da, 'courier' 2026-09-08'da qo'shilgan
// edi — ikkalasi ilgari alohida, deyarli bir xil funksiya edi, 2026-09-09'da
// birlashtirildi) jadval SQLite'ning rasmiy tavsiya qilingan usulida qayta
// qurib ko'chiriladi: yangi jadval yarat -> ma'lumotni ko'chir -> eskisini
// o'chir -> nomini almashtir. `users`ga FK bilan bog'langan boshqa jadvallar
// (orders/order_items/expenses) buzilmaydi, chunki oxirida jadval yana xuddi
// shu "users" nomi bilan qayta paydo bo'ladi.
//
// CHECK ro'yxati endi server/roles.js'dagi YAGONA ROLES manbasidan olinadi —
// kelajakda yangi rol qo'shilganda faqat roles.js'ga qo'shish kifoya, bu
// funksiya avtomatik ravishda yetishmayotgan rol(lar)ni aniqlab jadvalni
// qayta quradi. Idempotent: CHECK'da barcha rollar allaqachon bo'lsa hech
// narsa qilmaydi.
function migrateSyncUserRoles() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!row) return;
  const missing = ROLE_NAMES.filter((r) => !row.sql.includes(`'${r}'`));
  if (missing.length === 0) return;

  console.log(`Migratsiya: 'users' jadvaliga rol(lar) qo'shilmoqda: ${missing.join(', ')}...`);
  db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      const roleList = ROLE_NAMES.map((r) => `'${r}'`).join(', ');
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN (${roleList})),
          full_name TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO users_new (id, username, password_hash, password_salt, role, full_name, is_active, created_at)
        SELECT id, username, password_hash, password_salt, role, full_name, is_active, created_at FROM users;
      `);
      db.exec('DROP TABLE users;');
      db.exec('ALTER TABLE users_new RENAME TO users;');
    });
    run();
    const check = db.pragma('foreign_key_check');
    if (check.length > 0) {
      throw new Error('foreign_key_check muvaffaqiyatsiz: ' + JSON.stringify(check));
    }
    console.log(`Migratsiya tugadi: rol(lar) qo'shildi (${missing.join(', ')}).`);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// 'order_items'ga 'ready_at' ustuni (oshpaz "tayyor" belgisi) qo'shish — CHECK
// constraint emas, oddiy nullable ustun, shuning uchun rol qo'shishdagi kabi
// jadvalni butunlay qayta qurish shart emas, oddiy ALTER ADD COLUMN yetarli.
function migrateAddOrderItemReadyAt() {
  addColumnIfMissing('order_items', 'ready_at', 'ready_at TEXT');
}

// 'sent_at' — afitsiant "Oshxonaga yuborish" tugmasini bosgach to'ldiriladi (2026-08-26).
// Mavjud (eski) faol order_items qatorlari uchun ustun NULL bo'lib qoladi — bu
// "hali yuborilmagan" deb talqin qilinadi, lekin chef ekrani faqat YANGI
// qo'shiladigan qatorlarga ta'sir qiladi (eski, allaqachon boshlangan
// buyurtmalar uchun amaliyotda muammo emas, chunki bu funksiya joriy ochiq
// buyurtmalar bo'lmagan paytda joylashtirilgan).
function migrateAddOrderItemSentAt() {
  addColumnIfMissing('order_items', 'sent_at', 'sent_at TEXT');
}

// 'acknowledged_at'/'acknowledged_by_name' — afitsiant "Qabul qildim" tugmasini
// bosgach to'ldiriladi (2026-08-26). Idempotent, oddiy ALTER ADD COLUMN (nullable).
// Indeks ATAYLAB shu funksiya ichida (schema.sql'da EMAS) yaratiladi — ustun
// hali qo'shilmagan eski bazada schema.sql'dagi CREATE INDEX ustunga tegib
// "no such column" bilan yiqilib qolar edi (ensureSchema() bu migratsiyadan
// OLDIN ishlaydi). Bu yerda ALTER'dan keyin, har doim (idempotent) chaqiriladi.
function migrateAddNotificationAck() {
  addColumnIfMissing('notifications', 'acknowledged_at', 'acknowledged_at TEXT');
  addColumnIfMissing('notifications', 'acknowledged_by_name', 'acknowledged_by_name TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_ack ON notifications(acknowledged_at)');
}

// 'picked_up_at' — afitsiant "Qabul qildim" tugmasini bosgach to'ldiriladi (2026-08-26),
// shundan keyin taom oshpaz ekranidan yo'qoladi (chefKitchen.js GET /tables filtrlaydi).
// Idempotent, oddiy ALTER ADD COLUMN (nullable).
function migrateAddOrderItemPickedUpAt() {
  addColumnIfMissing('order_items', 'picked_up_at', 'picked_up_at TEXT');
}

// 'order_item_id' — bildirishnoma qaysi taomga tegishli ekanini bog'laydi (2026-08-26),
// "Qabul qildim" bosilganda shu taomni picked_up_at bilan belgilash uchun kerak.
// Idempotent, oddiy ALTER ADD COLUMN (nullable, FK emas — SQLite'da ALTER bilan FK
// qo'shib bo'lmaydi, lekin better-sqlite3/ilova darajasida bog'lanish yetarli).
function migrateAddNotificationOrderItemId() {
  addColumnIfMissing('notifications', 'order_item_id', 'order_item_id INTEGER');
}

// 'customer_order_id' — yangi yetkazib berish (delivery) mijoz buyurtmasi
// kelganda admin+oshpaz+dastavkachiga baravar ko'rsatiladigan bildirishnomani
// bog'lash uchun (2026-09-08, schema.sql'dagi izohga qarang, server/routes/
// deliveryAlerts.js o'qiydi). Idempotent, oddiy ALTER ADD COLUMN (nullable,
// FK emas — boshqa migratsiyalar bilan bir xil naqsh).
function migrateAddNotificationCustomerOrderId() {
  addColumnIfMissing('notifications', 'customer_order_id', 'customer_order_id INTEGER');
}

// 'description' — admin taom haqida qo'shimcha ma'lumot (tarkibi, hajmi va h.k.)
// kiritishi uchun (2026-09-07). Afitsiant menyusida taom ustiga (+ tugmasi emas)
// bosilganda shu matn ko'rsatiladi. Idempotent, oddiy ALTER ADD COLUMN (nullable).
function migrateAddMenuItemDescription() {
  addColumnIfMissing('menu_items', 'description', 'description TEXT');
}

// 'image_url' — admin taomga ixtiyoriy rasm biriktirishi uchun (2026-09-07,
// server/routes/adminMenu.js'dagi POST /upload-image orqali yuklanadi).
// MAJBURIY EMAS — NULL bo'lsa frontend rasmsiz (faqat nom/narx) ko'rsatadi.
// Idempotent, oddiy ALTER ADD COLUMN (nullable).
function migrateAddMenuItemImage() {
  addColumnIfMissing('menu_items', 'image_url', 'image_url TEXT');
}

// 'volume' — nomdan keyin ko'rsatiladigan qisqa o'lcham/hajm belgisi (2026-09-07),
// masalan ichimliklar uchun "0.5L"/"1L". Erkin matn (raqam+birlik cheklanmagan —
// taomlar uchun "300g" kabi ham ishlatilishi mumkin). MAJBURIY EMAS. Idempotent,
// oddiy ALTER ADD COLUMN (nullable).
function migrateAddMenuItemVolume() {
  addColumnIfMissing('menu_items', 'volume', 'volume TEXT');
}

// 'inventory_item_id' — menyu taomini ombor mahsulotiga (2026-09-07, schema.sql'dagi
// yangi 'inventory_items' jadvali) ixtiyoriy bog'lash uchun. NULL = oddiy taom,
// mavjudligi hamon qo'lda (PATCH /availability) boshqariladi. Qiymat bo'lsa,
// server/services/inventory.js shu taomning is_available'ini ombor qoldig'idan
// avtomatik hisoblaydi. Idempotent, oddiy ALTER ADD COLUMN (nullable, FK emas —
// SQLite'da ALTER bilan FK qo'shib bo'lmaydi, ilova darajasida bog'lanish yetarli,
// boshqa migratsiyalar bilan bir xil naqsh).
function migrateAddMenuItemInventoryLink() {
  addColumnIfMissing('menu_items', 'inventory_item_id', 'inventory_item_id INTEGER');
}

// 'delivered_at' — dastavkachi (courier) "🚚 Yetkazildi" bosgan vaqt
// (2026-09-08, schema.sql'dagi izohga qarang). NULL = hali yetkazilmagan.
function migrateAddCustomerOrderDeliveredAt() {
  addColumnIfMissing('customer_orders', 'delivered_at', 'delivered_at TEXT');
}

// 'location_lat'/'location_lng' — mijoz landing sahifasida (yetkazib berish
// buyurtmasida) brauzer Geolocation API orqali ixtiyoriy ravishda ulashgan GPS
// koordinatasi (2026-09-08, public/landing/script.js'dagi "📍 Joylashuvni
// yuborish" tugmasi). Faqat "manzil" matn maydoniga qo'shimcha, aniqroq
// yetkazish uchun — MAJBURIY EMAS, mijoz ruxsat bermasa/qurilma qo'llamasa
// NULL qoladi. Admin panelda mavjud bo'lsa xaritaga havola sifatida ko'rsatiladi
// (public/admin/customer-orders.js).
function migrateAddCustomerOrderLocation() {
  addColumnIfMissing('customer_orders', 'location_lat', 'location_lat REAL');
  addColumnIfMissing('customer_orders', 'location_lng', 'location_lng REAL');
}

// Yetkazish hududi (10/20 km, 2026-10-23) — masofa (km) va serverda
// hisoblangan yetkazish narxi. NULL = mijoz lokatsiya bermagan YOKI oshxona
// koordinatasi hali sozlanmagan (ikkala holatda ham "Operator aytadi"
// rejimi, avvalgi xulq-atvor saqlanadi — server/services/deliveryZone.js).
function migrateAddCustomerOrderDeliveryFields() {
  addColumnIfMissing('customer_orders', 'delivery_distance_km', 'delivery_distance_km REAL');
  addColumnIfMissing('customer_orders', 'delivery_fee', 'delivery_fee INTEGER');
}

// 'parent_item_id' — taom "turi" (variant) funksiyasi uchun (2026-09-09,
// schema.sql'dagi izohga qarang). NULL = oddiy/asosiy taom, qiymat bo'lsa —
// shu taom ko'rsatilgan ota taomning bir turi. Idempotent, oddiy ALTER ADD
// COLUMN (nullable, FK emas — boshqa migratsiyalar bilan bir xil naqsh).
function migrateAddMenuItemParent() {
  addColumnIfMissing('menu_items', 'parent_item_id', 'parent_item_id INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_menu_items_parent ON menu_items(parent_item_id)');
}

// 'customer_phone' — kassir "Hisoblash" (qo'lda chek) ekranida ixtiyoriy
// mijoz raqami (2026-09-26, foydalanuvchi so'rovi bilan, total-bar qatoriga
// qo'shilgan input). NULL = kiritilmagan, hech narsani talab qilmaydi.
function migrateAddManualBillCustomerPhone() {
  addColumnIfMissing('manual_bills', 'customer_phone', 'customer_phone TEXT');
}

// 'note' — kassir "Hisoblash" ekranida mijoz raqami yonidagi ixtiyoriy izoh
// maydoni (2026-09-27, foydalanuvchi so'rovi bilan). NULL = kiritilmagan.
function migrateAddManualBillNote() {
  addColumnIfMissing('manual_bills', 'note', 'note TEXT');
}

// 'delivery_price' — kassir "Hisoblash" ekranida ixtiyoriy yetkazib berish
// narxi (2026-09-27, foydalanuvchi so'rovi bilan; standart 5000 so'm, kassir
// o'zgartira oladi, 0 ham bo'lishi mumkin). Taomlar summasiga qo'shilib
// umumiy "Jami"ni tashkil qiladi. Eski qatorlar uchun standart 0.
function migrateAddManualBillDeliveryPrice() {
  addColumnIfMissing('manual_bills', 'delivery_price', 'delivery_price INTEGER NOT NULL DEFAULT 0');
}

// 'category_id'/'image_url' — Ombor mahsulotlarini turkumga ajratish (Ombor
// sahifasida ustunlar) + ixtiyoriy rasm (2026-09-26, foydalanuvchi so'rovi
// bilan). `inventory_categories` jadvalining o'zi CREATE TABLE IF NOT EXISTS
// bo'lgani uchun (schema.sql) alohida migratsiya shart emas, faqat mavjud
// `inventory_items` jadvaliga yangi ustunlarni ALTER bilan qo'shish kerak.
function migrateAddInventoryItemCategoryAndImage() {
  addColumnIfMissing('inventory_items', 'category_id', 'category_id INTEGER');
  addColumnIfMissing('inventory_items', 'image_url', 'image_url TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category_id)');
}

// 'cancelled_by'/'cancelled_at' — audit tuzatishi (2026-10-10): ilgari taom
// bekor qilinganda (server/services/orders.js, cancelOrderItem()) KIM bekor
// qilgani umuman yozilmasdi — faqat KIM QO'SHGANI (added_by) saqlanardi.
// Moliyaviy hisobdorlik uchun (kim, qachon bekor qilgani keyinchalik
// tekshirilishi mumkin bo'lsin deb) qo'shildi. Nullable — eski (bu
// o'zgarishdan oldin bekor qilingan) qatorlar uchun NULL qoladi, bu normal.
function migrateAddOrderItemCancelAudit() {
  addColumnIfMissing('order_items', 'cancelled_by', 'cancelled_by INTEGER');
  addColumnIfMissing('order_items', 'cancelled_at', 'cancelled_at TEXT');
}

// 'last_login_at'/'last_login_ip' — xavfsizlik auditi (2026-10-10): umumiy
// (bir nechta kishi bitta login/paroldan foydalanishi) texnik jihatdan
// to'liq oldini olib bo'lmaydi, lekin kamida KUZATISH mumkin bo'lsin deb —
// admin "Xodimlar" sahifasida har xodimning oxirgi kirgan vaqti/IP'si
// ko'rinadi, g'ayritabiiy holatlar (masalan bir vaqtda ikki joydan) shu
// orqali payqalishi mumkin. Nullable — hali hech kim kirmagan xodim uchun NULL.
function migrateAddUserLastLogin() {
  addColumnIfMissing('users', 'last_login_at', 'last_login_at TEXT');
  addColumnIfMissing('users', 'last_login_ip', 'last_login_ip TEXT');
}

// 'assigned_courier_id' — xavfsizlik auditi (2026-10-10): ilgari BARCHA
// kuryer BARCHA yetkazib berish buyurtmasini ko'rardi, "biriktirish"
// (assignment) konsepsiyasi yo'q edi (2+ kuryer bir vaqtda ishlasa, ikkisi
// bir buyurtmaga borib qolishi yoki hech kim olmasligi mumkin edi). Nullable
// — admin biriktirmasa (NULL), eski xulq-atvor (hamma kuryer ko'radi) saqlanib
// qoladi, shu sabab BU O'ZGARISH ESKI ISHLASH TARZINI BUZMAYDI. FK emas
// (boshqa migratsiyalar bilan bir xil naqsh, SQLite ALTER bilan FK
// qo'shib bo'lmaydi).
function migrateAddCustomerOrderCourier() {
  addColumnIfMissing('customer_orders', 'assigned_courier_id', 'assigned_courier_id INTEGER');
}

// 'cancel_reason' — xavfsizlik auditi 2 (2026-10-10, "Buyurtma oqimi"): ilgari
// oshxonaga yuborilgan (sent_at bor) taomni bekor qilish/kamaytirish uchun
// hech qanday sabab talab qilinmasdi. Endi server/services/orders.js
// shu holatda `reason` majburiy qiladi va shu ustunga yozadi.
// 'inventory_movements.reason' CHECK'iga 'waste'/'stocktake' qo'shish — Ombor
// auditi (2026-10-10): ilgari har qanday manfiy qo'lda tuzatish (isrof ham,
// inventarizatsiya farqi ham) bitta umumiy 'adjustment' kodiga tushardi.
// 'users.role'dagi migrateSyncUserRoles() bilan BIR XIL "jadval qayta qurish"
// naqshi (SQLite'da CHECK'ni to'g'ridan-to'g'ri ALTER qilib bo'lmaydi).
const INVENTORY_MOVEMENT_REASONS = ['restock', 'adjustment', 'waste', 'stocktake', 'order', 'return'];
function migrateAddInventoryMovementReasons() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inventory_movements'").get();
  if (!row) return;
  const missing = INVENTORY_MOVEMENT_REASONS.filter((r) => !row.sql.includes(`'${r}'`));
  if (missing.length === 0) return;

  console.log(`Migratsiya: 'inventory_movements' jadvaliga sabab(lar) qo'shilmoqda: ${missing.join(', ')}...`);
  db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      const reasonList = INVENTORY_MOVEMENT_REASONS.map((r) => `'${r}'`).join(', ');
      db.exec(`
        CREATE TABLE inventory_movements_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
          delta INTEGER NOT NULL,
          reason TEXT NOT NULL CHECK (reason IN (${reasonList})),
          note TEXT,
          order_item_id INTEGER REFERENCES order_items(id),
          customer_order_item_id INTEGER REFERENCES customer_order_items(id),
          created_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO inventory_movements_new (id, inventory_item_id, delta, reason, note, order_item_id, customer_order_item_id, created_by, created_at)
        SELECT id, inventory_item_id, delta, reason, note, order_item_id, customer_order_item_id, created_by, created_at FROM inventory_movements;
      `);
      db.exec('DROP TABLE inventory_movements;');
      db.exec('ALTER TABLE inventory_movements_new RENAME TO inventory_movements;');
      db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(inventory_item_id);');
    });
    run();
    const check = db.pragma('foreign_key_check');
    if (check.length > 0) {
      throw new Error('foreign_key_check muvaffaqiyatsiz: ' + JSON.stringify(check));
    }
    console.log(`Migratsiya tugadi: sabab(lar) qo'shildi (${missing.join(', ')}).`);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function migrateAddOrderItemCancelReason() {
  addColumnIfMissing('order_items', 'cancel_reason', 'cancel_reason TEXT');
}

// Xuddi shu audit: mijoz buyurtmasi (customer_orders) 'cancelled' qilinganda
// ham sabab saqlanmasdi.
function migrateAddCustomerOrderCancelReason() {
  addColumnIfMissing('customer_orders', 'cancel_reason', 'cancel_reason TEXT');
}

// 'reason' — "Moliya va kassa" auditi (2026-10-10): kassirning qo'lda chek
// (manual_bills) yaratishida "nima uchun qo'lda yozildi" (masalan "mijoz
// noyob taom so'radi, menyuda yo'q") uchun alohida, ixtiyoriy maydon —
// mavjud `note` (mijoz uchun erkin izoh) bilan ARALASHMASIN deb.
function migrateAddManualBillReason() {
  addColumnIfMissing('manual_bills', 'reason', 'reason TEXT');
}

// To'lov turi (naqd/karta/aralash) — kassa smenasi auditi (2026-10-10).
// Nullable — faqat KASSIR tomonidan bajarilgan stol-yopish/qo'lda-chekda
// to'ldiriladi (`kassirTables.js`/`kassirBilling.js`), afitsiant stol
// yopganda (`waiterOrders.js`) bu ustunlar NULL qolaveradi — eski
// xulq-atvor o'zgarishsiz saqlanadi.
function migrateAddPaymentColumns(table) {
  addColumnIfMissing(table, 'payment_method', 'payment_method TEXT');
  addColumnIfMissing(table, 'cash_amount', 'cash_amount INTEGER');
  addColumnIfMissing(table, 'card_amount', 'card_amount INTEGER');
  addColumnIfMissing(table, 'cash_shift_id', 'cash_shift_id INTEGER');
}

// Stollarni "Zal"/"Tashqari" kabi joylarga guruhlash (2026-10-10). table_zones
// jadvalining o'zi yangi (CREATE TABLE IF NOT EXISTS orqali ensureSchema()da
// avtomatik yaratiladi) — faqat tables.zone_id ustuni mavjud eski bazaga ALTER
// bilan qo'shiladi.
function migrateAddTableZone() {
  addColumnIfMissing('tables', 'zone_id', 'zone_id INTEGER');
}

// Afitsiant "Stollar" ekrani qayta dizayni (2026-10-15) — mijoz og'zaki
// "hisob olib kelinglar" deganda afitsiant shu belgini qo'yadi, stol
// kartochkasi "BAND" o'rniga "HISOB" holatini ko'rsatadi. Nullable emas —
// har doim 0/1, standart 0 (hali so'ralmagan).
function migrateAddOrderBillRequested() {
  addColumnIfMissing('orders', 'bill_requested', "bill_requested INTEGER NOT NULL DEFAULT 0");
}

// 'note' — afitsiant oshpazga yozadigan ixtiyoriy izoh (2026-10-15, "Buyurtma"
// sahifasi qayta dizayni). Faqat hali yuborilmagan (sent_at IS NULL) qatorda
// tahrirlanadi. kitchen_ticket_items.note — shu izohning "Oshxonaga yuborish"
// paytidagi nusxasi, oshpaz kitchen ekranida ko'rinishi uchun.
function migrateAddOrderItemNote() {
  addColumnIfMissing('order_items', 'note', "note TEXT NOT NULL DEFAULT ''");
}
function migrateAddKitchenTicketItemNote() {
  addColumnIfMissing('kitchen_ticket_items', 'note', "note TEXT NOT NULL DEFAULT ''");
}

// 'kitchen_tickets.order_id' ilgari NOT NULL edi (faqat dine-in stol
// buyurtmasiga tegishli bo'lgani uchun) — endi mijoz landing saytidan
// (olib ketish/yetkazib berish) buyurtma berganda ham xuddi shu navbatga
// yoziladi (2026-10-18), shu sabab order_id IXTIYORIY bo'lishi va yangi
// 'customer_order_id' ustuni qo'shilishi kerak. SQLite'da NOT NULL'ni
// to'g'ridan-to'g'ri ALTER qilib bo'lmagani uchun (users.role CHECK
// o'zgarishi bilan BIR XIL "jadval qayta qurish" naqshi) jadval qayta
// quriladi. Idempotent: ustun allaqachon ixtiyoriy bo'lsa hech narsa qilmaydi.
function migrateKitchenTicketsCustomerOrderId() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'kitchen_tickets'").get();
  if (!row) return;
  if (row.sql.includes('customer_order_id')) return;

  console.log("Migratsiya: 'kitchen_tickets' jadvali qayta qurilmoqda (customer_order_id qo'shilmoqda)...");
  db.pragma('foreign_keys = OFF');
  try {
    const run = db.transaction(() => {
      db.exec(`
        CREATE TABLE kitchen_tickets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER REFERENCES orders(id),
          customer_order_id INTEGER REFERENCES customer_orders(id),
          table_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          printed_at TEXT
        );
      `);
      db.exec(`
        INSERT INTO kitchen_tickets_new (id, order_id, table_name, created_at, printed_at)
        SELECT id, order_id, table_name, created_at, printed_at FROM kitchen_tickets;
      `);
      db.exec('DROP TABLE kitchen_tickets;');
      db.exec('ALTER TABLE kitchen_tickets_new RENAME TO kitchen_tickets;');
      db.exec('CREATE INDEX IF NOT EXISTS idx_kitchen_tickets_pending ON kitchen_tickets(printed_at);');
    });
    run();
    const check = db.pragma('foreign_key_check');
    if (check.length > 0) {
      throw new Error('foreign_key_check muvaffaqiyatsiz: ' + JSON.stringify(check));
    }
    console.log("Migratsiya tugadi: 'kitchen_tickets'ga customer_order_id qo'shildi.");
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// ESKATMA (2026-09-09): bu yerda ilgari 4 ta qo'shimcha migratsiya funksiyasi
// bor edi — migrateAddInventoryPricing/migrateAddInventoryVolume/
// migrateAddCategoryInventoryRequirement/migrateAddMenuItemCostPrice.
// Ularning barchasi endi HAQIQIY O'LIK KOD edi: schema.sql'dagi tegishli
// CREATE TABLE'lar (inventory_items.cost_price/sale_price/volume,
// menu_categories.require_inventory_link, menu_items.cost_price) allaqachon
// shu ustunlarni to'g'ridan-to'g'ri o'z ichiga oladi (production bazasida ham
// bu ustunlar ALLAQACHON mavjud — funksiyalar birinchi marta joriy qilingan
// paytda bir martalik ALTER TABLE sifatida ishlab, natija saqlanib qolgan),
// shuning uchun ular haqiqatda hech qachon "ustun yo'q" holatiga tushmasdi —
// server har safar ko'tarilganda foydasiz PRAGMA/ALTER tekshiruvidan boshqa
// hech narsa qilmasdi. Xavfsiz o'chirildi.
//
// Har doim serverni ko'tarishda sxema mavjudligini tekshiramiz (CREATE TABLE IF NOT EXISTS
// bo'lgani uchun xavfsiz, ma'lumotni o'chirmaydi) — alohida `npm run migrate` ham mavjud.
ensureSchema();
migrateSyncUserRoles();
migrateAddOrderItemReadyAt();
migrateAddOrderItemSentAt();
migrateAddNotificationAck();
migrateAddOrderItemPickedUpAt();
migrateAddNotificationOrderItemId();
migrateAddMenuItemDescription();
migrateAddMenuItemImage();
migrateAddMenuItemVolume();
migrateAddMenuItemInventoryLink();
migrateAddMenuItemParent();
migrateAddCustomerOrderLocation();
migrateAddCustomerOrderDeliveredAt();
migrateAddNotificationCustomerOrderId();
migrateAddManualBillCustomerPhone();
migrateAddManualBillNote();
migrateAddManualBillDeliveryPrice();
migrateAddInventoryItemCategoryAndImage();
migrateAddOrderItemCancelAudit();
migrateAddUserLastLogin();
migrateAddCustomerOrderCourier();
migrateAddInventoryMovementReasons();
migrateAddOrderItemCancelReason();
migrateAddCustomerOrderCancelReason();
migrateAddManualBillReason();
migrateAddPaymentColumns('orders');
migrateAddPaymentColumns('manual_bills');
migrateAddTableZone();
migrateAddOrderBillRequested();
migrateAddOrderItemNote();
migrateAddKitchenTicketItemNote();
migrateKitchenTicketsCustomerOrderId();
migrateAddCustomerOrderDeliveryFields();

function nowIso() {
  return new Date().toISOString();
}

// Toshkent — doim UTC+5, yoz/qish vaqti yo'q (O'zbekiston). Barcha vaqt
// ustunlari (`nowIso()`) UTC'da saqlanadi — kunlik hisobot/filtr uchun
// "qaysi kun"ni SQLite'ning o'zida shu siljish bilan hisoblash kerak,
// aks holda mahalliy soat 00:00-04:59 oralig'idagi yozuvlar UTC bo'yicha
// "kechagi kun"ga tushib qolib, hisobotni buzadi (2026-10-10 "Moliya va
// kassa" auditida topilgan, 10 joyda takrorlangan xato). Barcha
// `date(ustun)` filtrlarida shu konstantani ishlatish kerak:
// `date(ustun, TASHKENT_SQL_OFFSET)`.
const TASHKENT_SQL_OFFSET = '+5 hours';

module.exports = { db, ensureSchema, nowIso, DB_PATH, TASHKENT_SQL_OFFSET };
