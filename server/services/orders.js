// Stolga buyurtma qo'shish / stolni yopish (hisob-kitob) ning tranzaksion mantig'i.
// Bitta stolda bir vaqtning o'zida faqat bitta 'open' buyurtma bo'ladi (schema.sql'dagi
// qisman unikal indeks bilan DB darajasida ham kafolatlangan) — mehmon ovqat davomida
// qo'shimcha buyursa (hatto boshqa afitsiant xizmat qilsa ham) xuddi shu ochiq
// buyurtmaga yangi qator qo'shiladi. Har bir amal (qo'shish/yopish) bitta atomik
// tranzaksiyada bajariladi.
const { db, nowIso } = require('../db');
const inventory = require('./inventory');
const cashShifts = require('./cashShifts');

class OrderError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const userNameExpr = "COALESCE(u.full_name, u.username)";

function getTable(tableId) {
  const table = db.prepare('SELECT * FROM tables WHERE id = ? AND is_active = 1').get(tableId);
  if (!table) throw new OrderError('Stol topilmadi', 404);
  return table;
}

function getMenuItem(menuItemId) {
  const item = db.prepare('SELECT * FROM menu_items WHERE id = ? AND is_active = 1').get(menuItemId);
  if (!item) throw new OrderError('Taom topilmadi', 404);
  if (!item.is_available) throw new OrderError(`"${item.name}" hozircha mavjud emas (tugagan)`, 400);
  return item;
}

function findOpenOrderRow(tableId) {
  return db.prepare("SELECT * FROM orders WHERE table_id = ? AND status = 'open'").get(tableId);
}

// order + faol (yoki barcha, includeCancelled=true bo'lsa) qatorlar + jami summa.
function buildOrderView(orderId, { includeCancelled = false } = {}) {
  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name,
              COALESCE(ou.full_name, ou.username) AS opened_by_name,
              cu.id AS closed_by_id, COALESCE(cu.full_name, cu.username) AS closed_by_name
       FROM orders o
       JOIN tables t ON t.id = o.table_id
       JOIN users ou ON ou.id = o.opened_by
       LEFT JOIN users cu ON cu.id = o.closed_by
       WHERE o.id = ?`
    )
    .get(orderId);
  if (!order) throw new OrderError('Buyurtma topilmadi', 404);

  const itemsSql = `
    SELECT oi.*, ${userNameExpr} AS added_by_name
    FROM order_items oi
    JOIN users u ON u.id = oi.added_by
    WHERE oi.order_id = ? ${includeCancelled ? '' : "AND oi.status = 'active'"}
    ORDER BY oi.id ASC
  `;
  const items = db.prepare(itemsSql).all(orderId);
  const total = items.reduce((sum, it) => sum + (it.status === 'active' ? it.subtotal : 0), 0);

  return { order, items, total };
}

function getOpenOrderForTable(tableId) {
  getTable(tableId);
  const row = findOpenOrderRow(tableId);
  if (!row) return null;
  return buildOrderView(row.id);
}

function addItemToTable(tableId, menuItemId, quantity, waiterId, note) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
    throw new OrderError("Miqdor noto'g'ri");
  }
  const noteTrimmed = note !== undefined && note !== null ? String(note).trim().slice(0, 200) : '';

  const run = db.transaction(() => {
    const table = getTable(tableId);
    const item = getMenuItem(menuItemId);
    const ts = nowIso();

    let order = findOpenOrderRow(table.id);
    if (!order) {
      const info = db
        .prepare(
          `INSERT INTO orders (table_id, status, opened_by, opened_at) VALUES (?, 'open', ?, ?)`
        )
        .run(table.id, waiterId, ts);
      order = { id: info.lastInsertRowid };
    }

    // Bir xil taom + bir xil izohli, hali yuborilmagan qator bo'lsa — yangi
    // qator ochmaymiz, miqdorini oshiramiz (2026-10-15, "Buyurtma" sahifasi
    // qayta dizayni: afitsiant xuddi shu taomni ikki marta "+" bossa, ro'yxat
    // ikki qatorga bo'linmasin).
    const existingRow = db
      .prepare(
        `SELECT * FROM order_items WHERE order_id = ? AND menu_item_id = ? AND status = 'active' AND sent_at IS NULL AND note = ? LIMIT 1`
      )
      .get(order.id, item.id, noteTrimmed);

    let orderItemId;
    if (existingRow) {
      const nextQty = existingRow.quantity + qty;
      const nextSubtotal = item.price * nextQty;
      // `unit_price` ham joriy narxga yangilanadi — aks holda keyinroq +/-
      // stepper (updateOrderItem) stale unit_price'ni subtotalga qayta
      // ko'paytirib, buyurtmani eski (noto'g'ri) narxda qayta hisoblardi.
      db.prepare('UPDATE order_items SET quantity = ?, unit_price = ?, subtotal = ? WHERE id = ?').run(nextQty, item.price, nextSubtotal, existingRow.id);
      orderItemId = existingRow.id;
    } else {
      const subtotal = item.price * qty;
      const info = db.prepare(
        `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, unit_price, quantity, subtotal, added_by, status, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      ).run(order.id, item.id, item.name, item.price, qty, subtotal, waiterId, noteTrimmed, ts);
      orderItemId = info.lastInsertRowid;
    }

    // Taom omborga (masalan suv/salfetka) bog'langan bo'lsa — shu miqdorni
    // ombordan ayiramiz. Yetarli qoldiq bo'lmasa inventory.consume() xato otadi,
    // shu tranzaksiya (order_item qo'shilishi bilan birga) butunlay bekor bo'ladi.
    if (item.inventory_item_id) {
      inventory.consume(item.inventory_item_id, qty, { orderItemId, userId: waiterId, productName: item.name });
    }

    return order.id;
  });

  const orderId = run();
  return buildOrderView(orderId);
}

