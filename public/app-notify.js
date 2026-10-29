// Bildirishnomalar (afitsiant "tayyor" xabari, admin chop etish navbati,
// yetkazib berish ogohlantirishi) — 2026-10-24'da app.js'dan ajratildi. Kod
// O'ZGARTIRILMAGAN, faqat ko'chirildi. app.js va app-print.js'dan KEYIN ulanadi.

// Oshpaz dine-in taomni "🏁 Tayyor" deb belgilaganda (public/chef/kitchen.js)
// server "notifications" jadvaliga yozadi (server/routes/chefKitchen.js);
// AFITSIANT sahifalari shu yerda 10s'da poll qilib doimiy kartochka ko'rsatadi —
// oddiy toast emas, chunki "Qabul qildim" tugmasi bosilmaguncha ekrandan
// yo'qolmasligi kerak. Bosilgach server kim (ism) va qachon tasdiqlaganini
// yozadi, karta "✅ <Ism> qabul qildi" holatiga o'tadi (server ~30s grace-oyna
// bilan buni boshqa afitsiantlarning ekraniga ham yuboradi, keyin tushib qoladi).
// Faqat /waiter/ ostidagi sahifalarda ishlaydi (admin/chef/login/landing
// sahifalarida keraksiz so'rov yubormaslik uchun).
function ensureNotifList() {
  let el = document.getElementById('notifList');
  if (!el) {
    el = document.createElement('div');
    el.id = 'notifList';
    el.className = 'notif-list';
    const topbar = document.querySelector('.topbar');
    if (topbar && topbar.parentNode) {
      topbar.insertAdjacentElement('afterend', el);
    } else {
      document.body.insertBefore(el, document.body.firstChild);
    }
  }
  return el;
}

function renderWaiterNotifications(rows) {
  const box = ensureNotifList();
  if (!rows || rows.length === 0) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = rows.map((n) => `
    <div class="notif-card ${n.acknowledged_at ? 'done' : ''}">
      <span class="notif-msg">${escapeHtml(n.message)}</span>
      ${n.acknowledged_at
        ? `<span class="notif-ack">✅ ${escapeHtml(n.acknowledged_by_name || '')} qabul qildi</span>`
        : `<button class="btn small primary" data-ack="${n.id}">Qabul qildim</button>`}
    </div>
  `).join('');
  box.querySelectorAll('[data-ack]').forEach((btn) => {
    btn.addEventListener('click', () => acknowledgeWaiterNotification(Number(btn.dataset.ack)));
  });
}

