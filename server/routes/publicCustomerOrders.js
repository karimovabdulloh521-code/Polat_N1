// Ochiq (login shart emas) endpoint — landing sahifadagi savat/buyurtma
// oynasidan yuboriladi. Narx HECH QACHON mijoz brauzeridan ishonib olinmaydi —
// har bir band server tomonida menu_items jadvalidan qayta qidiriladi.
const express = require('express');
const { db, nowIso } = require('../db');
const { asyncRoute, createIdempotencyGuard } = require('../routeUtils');
const inventory = require('../services/inventory');
const deliveryZone = require('../services/deliveryZone');

const router = express.Router();
const withIdempotency = createIdempotencyGuard();

const getActiveMenuItem = db.prepare(
  'SELECT * FROM menu_items WHERE id = ? AND is_active = 1'
);

// Intl/Node-locale'ga bog'liq bo'lmagan oddiy "1 234" ko'rinishidagi guruhlash —
// bu faqat bildirishnoma matni uchun, mijozga qaytariladigan javobga ta'sir
// qilmaydi (total_amount xom son sifatida qaytadi, formatlash frontend ishi).
function fmtSomPlain(n) {
  return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";
}

// Telefon — mijoz +998siz 9 ta raqam kiritadi (frontend shunday formatlab
// yuboradi), lekin eski/boshqa klient 998 bilan yoki + bilan yuborsa ham
// qabul qilamiz — bazaga HAR DOIM bitta izchil "+998XXXXXXXXX" ko'rinishida
// yoziladi (manual_bills'dagi sanitizePhone() bilan bir xil g'oya).
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('998') && digits.length === 12) digits = digits.slice(3);
  if (digits.length !== 9) return null;
  return `+998${digits}`;
}