// `fields` — { quantity?, note? }, ikkisi ham ixtiyoriy (biri yoki ikkisi
// birga berilishi mumkin). `note` faqat hali oshxonaga yuborilmagan
// (sent_at IS NULL) qatorda o'zgartirilishi mumkin — yuborilgandan keyin
// izoh "muzlab" qoladi (2026-10-15, "Buyurtma" sahifasi qayta dizayni).
function updateOrderItem(orderItemId, fields, userId, reason) {
  const { quantity, note } = fields || {};
  const hasQuantity = quantity !== undefined && quantity !== null;
  const hasNote = note !== undefined;

  const run = db.transaction(() => {
    const orderItem = db.prepare('SELECT * FROM order_items WHERE id = ?').get(orderItemId);
    if (!orderItem) throw new OrderError('Buyurtma qatori topilmadi', 404);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderItem.order_id);
    if (!order || order.status !== 'open') {
      throw new OrderError('Bu buyurtma allaqachon yopilgan, o\'zgartirib bo\'lmaydi');
    }

    let nextQty = orderItem.quantity;
    let nextSubtotal = orderItem.subtotal;
    let nextCancelReason = orderItem.cancel_reason;

    if (hasQuantity) {
      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty) || qty > 99) {
        throw new OrderError("Miqdor noto'g'ri");
      }
      // Oshxonaga yuborilgan taomning miqdori KAMAYTIRILSA — sabab majburiy
      // (2026-10-10, "Buyurtma oqimi" auditi: ilgari hech qanday izsiz
      // kamaytirish mumkin edi, bu moliyaviy/operatsion nazoratni yo'qotardi).
      // Miqdor OSHIRILSA (yangi qo'shimcha) — sabab shart emas.
      if (qty < orderItem.quantity && orderItem.sent_at && !String(reason || '').trim()) {
        throw new OrderError("Bu taom oshxonaga yuborilgan — miqdorni kamaytirish sababini kiriting");
      }

      // Miqdor o'zgarsa (masalan afitsiant + / − tugmasi bilan) va taom omborga
      // bog'langan bo'lsa — faqat FARQNI (delta) ombordan ayiramiz/qaytaramiz,
      // butun miqdorni emas (aks holda qoldiq noto'g'ri hisoblanardi).
      const delta = qty - orderItem.quantity;
      if (delta !== 0) {
        const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(orderItem.menu_item_id);
        if (menuItem && menuItem.inventory_item_id) {
          if (delta > 0) {
            inventory.consume(menuItem.inventory_item_id, delta, { orderItemId, userId, productName: menuItem.name });
          } else {
            inventory.release(menuItem.inventory_item_id, -delta, { orderItemId, userId });
          }
        }
      }
      nextQty = qty;
      nextSubtotal = orderItem.unit_price * qty;
      if (reason && String(reason).trim()) nextCancelReason = String(reason).trim();
    }

    let nextNote = orderItem.note;
    if (hasNote) {
      if (orderItem.sent_at) {
        throw new OrderError("Bu taom oshxonaga yuborilgan — izohni endi o'zgartirib bo'lmaydi", 409);
      }
      const trimmed = String(note).trim();
      if (trimmed.length > 200) throw new OrderError('Izoh 200 belgidan oshmasligi kerak');
      nextNote = trimmed;
    }

    db.prepare('UPDATE order_items SET quantity = ?, subtotal = ?, note = ?, cancel_reason = ? WHERE id = ?')
      .run(nextQty, nextSubtotal, nextNote, nextCancelReason, orderItemId);
    return order.id;
  });

  const orderId = run();
  return buildOrderView(orderId);
}

