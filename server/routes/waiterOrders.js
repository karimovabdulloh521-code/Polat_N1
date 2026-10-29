const express = require('express');
const { db } = require('../db');
const {
  getOpenOrderForTable,
  addItemToTable,
  updateOrderItem,
  markItemPickedUp,
  sendPendingItems,
  cancelOrderItem,
  cancelEmptyOrder,
  getReceipt,
  requestBillToCashier,
} = require('../services/orders');
const { asyncRoute } = require('../routeUtils');

const router = express.Router();

router.get('/tables/:id/order', asyncRoute((req, res) => {
  const view = getOpenOrderForTable(req.params.id);
  res.json(view); // null bo'lishi mumkin — frontend "ochiq buyurtma yo'q" holatini shunday biladi
}));

router.post('/tables/:id/items', asyncRoute((req, res) => {
  const { menu_item_id, quantity, note } = req.body || {};
  const view = addItemToTable(req.params.id, menu_item_id, quantity || 1, req.user.id, note);
  res.json(view);
}));

// Shu stolning ochiq buyurtmasidagi hali yuborilmagan taomlarning hammasini
// bitta paytda oshpazga (kitchen ekraniga) yuboradi.
router.post('/tables/:id/send', asyncRoute((req, res) => {
  const view = sendPendingItems(req.params.id);

  // Yangi WebSocket oshxona printer agentiga ham yuboramiz (server/printer.js,
  // app.locals.kitchen — server/index.js'da o'rnatiladi). Shu safar YUBORILGAN
  // taomlarni mavjud kitchen_tickets/kitchen_ticket_items yozuvidan (sendPendingItems
  // yuqorida allaqachon yaratgan, faqat shu partiyaga tegishli) olamiz — aks holda
  // butun buyurtmaning barcha faol taomini qayta chop etib yuborardi. Printer
  // xatosi (agent oflayn, token noto'g'ri va h.k.) zakazning o'zi saqlanishiga
  // umuman ta'sir qilmasin uchun try/catch ichida.
  try {
    const kitchen = req.app.locals.kitchen;
    if (kitchen) {
      const ticket = db
        .prepare('SELECT * FROM kitchen_tickets WHERE order_id = ? ORDER BY id DESC LIMIT 1')
        .get(view.order.id);
      if (ticket) {
        const ticketItems = db
          .prepare('SELECT name_snapshot, quantity, note FROM kitchen_ticket_items WHERE kitchen_ticket_id = ?')
          .all(ticket.id);
        kitchen.printOrder({
          id: view.order.id,
          type: 'dine_in', // print-agent.js'da aniq stol-cheki shabloni tanlanishi uchun (2026-10-18)
          table: view.order.table_name,
          waiter: view.order.opened_by_name,
          items: ticketItems.map((it) => ({ name: it.name_snapshot, qty: it.quantity, note: it.note || undefined })),
          note: view.order.note || undefined,
          createdAt: Date.now(),
        });
      }
    }
  } catch (err) {
    console.error('Oshxona printer agentiga (WebSocket) yuborishda xato:', err);
  }

  res.json(view);
}));

router.patch('/items/:id', asyncRoute((req, res) => {
  const { quantity, note, reason } = req.body || {};
  const view = updateOrderItem(req.params.id, { quantity, note }, req.user.id, reason);
  res.json(view);
}));

router.delete('/items/:id', asyncRoute((req, res) => {
  const view = cancelOrderItem(req.params.id, req.user.id, req.body?.reason);
  res.json(view);
}));

// Afitsiant tayyor taomni to'g'ridan-to'g'ri "Oldim" deb belgilaydi —
// bildirishnoma/"Qabul qildim" oqimidan mustaqil (server/routes/waiterNotifications.js
// bilan bir xil natijaga olib keladi, lekin bildirishnoma yozuviga bog'liq emas).
router.post('/items/:id/picked-up', asyncRoute((req, res) => {
  const view = markItemPickedUp(req.params.id);
  res.json(view);
}));

// 2026-10-24, "Moliyaviy aniqlik": eski, to'lov turisiz stol yopish yo'li
// O'CHIRILDI. Afitsiant sahifalari uni 2026-10-15'dan beri chaqirmaydi
// (o'rniga /request-bill → kassir to'lov turini kiritadi), lekin API ochiq
// qolgani uchun to'g'ridan-to'g'ri so'rov bilan stolni `payment_method=NULL`
// holda yopish mumkin edi — bunday tushum kassa smenasida ko'rinmasdi.
router.post('/tables/:id/close', (req, res) => {
  res.status(410).json({
    error: "Stolni bu yo'l bilan yopib bo'lmaydi. \"Hisob-kitob → kassaga\" tugmasidan foydalaning.",
  });
});

// "Hisob-kitob → kassaga" — afitsiant UI'si endi shuni chaqiradi (eski
// POST /tables/:id/close hamon ishlaydi, lekin afitsiant sahifalari uni
// chaqirmaydi, 2026-10-15). Yuborilmagan taom bo'lsa avval 409 + pendingCount
// bilan ogohlantiradi, `discardPending:true` kelsa ularni bekor qilib davom
// etadi (services/orders.js'dagi requestBillToCashier()).
router.post('/tables/:id/request-bill', asyncRoute((req, res) => {
  const discardPending = !!(req.body && req.body.discardPending);
  if (!discardPending) {
    const view = getOpenOrderForTable(req.params.id);
    if (!view) {
      return res.status(404).json({ error: "Bu stolda ochiq buyurtma yo'q — hisob allaqachon kassaga yuborilgan bo'lishi mumkin" });
    }
    const pendingCount = view.items.filter((it) => !it.sent_at).length;
    const sentCount = view.items.length - pendingCount;
    if (sentCount === 0) {
      return res.status(400).json({ error: 'Avval taomlarni oshxonaga yuboring' });
    }
    if (pendingCount > 0) {
      return res.status(409).json({ error: 'Yuborilmagan taomlar bor — avval yuboring yoki bekor qiling', pendingCount });
    }
  }
  const result = requestBillToCashier(req.params.id, req.user.id, discardPending);
  res.json(result);
}));

// Faol taomi qolmagan (hammasi bekor qilingan) ochiq buyurtmani hisob-kitobsiz
// yopib, stolni bo'shatadi — closeTable() dan farqli, chek/print_requests yozuvi
// yaratmaydi (services/orders.js'dagi cancelEmptyOrder() izohiga qarang).
router.post('/tables/:id/cancel-order', asyncRoute((req, res) => {
  const view = cancelEmptyOrder(req.params.id, req.user.id);
  res.json(view);
}));

router.get('/tables/:id/receipt/latest', asyncRoute((req, res) => {
  const order = db
    .prepare('SELECT id FROM orders WHERE table_id = ? ORDER BY id DESC LIMIT 1')
    .get(req.params.id);
  if (!order) return res.status(404).json({ error: "Bu stol uchun hali buyurtma bo'lmagan" });
  res.json(getReceipt(order.id));
}));

// Har qanday login (afitsiant yoki admin) o'zi yopgan (yoki boshqa) buyurtma chekini
// ID bo'yicha ko'ra oladi — stol yopilgach darhol chekka o'tish shu orqali ishlaydi.
router.get('/orders/:id/receipt', asyncRoute((req, res) => {
  res.json(getReceipt(req.params.id));
}));

module.exports = router;