router.post('/', asyncRoute((req, res) => {
  const body = req.body || {};

  // Honeypot — ko'rinmas maydon (frontend: tabindex=-1, ekrandan tashqarida).
  // Haqiqiy odam buni hech qachon to'ldirmaydi, bot skriptlari ko'pincha
  // "barcha input"ni to'ldiradi. To'ldirilgan bo'lsa bazaga yozmasdan, lekin
  // botga buni bildirmasdan (xato chiqarmasdan) "muvaffaqiyatli" ko'rinishdagi
  // javob qaytaramiz — jimgina rad etish.
  if (String(body.website || '').trim() !== '') {
    return res.json({ ok: true, id: 0, total_amount: 0 });
  }

  const name = String(body.full_name || '').trim();
  const fulfillmentType = body.fulfillment === 'delivery' ? 'delivery' : 'pickup';
  const addressText = String(body.address || '').trim();
  const noteText = String(body.note || '').trim();
  const items = body.items;

  const phoneNormalized = normalizePhone(body.phone);

  // Ixtiyoriy GPS lokatsiya (mijoz brauzer Geolocation API orqali ulashgan
  // bo'lsa) — mijozdan kelgan qiymatga ishonib emas, diapazon tekshiruvi bilan.
  // Noto'g'ri/noto'liq bo'lsa jimgina e'tiborsiz qoldiramiz (butun buyurtmani
  // rad etishga arzimaydi, manzil matni asosiy manba).
  const lat = Number(body.location_lat);
  const lng = Number(body.location_lng);
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ error: 'Ismingizni to’liq kiriting (2–60 belgi)', field: 'full_name' });
  }
  if (!phoneNormalized) {
    return res.status(400).json({ error: 'Raqamni to’liq kiriting: 9 ta raqam', field: 'phone' });
  }
  if (fulfillmentType === 'delivery' && (addressText.length < 5 || addressText.length > 200)) {
    return res.status(400).json({ error: 'Yetkazish manzilini to’liq kiriting (5–200 belgi)', field: 'address' });
  }
  if (noteText.length > 300) {
    return res.status(400).json({ error: 'Izoh juda uzun (300 belgigacha)', field: 'note' });
  }

  // Yetkazish masofasi/narxi (2026-10-23) — mijoz yuborgan narxga HECH QACHON
  // ishonilmaydi, serverda haversine formulasi bilan qayta hisoblanadi.
  // Ikkala shart ham bo'lmasa (lokatsiya yo'q YOKI oshxona koordinatasi hali
  // admin tomonidan sozlanmagan) — avvalgidek NULL/"Operator aytadi" rejimi,
  // hech narsa o'zgarmaydi. `total_amount`ga ATAYLAB qo'shilmaydi (hisobot/
  // kassa smenasi daromad hisobini o'zgartirmasin uchun — PROMPT.md 2-bosqich,
  // foydalanuvchi bilan kelishilmaguncha).
  let deliveryDistanceKm = null;
  let deliveryFee = null;
  if (fulfillmentType === 'delivery' && hasLocation) {
    const zoneSettings = deliveryZone.getSettings();
    if (deliveryZone.isOriginConfigured(zoneSettings)) {
      const distanceKm = deliveryZone.haversineKm(zoneSettings.origin_lat, zoneSettings.origin_lng, lat, lng);
      const { fee, overMax } = deliveryZone.computeDeliveryFee(distanceKm, zoneSettings);
      if (overMax) {
        return res.status(400).json({
          error: 'Bu manzil yetkazish hududidan tashqarida. Narxni operator bilan kelishing.',
          field: 'location',
          operator_phone: zoneSettings.operator_phone,
        });
      }
      deliveryDistanceKm = Math.round(distanceKm * 100) / 100;
      deliveryFee = fee;
    }
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Savat bo'sh", field: 'items' });
  }
  if (items.length > 50) return res.status(400).json({ error: "Savatda juda ko'p band bor", field: 'items' });

  // Har bir band uchun narxni serverda (client'ga ishonmasdan) qayta hisoblaymiz.
  const resolved = [];
  const unavailable = [];
  // Ombordagi qoldiqdan ko'p miqdor so'ralishi — har bir ombor mahsuloti
  // bo'yicha savatdagi barcha qatorlar YIG'INDISI nazarda tutiladi (bir xil
  // mahsulotga bog'langan 2 xil taom/variant bo'lsa ham). Oldin bu yerda
  // umuman tekshirilmasdi — faqat is_available (qoldiq>0) ko'rilardi, haqiqiy
  // yetarlilik keyinroq inventory.consume() ichida (tranzaksiya o'rtasida)
  // tekshirilib, yetarli bo'lmasa BUTUN savat (shu taomgina emas) rad
  // etilardi (2026-10-28 audit). Endi shu holat ham "tugagan" ro'yxatiga
  // qo'shiladi — mijoz faqat o'sha taomni yangilaydi, qolgani saqlanadi.
  const requestedByInventoryId = new Map();
  const parentNameCache = new Map();
  const getParentName = (parentId) => {
    if (!parentNameCache.has(parentId)) {
      const parent = db.prepare('SELECT name FROM menu_items WHERE id = ?').get(parentId);
      parentNameCache.set(parentId, parent ? parent.name : null);
    }
    return parentNameCache.get(parentId);
  };

  for (const raw of items) {
    const menuItemId = Number(raw?.menu_item_id);
    const quantity = Number(raw?.quantity);
    if (!Number.isFinite(menuItemId)) return res.status(400).json({ error: "Savat bandi noto'g'ri", field: 'items' });
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity) || quantity > 50) {
      return res.status(400).json({ error: "Miqdorni to'g'ri kiriting (1–50)", field: 'items' });
    }
    const item = getActiveMenuItem.get(menuItemId);
    if (!item) return res.status(400).json({ error: 'Menyudagi bir band endi mavjud emas, sahifani yangilang', field: 'items' });
    if (!item.is_available) {
      unavailable.push({ menu_item_id: item.id, name: item.name });
      continue;
    }
    if (item.inventory_item_id) {
      const alreadyRequested = requestedByInventoryId.get(item.inventory_item_id) || 0;
      const stock = inventory.getItemRow(item.inventory_item_id);
      if (stock.quantity < alreadyRequested + quantity) {
        unavailable.push({ menu_item_id: item.id, name: item.name });
        continue;
      }
      requestedByInventoryId.set(item.inventory_item_id, alreadyRequested + quantity);
    }
    // Variant (tur) bo'lsa chekda/buyurtmada ota taom nomi bilan birga
    // ko'rsatiladi — masalan "Lavash (Tovuq go'shtli)".
    let nameSnapshot = item.name;
    if (item.parent_item_id) {
      const parentName = getParentName(item.parent_item_id);
      if (parentName) nameSnapshot = `${parentName} (${item.name})`;
    }
    resolved.push({ item, quantity, nameSnapshot });
  }

  if (unavailable.length > 0) {
    return res.status(409).json({
      error: `Savatdagi ${unavailable.length} ta taom tugagan, iltimos savatni yangilang`,
      unavailable_items: unavailable,
    });
  }

  const itemsTotal = resolved.reduce((sum, r) => sum + r.item.price * r.quantity, 0);
  // Yetkazish narxi 2026-10-23'dan `total_amount`ga qo'shiladi (foydalanuvchi
  // bilan kelishilgan — `manual_bills.delivery_price` bilan BIR XIL naqsh:
  // hisobot/kassa-smena/"bugungi tushum" endi yetkazish puli bilan birga
  // hisoblanadi, chunki `adminReports.js`dagi revenue so'rovi to'g'ridan-to'g'ri
  // `customer_orders.total_amount`ni yig'adi — qo'shimcha o'zgarish shart emas).
  const totalAmount = itemsTotal + (deliveryFee || 0);
  const ts = nowIso();

  // Takroriy-yuborish himoyasi (2026-10-10): klient bitta checkout urinishi
  // uchun bir marta generatsiya qilgan `idempotency_key`ni yuboradi — tugma
  // ikki marta bosilsa yoki tarmoq qayta so'rov yuborsa, server ikkinchi
  // marta YANGI buyurtma yaratmaydi, birinchi natijani qaytaradi.
  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : null;

  // Oshxona (afitsiant) printeriga YANGI, WebSocket push orqali chop etish
  // uchun chek yorlig'i (2026-10-18) — faqat `kitchen_tickets.table_name`
  // ustuniga (tarix/zaxira sifatida) yoziladi. Haqiqiy chop etishga esa
  // (pastda, `kitchen.printOrder()`) endi bu matn emas, ANIQ, ALOHIDA
  // maydonlar (`type`/`customerName`/`phone`/`address`) uzatiladi — bitta
  // umumiy "table"/"waiter" maydoniga turli ma'noli qiymatni (stol nomi
  // yoki mijoz telefoni) yashirib qo'yish "cheklarni adashtirish" xavfini
  // keltirib chiqargan edi (2026-10-18, foydalanuvchi so'rovi).
  const ticketLabel = fulfillmentType === 'delivery' ? `Yetkazib berish — ${name}` : `Olib ketish — ${name}`;

  const run = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO customer_orders (full_name, phone, fulfillment, address, location_lat, location_lng, note, total_amount, status, created_at, delivery_distance_km, delivery_fee)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
      )
      .run(name, phoneNormalized, fulfillmentType, addressText || null, hasLocation ? lat : null, hasLocation ? lng : null, noteText || null, totalAmount, ts, deliveryDistanceKm, deliveryFee);

    const insertItem = db.prepare(
      `INSERT INTO customer_order_items (customer_order_id, menu_item_id, name_snapshot, unit_price, quantity, subtotal)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const r of resolved) {
      const itemInfo = insertItem.run(info.lastInsertRowid, r.item.id, r.nameSnapshot, r.item.price, r.quantity, r.item.price * r.quantity);
      // Ichimlik (yoki boshqa) taom omborga bog'langan bo'lsa — shu miqdorni
      // ombordan ayiramiz. Yetarli qoldiq bo'lmasa inventory.consume() xato
      // otadi, butun buyurtma (customer_orders yozuvi bilan birga) bekor bo'ladi.
      if (r.item.inventory_item_id) {
        inventory.consume(r.item.inventory_item_id, r.quantity, {
          customerOrderItemId: itemInfo.lastInsertRowid,
          productName: r.nameSnapshot,
        });
      }
    }
    // Yetkazib berish buyurtmasi kelganda admin+oshpaz+dastavkachi ekranlariga
    // baravar ko'rinadigan bildirishnoma (server/routes/deliveryAlerts.js
    // o'qiydi) — olib ketish (pickup) uchun yozilmaydi, faqat delivery.
    if (fulfillmentType === 'delivery') {
      db.prepare(
        `INSERT INTO notifications (message, is_read, customer_order_id, created_at)
         VALUES (?, 0, ?, ?)`
      ).run(`🚚 Yangi yetkazib berish buyurtmasi: ${name} — ${fmtSomPlain(totalAmount)}`, info.lastInsertRowid, ts);
    }

    // Chop etilmagan cheklar navbati (2026-10-18) — afitsiant "Oshxonaga
    // yuborish" bosganidagi bilan AYNAN BIR XIL kitchen_tickets/
    // kitchen_ticket_items jadvali (server/services/orders.js,
    // sendPendingItems()). Bu yozuv o'zi hech narsani chop ETMAYDI — faqat
    // tarix/zaxira sifatida saqlanadi (masalan WebSocket agent vaqtincha
    // oflayn bo'lsa). Haqiqiy chop etish pastda, WS push orqali.
    const ticketInfo = db
      .prepare('INSERT INTO kitchen_tickets (customer_order_id, table_name, created_at) VALUES (?, ?, ?)')
      .run(info.lastInsertRowid, ticketLabel, ts);
    const insertTicketItem = db.prepare(
      'INSERT INTO kitchen_ticket_items (kitchen_ticket_id, name_snapshot, quantity, note) VALUES (?, ?, ?, ?)'
    );
    resolved.forEach((r) => insertTicketItem.run(ticketInfo.lastInsertRowid, r.nameSnapshot, r.quantity, ''));

    return info.lastInsertRowid;
  });

  const result = withIdempotency(idempotencyKey, () => {
    const newId = run();
    // Afitsiant uchun ishlatiladigan OSHXONA printeriga avtomatik, DARHOL chop
    // etish (2026-10-18 (3)) — avval bu yerda faqat kitchen_tickets jadvaliga
    // yozilardi, lekin 2026-10-15'dan beri oshxona cheki endi WebSocket PUSH
    // orqali ishlaydi (server/printer.js, `waiterOrders.js`dagi bilan BIR XIL
    // mexanizm) — bu push HECH QACHON chaqirilmagani uchun mijoz (landing)
    // buyurtmalari haqiqiy oshxona printeriga umuman chiqmay turgan edi
    // (faqat ma'lumot bazasida/`/api/chef/kitchen-tickets/pending`da ko'rinib,
    // oshpaz kompyuteridagi push-agent buni hech qachon olmasdi). Printer
    // xatosi (agent oflayn va h.k.) buyurtmaning o'zi saqlanishiga ta'sir
    // qilmasin uchun try/catch ichida.
    try {
      const kitchen = req.app.locals.kitchen;
      if (kitchen) {
        kitchen.printOrder({
          id: newId,
          type: fulfillmentType, // 'pickup' | 'delivery' — print-agent.js shu bo'yicha aniq shablon tanlaydi
          customerName: name,
          phone: phoneNormalized,
          address: fulfillmentType === 'delivery' ? addressText : undefined,
          items: resolved.map((r) => ({ name: r.nameSnapshot, qty: r.quantity })),
          note: noteText || undefined,
          createdAt: Date.now(),
          deliveryDistanceKm: deliveryDistanceKm === null ? undefined : deliveryDistanceKm,
          deliveryFee: deliveryFee === null ? undefined : deliveryFee,
        });
      }
    } catch (err) {
      console.error('Oshxona printer agentiga (WebSocket) yuborishda xato:', err);
    }
    return { id: newId, total_amount: totalAmount, delivery_distance_km: deliveryDistanceKm, delivery_fee: deliveryFee };
  });
  res.json({ ok: true, ...result });
}));

module.exports = router;