// Afitsiant tayyor (ready_at bor, picked_up_at yo'q) taomni "Oldim" tugmasi
// bilan to'g'ridan-to'g'ri belgilaydi — bildirishnoma/"Qabul qildim" oqimidan
// (server/routes/waiterNotifications.js) MUSTAQIL, chunki u bildirishnoma
// yozuviga bog'liq va faqat shu bildirishnoma hali mavjud bo'lsa ishlaydi.
// Idempotent — allaqachon olingan taom uchun qayta chaqirilsa xato bermaydi.
function markItemPickedUp(orderItemId) {
  const run = db.transaction(() => {
    const orderItem = db.prepare('SELECT * FROM order_items WHERE id = ?').get(orderItemId);
    if (!orderItem) throw new OrderError('Buyurtma qatori topilmadi', 404);
    if (orderItem.status !== 'active') throw new OrderError('Bekor qilingan taom');
    if (!orderItem.ready_at) throw new OrderError('Bu taom hali tayyor emas');
    if (!orderItem.picked_up_at) {
      db.prepare('UPDATE order_items SET picked_up_at = ? WHERE id = ?').run(nowIso(), orderItemId);
    }
    return orderItem.order_id;
  });

  const orderId = run();
  return buildOrderView(orderId);
}

// Afitsiant "🍽️ Oshxonaga yuborish" tugmasini bosganda — shu stolning ochiq
// buyurtmasidagi HALI YUBORILMAGAN (sent_at IS NULL) faol qatorlarning hammasini
// bitta paytda "yuborilgan" deb belgilaydi (sent_at = hozir). Faqat shundan keyin
// bu qatorlar oshpazning kitchen ekranida ko'rinadi (server/routes/chefKitchen.js
// filtrlaydi). Taom qo'shilganda (addItemToTable) sent_at ataylab bo'sh qoldiriladi —
// afitsiant avval bir nechta taom yig'ib, keyin hammasini birdan yuboradi.
function sendPendingItems(tableId) {
  const run = db.transaction(() => {
    const table = getTable(tableId);
    const orderRow = findOpenOrderRow(table.id);
    if (!orderRow) throw new OrderError('Bu stolda ochiq buyurtma yo\'q', 404);

    const pending = db
      .prepare("SELECT id, name_snapshot, quantity, note FROM order_items WHERE order_id = ? AND status = 'active' AND sent_at IS NULL")
      .all(orderRow.id);
    if (pending.length === 0) {
      throw new OrderError("Yuborilmagan taom yo'q");
    }
    const ts = nowIso();
    const markSent = db.prepare('UPDATE order_items SET sent_at = ? WHERE id = ?');
    pending.forEach((p) => markSent.run(ts, p.id));

    // Oshxona printeriga AVTOMATIK chop etiladigan chek navbati (2026-09-20) —
    // oshpaz kompyuteridagi kitchen.html sahifasi buni poll qilib, hech qanday
    // tugma bosilmasdan QZ Tray orqali chop etadi (public/app.js,
    // initChefKitchenTicketPrinting()).
    const ticketInfo = db
      .prepare('INSERT INTO kitchen_tickets (order_id, table_name, created_at) VALUES (?, ?, ?)')
      .run(orderRow.id, table.name, ts);
    const insertTicketItem = db.prepare(
      'INSERT INTO kitchen_ticket_items (kitchen_ticket_id, name_snapshot, quantity, note) VALUES (?, ?, ?, ?)'
    );
    pending.forEach((p) => insertTicketItem.run(ticketInfo.lastInsertRowid, p.name_snapshot, p.quantity, p.note || ''));

    return orderRow.id;
  });

  const orderId = run();
  return buildOrderView(orderId);
}