async function acknowledgeWaiterNotification(id) {
  try {
    await api(`/waiter/notifications/${id}/acknowledge`, { method: 'POST' });
    pollWaiterNotifications();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Fon pollingida aloqa uzilganini xodimga ko'rsatish — "Real-time va
// ishonchlilik" auditi (2026-10-10): ilgari bu xatolar JIM yutilardi,
// xodim yangi bildirishnoma kelmayotganini "hammasi tinch" deb o'ylardi.
// Ketma-ket 3-marta muvaffaqiyatsiz bo'lsagina ogohlantiradi (bitta
// tasodifiy uzilishdan xavotirlanmasin uchun).
const pollFailCounts = {};
function reportPollResult(key, success, label) {
  if (success) {
    if (pollFailCounts[key] >= 3) toast('Aloqa tiklandi', 'ok');
    pollFailCounts[key] = 0;
  } else {
    pollFailCounts[key] = (pollFailCounts[key] || 0) + 1;
    if (pollFailCounts[key] === 3) {
      toast(`⚠️ Aloqa uzilgan bo'lishi mumkin (${label})`, 'error', 10000);
    }
  }
}

async function pollWaiterNotifications() {
  try {
    const rows = await api('/waiter/notifications/unread');
    renderWaiterNotifications(rows);
    reportPollResult('waiterNotif', true);
  } catch (e) {
    reportPollResult('waiterNotif', false, 'bildirishnomalar');
  }
}

function initWaiterNotifications() {
  if (!window.location.pathname.includes('/waiter/')) return;
  pollWaiterNotifications();
  setInterval(pollWaiterNotifications, 10000);
}

// ---------------- Admin: chop etish kutilayotgan cheklar ----------------
// Afitsiant stolni yopganda (hisob-kitob) chek endi o'zida chop etilmaydi —
// termal printer faqat administrator kompyuteriga ulangani uchun server
// print_requests navbatiga yozadi (server/services/orders.js closeTable()).
// Bu yerda xuddi shu afitsiant-bildirishnoma naqshi (yuqorida) takrorlanadi,
// faqat /admin/ sahifalarida ishlaydi va "Chekni chop etish" tugmasi hech
// qanday yangi tab/oyna ochmasdan, shu sahifaning o'zida modal ko'rinishida
// chekni ko'rsatadi (yuqoridagi "Chekni yangi oyna ochmasdan chop etish" bo'limi).
function renderPrintRequests(rows) {
  const box = ensureNotifList();
  if (!rows || rows.length === 0) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = rows.map((r) => `
    <div class="notif-card">
      <span class="notif-msg">${escapeHtml(r.table_name)} — hisob-kitob qilindi (${fmtMoney(r.total_amount)})</span>
      <button class="btn small primary" data-print-req="${r.id}" data-order-id="${r.order_id}">Chekni chop etish</button>
    </div>
  `).join('');
  box.querySelectorAll('[data-print-req]').forEach((btn) => {
    btn.addEventListener('click', () => {
      markPrintRequestPrinted(Number(btn.dataset.printReq));
      openReceiptByOrderId(Number(btn.dataset.orderId));
    });
  });
}

async function markPrintRequestPrinted(id) {
  try {
    await api(`/admin/print-requests/${id}/printed`, { method: 'POST' });
    pollPrintRequests();
  } catch (e) { /* jim — keyingi tsiklda ro'yxat baribir yangilanadi */ }
}

async function pollPrintRequests() {
  try {
    const rows = await api('/admin/print-requests/unread');
    renderPrintRequests(rows);
  } catch (e) { /* keyingi tsiklda qayta urinadi */ }
}

function initAdminPrintRequests() {
  if (!window.location.pathname.includes('/admin/')) return;
  pollPrintRequests();
  // 10s edi — admin chekni kutayotganda kechikish sezilarli bo'lgani uchun
  // 3s'ga tushirildi (foydalanuvchi so'rovi, 2026-09-07).
  setInterval(pollPrintRequests, 3000);
}

// ---------------- Yangi yetkazib berish buyurtmasi — admin/oshpaz/dastavkachi ----------------
// Mijoz landing sahifasidan yetkazib berish (delivery) buyurtmasi kelganda
// (server/routes/publicCustomerOrders.js) uch rolga BARAVAR ko'rinadigan
// bildirishnoma (2026-09-08) — shu bilan admin chekni tayyorlaydi, oshpaz
// taomni tayyorlaydi, dastavkachi esa oldindan xabardor bo'lib turadi.
// Yuqoridagi afitsiant/print-so'rovlar naqshi bilan bir xil (poll + "Ko'rdim"
// tugmasi + ~30s grace-oyna), lekin ALOHIDA konteynerda (deliveryAlertList) —
// admin sahifasida print-so'rovlar ro'yxati bilan bir xil notifList'ni
// ishlatsa, ikkalasi bir-birining innerHTML'ini almashtirib yuborar edi.
function ensureDeliveryAlertList() {
  let el = document.getElementById('deliveryAlertList');
  if (!el) {
    el = document.createElement('div');
    el.id = 'deliveryAlertList';
    el.className = 'notif-list';
    const topbar = document.querySelector('.topbar');
    if (topbar && topbar.parentNode) {
      topbar.insertAdjacentElement('afterend', el);
    } else {
      document.body.insertBefore(el, document.body.firstChild);
    }
  }
  return el;
}

function renderDeliveryAlerts(rows) {
  const box = ensureDeliveryAlertList();
  if (!rows || rows.length === 0) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = rows.map((n) => `
    <div class="notif-card ${n.acknowledged_at ? 'done' : ''}">
      <span class="notif-msg">${escapeHtml(n.message)}</span>
      ${n.acknowledged_at
        ? `<span class="notif-ack">✅ ${escapeHtml(n.acknowledged_by_name || '')} ko'rdi</span>`
        : `<button class="btn small primary" data-deliv-ack="${n.id}">Ko'rdim</button>`}
    </div>
  `).join('');
  box.querySelectorAll('[data-deliv-ack]').forEach((btn) => {
    btn.addEventListener('click', () => acknowledgeDeliveryAlert(Number(btn.dataset.delivAck)));
  });
}

async function acknowledgeDeliveryAlert(id) {
  try {
    await api(`/delivery-alerts/${id}/acknowledge`, { method: 'POST' });
    pollDeliveryAlerts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function pollDeliveryAlerts() {
  try {
    const rows = await api('/delivery-alerts/unread');
    renderDeliveryAlerts(rows);
    reportPollResult('deliveryAlerts', true);
  } catch (e) {
    reportPollResult('deliveryAlerts', false, 'yetkazib berish ogohlantirishi');
  }
}

function initDeliveryAlerts() {
  const p = window.location.pathname;
  if (!p.includes('/admin/') && !p.includes('/chef/') && !p.includes('/courier/')) return;
  pollDeliveryAlerts();
  setInterval(pollDeliveryAlerts, 5000);
}