function cancelOrderItem(orderItemId, userId, reason) {
  const run = db.transaction(() => {
    const orderItem = db.prepare('SELECT * FROM order_items WHERE id = ?').get(orderItemId);
    if (!orderItem) throw new OrderError('Buyurtma qatori topilmadi', 404);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderItem.order_id);
    if (!order || order.status !== 'open') {
      throw new OrderError('Bu buyurtma allaqachon yopilgan, o\'zgartirib bo\'lmaydi');
    }
    // Allaqachon bekor qilingan qatorni qayta bekor qilish — idempotent,
    // HECH NARSA yozilmaydi ("Audit izi" auditi, 2026-10-10: ilgari bu yerda
    // shartsiz UPDATE bo'lgani uchun qayta chaqirilsa ASL cancelled_by/
    // cancelled_at/cancel_reason YANGISI bilan USTIDAN YOZILIB ketardi —
    // audit yozuvi "faqat bir marta yoziladi, keyin o'zgarmaydi" tamoyiliga
    // zid edi).
    if (orderItem.status === 'cancelled') {
      return order.id;
    }
    // Oshxonaga yuborilgan taomni BEKOR QILISH — sabab majburiy (2026-10-10,
    // "Buyurtma oqimi" auditi).
    if (orderItem.sent_at && !String(reason || '').trim()) {
      throw new OrderError("Bu taom oshxonaga yuborilgan — bekor qilish sababini kiriting");
    }
    // Allaqachon bekor qilingan qatorni qayta bekor qilish ombordan ikki marta
    // qaytarib yubormasin uchun himoya (hozircha frontend buni chaqirmaydi, lekin
    // xavfsizlik uchun).
    if (orderItem.status === 'active' && orderItem.quantity > 0) {
      const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(orderItem.menu_item_id);
      if (menuItem && menuItem.inventory_item_id) {
        inventory.release(menuItem.inventory_item_id, orderItem.quantity, { orderItemId, userId });
      }
    }
    // Kim va qachon bekor qilgani (moliyaviy hisobdorlik uchun, 2026-10-10) —
    // bekor qilish endi kim qo'shganidan (added_by) mustaqil o'z izini qoldiradi.
    db.prepare(
      "UPDATE order_items SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?"
    ).run(userId, nowIso(), reason ? String(reason).trim() : null, orderItemId);
    return order.id;
  });

  const orderId = run();
  return buildOrderView(orderId);
}

// `paymentInfo` — IXTIYORIY, OXIRGI parametr (kassa smenasi auditi,
// 2026-10-10): berilmasa (afitsiant `waiterOrders.js` orqali chaqirganda)
// xulq-atvor 100% eski holicha — to'lov ustunlari NULL qolaveradi. Faqat
// kassir (`kassirTables.js`, oldindan `cashShifts.validatePaymentInfo()`
// bilan tekshirilgan) `{ payment_method, cash_amount, card_amount }`
// uzatganda to'ldiriladi, va agar shu kassirning ochiq smenasi bo'lsa
// (`cashShifts.getCurrentShift`) — shu smenaga ham biriktiriladi.
function closeTable(tableId, waiterId, paymentInfo) {
  const run = db.transaction(() => {
    const table = getTable(tableId);
    const orderRow = findOpenOrderRow(table.id);
    if (!orderRow) throw new OrderError('Bu stolda ochiq buyurtma yo\'q', 404);

    const activeItems = db
      .prepare("SELECT subtotal FROM order_items WHERE order_id = ? AND status = 'active'")
      .all(orderRow.id);
    if (activeItems.length === 0) {
      throw new OrderError("Buyurtmada hech qanday taom yo'q, hisob-kitob qilib bo'lmaydi");
    }
    const total = activeItems.reduce((sum, it) => sum + it.subtotal, 0);
    const ts = nowIso();
    if (paymentInfo) {
      const shift = cashShifts.requireOpenShift(waiterId);
      db.prepare(
        `UPDATE orders SET status = 'closed', closed_by = ?, closed_at = ?, total_amount = ?,
         payment_method = ?, cash_amount = ?, card_amount = ?, cash_shift_id = ? WHERE id = ?`
      ).run(
        waiterId, ts, total,
        paymentInfo.payment_method, paymentInfo.cash_amount, paymentInfo.card_amount, shift.id,
        orderRow.id
      );
    } else {
      db.prepare(
        `UPDATE orders SET status = 'closed', closed_by = ?, closed_at = ?, total_amount = ? WHERE id = ?`
      ).run(waiterId, ts, total, orderRow.id);
    }

    // Chekni afitsiant o'zi chop etmaydi — printer administrator kompyuteriga
    // ulangan, shu sabab "chop etish kutilmoqda" navbatiga qo'shiladi
    // (adminPrintRequests.js orqali admin panelida ko'rinadi).
    db.prepare('INSERT INTO print_requests (order_id, created_at) VALUES (?, ?)').run(orderRow.id, ts);

    return orderRow.id;
  });

  const orderId = run();
  return buildOrderView(orderId, { includeCancelled: true });
}

// Barcha taomi bekor qilingan (faol taom qolmagan) ochiq buyurtmani hisob-kitobsiz
// yopib, stolni bo'shatadi. closeTable() dan ATAYLAB alohida: u kamida bitta faol
// taom talab qiladi (bo'sh chek chiqmasin degan qoida bilan), lekin shu tufayli
// afitsiant xato bilan qo'shgan taomlarni bekor qilib qo'ysa (yoki mijoz umuman
// buyurtma bermay ketsa), stolni yopishning hech qanday yo'li qolmasdi — u
// abadiy "band" bo'lib qolaverardi (idx_orders_one_open_per_table bitta stolda
// faqat bitta ochiq buyurtmaga ruxsat bergani uchun yangi buyurtma ham ochilmasdi).
// Shu funksiya aynan shu tuzoqdan chiqish yo'li: chek/print_requests yozuvi
// yaratilmaydi (hisoblanadigan hech narsa yo'q), total_amount = 0 bilan yopiladi.
function cancelEmptyOrder(tableId, waiterId) {
  const run = db.transaction(() => {
    const table = getTable(tableId);
    const orderRow = findOpenOrderRow(table.id);
    if (!orderRow) throw new OrderError('Bu stolda ochiq buyurtma yo\'q', 404);

    const activeItems = db
      .prepare("SELECT id FROM order_items WHERE order_id = ? AND status = 'active'")
      .all(orderRow.id);
    if (activeItems.length > 0) {
      throw new OrderError(
        "Buyurtmada faol taomlar bor — avval hammasini bekor qiling yoki \"Hisob-kitob\" orqali yoping"
      );
    }

    const ts = nowIso();
    db.prepare(
      `UPDATE orders SET status = 'closed', closed_by = ?, closed_at = ?, total_amount = 0,
       note = 'Bekor qilindi (barcha taomlar bekor qilingan edi)' WHERE id = ?`
    ).run(waiterId, ts, orderRow.id);

    return orderRow.id;
  });

  const orderId = run();
  return buildOrderView(orderId, { includeCancelled: true });
}

function getReceipt(orderId) {
  return buildOrderView(orderId, { includeCancelled: true });
}

// Afitsiant "stollar" ekrani uchun: har bir faol stol + band/bo'sh holati + joriy summa.
// zone_name (2026-10-19) — kassir "Stollar" ekranida stol qaysi zalda (masalan
// "Katta zal") ekani ko'rinishi uchun qo'shildi, qolgan chaqiruvchilarga
// (chefKitchen.js, waiterTables.js'dagi eski flat /tables) qo'shimcha maydon
// sifatida xavfsiz — ular undan foydalanmaydi, lekin yo'q qilmaydi.
function listTablesOverview() {
  const tables = db
    .prepare(
      `SELECT t.*, tz.name AS zone_name
       FROM tables t
       LEFT JOIN table_zones tz ON tz.id = t.zone_id
       WHERE t.is_active = 1
       ORDER BY (tz.id IS NULL), tz.sort_order, tz.id, t.sort_order, t.id`
    )
    .all();
  const openOrders = db.prepare("SELECT * FROM orders WHERE status = 'open'").all();
  const byTable = new Map(openOrders.map((o) => [o.table_id, o]));

  const itemCountStmt = db.prepare(
    "SELECT COALESCE(SUM(quantity),0) AS cnt, COALESCE(SUM(subtotal),0) AS total FROM order_items WHERE order_id = ? AND status = 'active'"
  );

  return tables.map((t) => {
    const order = byTable.get(t.id);
    if (!order) {
      return { id: t.id, name: t.name, zone_name: t.zone_name || null, occupied: false, item_count: 0, total: 0, order_id: null };
    }
    const agg = itemCountStmt.get(order.id);
    return {
      id: t.id,
      name: t.name,
      zone_name: t.zone_name || null,
      occupied: true,
      item_count: agg.cnt,
      total: agg.total,
      order_id: order.id,
    };
  });
}

// Afitsiant "Stollar" ekrani qayta dizayni (2026-10-15) uchun: tables.name
// bir xil zal (table_zones) ichidagi stollar bitta zalda, boshqa zaldagi
// (bir xil raqamli) stollar o'z zalida alohida chiqishi kerak — ilgari
// listTablesOverview() flat (zal e'tiborsiz) ro'yxat qaytargani uchun
// stollar "1,1,1,1,2,2,2,..." aralashib ko'rinardi. Bitta JOIN+GROUP BY
// so'rov (N+1 yo'q) — har bir stol uchun ochiq buyurtma va uning faol
// taomlari summasi/soni shu yerning o'zida hisoblanadi.
function listTablesOverviewByHall() {
  const rows = db
    .prepare(
      `SELECT
         t.id AS table_id, t.name AS table_name,
         tz.id AS zone_id, tz.name AS zone_name,
         o.id AS order_id, o.opened_at AS opened_at, o.bill_requested AS bill_requested,
         COALESCE(SUM(CASE WHEN oi.status = 'active' THEN oi.quantity ELSE 0 END), 0) AS dishes,
         COALESCE(SUM(CASE WHEN oi.status = 'active' THEN oi.subtotal ELSE 0 END), 0) AS total,
         COALESCE(SUM(CASE WHEN oi.status = 'active' AND oi.sent_at IS NULL THEN oi.quantity ELSE 0 END), 0) AS pending_count,
         COALESCE(SUM(CASE WHEN oi.status = 'active' AND oi.ready_at IS NOT NULL AND oi.picked_up_at IS NULL THEN oi.quantity ELSE 0 END), 0) AS ready_count
       FROM tables t
       LEFT JOIN table_zones tz ON tz.id = t.zone_id
       LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE t.is_active = 1
       GROUP BY t.id
       ORDER BY (tz.id IS NULL), tz.sort_order, tz.id, t.sort_order, t.id`
    )
    .all();

  const hallsByKey = new Map();
  let busy = 0;
  let free = 0;
  let openTotal = 0;
  let readyItems = 0;
  const now = Date.now();

  for (const r of rows) {
    const key = r.zone_id || 0;
    if (!hallsByKey.has(key)) {
      hallsByKey.set(key, { id: r.zone_id || null, name: r.zone_name || "Boshqa", tables: [] });
    }
    let status = 'free';
    let minutes = null;
    if (r.order_id) {
      status = r.bill_requested ? 'bill' : 'busy';
      minutes = Math.max(0, Math.round((now - new Date(r.opened_at).getTime()) / 60000));
      busy += 1;
      openTotal += r.total;
      readyItems += r.ready_count;
    } else {
      free += 1;
    }
    hallsByKey.get(key).tables.push({
      id: r.table_id,
      number: r.table_name,
      status,
      guests: null, // hozircha mehmon soni kuzatilmaydi — mavjud oqimda kiritish joyi yo'q
      dishes: r.dishes,
      total: r.total,
      minutes,
      order_id: r.order_id || null,
      readyCount: r.ready_count,
      pendingCount: r.pending_count,
    });
  }

  return {
    summary: { busy, free, openTotal, readyItems },
    halls: Array.from(hallsByKey.values()),
  };
}

// Afitsiant "Hisob-kitob" bosganda — stol hisobi KASSAGA yuboriladi va stol
// DARHOL avtomatik bo'shaydi (buyurtma 'closed' bo'lgani uchun, yangi mehmon
// shu zahoti yangi buyurtma ocha oladi). Admin print_requests navbatiga
// YOZILMAYDI — kassir chekni o'z ekranidagi mavjud chek oqimi orqali (QZ Tray)
// o'zi chop etadi, closeTable() dagi kabi emas. `discardPending=true` bo'lsa,
// hali oshxonaga yuborilmagan taomlar bekor qilinadi (ombor qaytariladi) va
// hisobga kirmaydi — bu holat FAQAT route darajasida (waiterOrders.js) avval
// aniq tasdiqlangandan keyin true bo'lib keladi.
function requestBillToCashier(tableId, waiterId, discardPending) {
  const run = db.transaction(() => {
    const table = getTable(tableId);
    const orderRow = findOpenOrderRow(table.id);
    if (!orderRow) {
      throw new OrderError("Bu stolda ochiq buyurtma yo'q — hisob allaqachon kassaga yuborilgan bo'lishi mumkin", 404);
    }

    const sentCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = ? AND status = 'active' AND sent_at IS NOT NULL")
      .get(orderRow.id).cnt;
    if (sentCount === 0) {
      throw new OrderError('Avval taomlarni oshxonaga yuboring');
    }

    const pendingRows = db
      .prepare("SELECT * FROM order_items WHERE order_id = ? AND status = 'active' AND sent_at IS NULL")
      .all(orderRow.id);
    if (pendingRows.length > 0) {
      if (!discardPending) {
        throw new OrderError('Yuborilmagan taomlar bor — avval yuboring yoki bekor qiling', 409);
      }
      const ts = nowIso();
      pendingRows.forEach((p) => {
        if (p.quantity > 0) {
          const menuItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(p.menu_item_id);
          if (menuItem && menuItem.inventory_item_id) {
            inventory.release(menuItem.inventory_item_id, p.quantity, { orderItemId: p.id, userId: waiterId });
          }
        }
        db.prepare(
          "UPDATE order_items SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?"
        ).run(waiterId, ts, 'Hisobdan oldin yuborilmagan', p.id);
      });
    }

    const activeItems = db
      .prepare("SELECT subtotal FROM order_items WHERE order_id = ? AND status = 'active'")
      .all(orderRow.id);
    if (activeItems.length === 0) {
      throw new OrderError("Buyurtmada taom qolmadi, hisob-kitob qilib bo'lmaydi");
    }
    const total = activeItems.reduce((sum, it) => sum + it.subtotal, 0);
    const ts2 = nowIso();
    db.prepare(
      `UPDATE orders SET status = 'closed', closed_by = ?, closed_at = ?, total_amount = ?, bill_requested = 1 WHERE id = ?`
    ).run(waiterId, ts2, total, orderRow.id);

    return orderRow.id;
  });

  const orderId = run();
  const view = buildOrderView(orderId);
  return {
    orderId: view.order.id,
    items: view.items.map((it) => ({ name: it.name_snapshot, qty: it.quantity, unit_price: it.unit_price, subtotal: it.subtotal })),
    total: view.total,
  };
}

// Kassir "Kassada kutayotgan hisoblar" bo'limi uchun — afitsiant yuborgan,
// hali to'lanmagan hisoblar, eng eskisi birinchi.
function listPendingCashierBills() {
  const rows = db
    .prepare(
      `SELECT o.id AS order_id, t.name AS table_name, tz.name AS zone_name,
              COALESCE(cu.full_name, cu.username) AS waiter_name,
              o.closed_at AS closed_at, o.total_amount AS total
       FROM orders o
       JOIN tables t ON t.id = o.table_id
       LEFT JOIN table_zones tz ON tz.id = t.zone_id
       LEFT JOIN users cu ON cu.id = o.closed_by
       WHERE o.status = 'closed' AND o.bill_requested = 1 AND o.payment_method IS NULL
       ORDER BY o.closed_at ASC`
    )
    .all();
  const itemsStmt = db.prepare(
    "SELECT name_snapshot, quantity, subtotal FROM order_items WHERE order_id = ? AND status = 'active' ORDER BY id"
  );
  return rows.map((r) => ({ ...r, items: itemsStmt.all(r.order_id) }));
}

// Kassir navbatdagi hisobni to'laydi — closeTable()dan farqli, bu yerda
// buyurtma ALLAQACHON yopilgan (bill_requested orqali), faqat to'lov
// ma'lumoti to'ldiriladi. Chekni kassir o'zining mavjud chek oqimi
// (openReceiptByOrderId) orqali shu zahoti ko'rib chop etadi.
function payPendingBill(orderId, userId, paymentInfo) {
  const run = db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new OrderError('Hisob topilmadi', 404);
    if (order.status !== 'closed' || !order.bill_requested) {
      throw new OrderError("Bu hisob kassada kutayotganlar ro'yxatida emas", 404);
    }
    if (order.payment_method) {
      throw new OrderError("Bu hisob allaqachon to'langan", 409);
    }
    const shift = cashShifts.requireOpenShift(userId);
    db.prepare(
      `UPDATE orders SET payment_method = ?, cash_amount = ?, card_amount = ?, cash_shift_id = ? WHERE id = ?`
    ).run(paymentInfo.payment_method, paymentInfo.cash_amount, paymentInfo.card_amount, shift.id, orderId);
    return orderId;
  });

  const id = run();
  return buildOrderView(id, { includeCancelled: true });
}

// Afitsiant mijozdan "hisobni olib keling" degan so'rovni eshitganda shu
// belgini qo'yadi (yoki bekor qiladi) — stol kartochkasi "BAND" o'rniga
// "HISOB" holatini ko'rsatadi. Yopiq/ochiq buyurtmasi yo'q stolga qo'llab
// bo'lmaydi.
function setBillRequested(tableId, requested) {
  const table = getTable(tableId);
  const orderRow = findOpenOrderRow(table.id);
  if (!orderRow) throw new OrderError('Bu stolda ochiq buyurtma yo\'q', 404);
  db.prepare('UPDATE orders SET bill_requested = ? WHERE id = ?').run(requested ? 1 : 0, orderRow.id);
  return buildOrderView(orderRow.id);
}

module.exports = {
  OrderError,
  getOpenOrderForTable,
  addItemToTable,
  updateOrderItem,
  markItemPickedUp,
  sendPendingItems,
  cancelOrderItem,
  closeTable,
  cancelEmptyOrder,
  getReceipt,
  listTablesOverview,
  listTablesOverviewByHall,
  setBillRequested,
  requestBillToCashier,
  listPendingCashierBills,
  payPendingBill,
  buildOrderView,
};
