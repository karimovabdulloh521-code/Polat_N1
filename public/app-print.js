// Chek / QZ Tray / oshxona cheki chop etish — 2026-10-24'da app.js'dan ajratildi
// ("Kod sifati": app.js 900 qator edi). Kod O'ZGARTIRILMAGAN, faqat ko'chirildi.
// app.js'dan KEYIN ulanadi va uning global yordamchilarini (api, escapeHtml,
// fmtMoney, toast, API_BASE ...) ishlatadi.

// ---------------- Chekni yangi oyna/tab OCHMASDAN chop etish (modal) ----------------
// Avval "Chekni chop etish" har bosilganda /waiter/receipt.html'ni target="_blank"
// bilan yangi tabda ochardi — bir nechta chek kelsa, tab ustiga tab ko'payib
// borardi. Endi hech qanday navigatsiya/yangi oyna yo'q: chek ma'lumoti fetch
// qilinib, shu (admin) sahifaning o'zida umumiy .modal-backdrop naqshida
// ko'rsatiladi; QZ Tray kutubxonasi esa har admin sahifasida oldindan emas,
// faqat chek birinchi marta chop etilayotganda "lazy" yuklanadi.
let qzScriptPromise = null;
function loadQzTray() {
  if (typeof qz !== 'undefined') return Promise.resolve();
  if (qzScriptPromise) return qzScriptPromise;
  qzScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('QZ Tray kutubxonasi yuklanmadi (internet aloqasini tekshiring).'));
    document.head.appendChild(script);
  });
  return qzScriptPromise;
}

let qzSecuritySetUp = false;
function setupQzSecurity() {
  if (qzSecuritySetUp) return;
  qzSecuritySetUp = true;
  qz.security.setCertificatePromise((resolve, reject) => {
    api('/qz/certificate').then((data) => resolve(data.certificate)).catch(reject);
  });
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
    api('/qz/sign', { method: 'POST', body: { request: toSign } })
      .then((data) => resolve(data.signature))
      .catch(reject);
  });
}

const RECEIPT_PRINTER_NAME = 'Kassa-Printer';

// 2026-10-10: foydalanuvchida kassa va oshxona uchun BITTA jismoniy printer
// bor — avvalgi alohida "Oshxona-Printer" nomi olib tashlandi, oshxona
// cheki endi xuddi shu RECEIPT_PRINTER_NAME'ga chop etiladi.
const KITCHEN_PRINTER_NAME = RECEIPT_PRINTER_NAME;

// Chap va o'ng matnni bitta qatorga (belgilangan kenglikda) tekislaydi —
// termal printerda ustunlar (nom ... narx) to'g'ri qatorga tushishi uchun.
function padReceiptLine(left, right, width = 42) {
  left = String(left);
  right = String(right);
  const space = width - left.length - right.length;
  if (space < 1) {
    left = left.slice(0, Math.max(0, width - right.length - 1));
    return `${left} ${right}`;
  }
  return left + ' '.repeat(space) + right;
}

// Chekni ESC/POS xom (raw) buyruqlar ketma-ketligiga aylantiradi.
function buildEscPosReceipt(view) {
  const WIDTH = 42;
  const activeItems = view.items.filter((it) => it.status === 'active');
  const data = [];
  data.push('\x1B\x40');
  data.push('\x1B\x61\x01');
  data.push('\x1B\x21\x30');
  data.push("Ziyo Famliy restorani\n");
  data.push('\x1B\x21\x00');
  data.push(`${view.order.table_name}\n`);
  data.push(`${fmtDateTime(view.order.closed_at || view.order.opened_at)}\n`);
  data.push('-'.repeat(WIDTH) + '\n');
  data.push('\x1B\x61\x00');
  activeItems.forEach((it) => {
    const name = `${it.name_snapshot} x${it.quantity}`;
    data.push(padReceiptLine(name, fmtMoney(it.subtotal), WIDTH) + '\n');
  });
  data.push('-'.repeat(WIDTH) + '\n');
  data.push('\x1B\x21\x30');
  data.push(padReceiptLine('JAMI', fmtMoney(view.total), WIDTH) + '\n');
  data.push('\x1B\x21\x00');
  data.push('\x1B\x61\x01');
  data.push('Xaridingiz uchun rahmat!\n');
  data.push('\n\n\n');
  data.push('\x1D\x56\x41\x00');
  return data;
}

function ensureReceiptModal() {
  let el = document.getElementById('receiptModal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'receiptModal';
    el.className = 'modal-backdrop hidden';
    el.innerHTML = `
      <div class="modal">
        <div id="receiptModalBox" class="receipt"><p class="dim">Yuklanmoqda...</p></div>
        <div class="modal-actions">
          <button class="btn" id="receiptModalClose">Yopish</button>
          <button class="btn primary" id="receiptModalPrint">Chekni chop etish</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }
  return el;
}

function renderReceiptBox(view) {
  if (view.kind === 'customer') return renderCustomerReceiptBox(view);
  if (view.kind === 'manual') return renderManualReceiptBox(view);
  const box = document.getElementById('receiptModalBox');
  const activeItems = view.items.filter((it) => it.status === 'active');
  box.innerHTML = `
    <h2>Ziyo Famliy restorani</h2>
    <div class="r-sub">${escapeHtml(view.order.table_name)} · ${fmtDateTime(view.order.closed_at || view.order.opened_at)}</div>
    <hr>
    <table>
      ${activeItems.map((it) => `
        <tr>
          <td>${escapeHtml(it.name_snapshot)} × ${it.quantity}</td>
          <td class="text-right">${fmtMoney(it.subtotal)}</td>
        </tr>
      `).join('')}
      <tr class="r-total-row">
        <td>Jami</td>
        <td class="text-right">${fmtMoney(view.total)}</td>
      </tr>
    </table>
    <hr>
    <div class="dim" style="font-size:12px;">
      ${view.order.opened_by_name ? `Ochdi: ${escapeHtml(view.order.opened_by_name)}<br>` : ''}
      ${view.order.closed_by_name ? `Yopdi: ${escapeHtml(view.order.closed_by_name)}<br>` : ''}
      Holat: ${view.order.status === 'closed' ? 'Yopilgan' : 'Ochiq'}
    </div>
  `;
}

// Landing sahifadan kelgan (login shart emas) mijoz buyurtmasi (customer_orders)
// uchun chek — dine-in `orders`dan farqli, stol/afitsiant emas, mijoz
// ismi/telefoni/manzili bor (2026-09-08, admin "Buyurtmalar" sahifasidagi
// "🖨 Chek" tugmasi orqali, public/admin/customer-orders.js). Bir xil modal/QZ
// Tray infratuzilmasi (ensureReceiptModal/printReceiptView) ishlatiladi,
// faqat render/ESC-POS qurish funksiyasi `view.kind === 'customer'` bo'yicha
// ajratiladi.
function renderCustomerReceiptBox(view) {
  const box = document.getElementById('receiptModalBox');
  box.innerHTML = `
    <h2>Ziyo Famliy restorani</h2>
    <div class="r-sub">${escapeHtml(view.order.heading)} · ${fmtDateTime(view.order.created_at)}</div>
    <hr>
    <table>
      ${view.items.map((it) => `
        <tr>
          <td>${escapeHtml(it.name_snapshot)} × ${it.quantity}</td>
          <td class="text-right">${fmtMoney(it.subtotal)}</td>
        </tr>
      `).join('')}
      <tr class="r-total-row">
        <td>Jami</td>
        <td class="text-right">${fmtMoney(view.total)}</td>
      </tr>
    </table>
    <hr>
    <div class="dim" style="font-size:12px;">
      ${view.order.phone ? `Tel: ${escapeHtml(view.order.phone)}<br>` : ''}
      ${view.order.address ? `Manzil: ${escapeHtml(view.order.address)}<br>` : ''}
      ${view.order.note ? `Izoh: ${escapeHtml(view.order.note)}<br>` : ''}
    </div>
  `;
}

// Kassir "Hisoblash" (qo'lda kiritilgan, stol/menyuga bog'liq bo'lmagan chek)
// uchun — 2026-09-09, server/services/manualBills.js'dagi `kind: 'manual'`
// view'iga mos. renderCustomerReceiptBox/buildEscPosReceiptCustomer bilan bir
// xil naqsh, faqat telefon/manzil o'rniga "Hisobladi: <kassir>" ko'rsatiladi.
function renderManualReceiptBox(view) {
  const box = document.getElementById('receiptModalBox');
  box.innerHTML = `
    <h2>Ziyo Famliy restorani</h2>
    <div class="r-sub">${escapeHtml(view.order.heading)} · ${fmtDateTime(view.order.created_at)}</div>
    <hr>
    <table>
      ${view.items.map((it) => `
        <tr>
          <td>${escapeHtml(it.name_snapshot)} × ${it.quantity}</td>
          <td class="text-right">${fmtMoney(it.subtotal)}</td>
        </tr>
      `).join('')}
      ${view.order.delivery_price ? `
        <tr>
          <td>Yetkazib berish</td>
          <td class="text-right">${fmtMoney(view.order.delivery_price)}</td>
        </tr>
      ` : ''}
      <tr class="r-total-row">
        <td>Jami</td>
        <td class="text-right">${fmtMoney(view.total)}</td>
      </tr>
    </table>
    ${view.order.customer_phone ? `<div class="r-customer-phone">${escapeHtml(view.order.customer_phone)}</div>` : ''}
    <hr>
    <div class="dim" style="font-size:12px;">
      ${view.order.note ? `Manzil: ${escapeHtml(view.order.note)}<br>` : ''}
      ${view.order.created_by_name ? `Hisobladi: ${escapeHtml(view.order.created_by_name)}<br>` : ''}
    </div>
  `;
}

function buildEscPosReceiptManual(view) {
  const WIDTH = 42;
  const data = [];
  data.push('\x1B\x40');
  data.push('\x1B\x61\x01');
  data.push('\x1B\x21\x30');
  data.push("Ziyo Famliy restorani\n");
  data.push('\x1B\x21\x00');
  data.push(`${view.order.heading}\n`);
  data.push(`${fmtDateTime(view.order.created_at)}\n`);
  data.push('-'.repeat(WIDTH) + '\n');
  data.push('\x1B\x61\x00');
  view.items.forEach((it) => {
    const name = `${it.name_snapshot} x${it.quantity}`;
    data.push(padReceiptLine(name, fmtMoney(it.subtotal), WIDTH) + '\n');
  });
  if (view.order.delivery_price) {
    data.push(padReceiptLine('Yetkazib berish', fmtMoney(view.order.delivery_price), WIDTH) + '\n');
  }
  data.push('-'.repeat(WIDTH) + '\n');
  data.push('\x1B\x21\x30');
  data.push(padReceiptLine('JAMI', fmtMoney(view.total), WIDTH) + '\n');
  data.push('\x1B\x21\x00');
  if (view.order.customer_phone) {
    // Mijoz raqami katta+qalin+markazda chiqadi (2026-09-26, foydalanuvchi
    // so'rovi) — keyingi qatorlar uchun shrift/tekislash oddiy holatga qaytariladi.
    data.push('\x1B\x61\x01');
    data.push('\x1B\x45\x01');
    data.push('\x1B\x21\x30');
    data.push(`Mijoz: ${view.order.customer_phone}\n`);
    data.push('\x1B\x21\x00');
    data.push('\x1B\x45\x00');
    data.push('\x1B\x61\x00');
  }
  if (view.order.note) data.push(`Manzil: ${view.order.note}\n`);
  if (view.order.created_by_name) data.push(`Hisobladi: ${view.order.created_by_name}\n`);
  data.push('\x1B\x61\x01');
  data.push('Xaridingiz uchun rahmat!\n');
  data.push('\n\n\n');
  data.push('\x1D\x56\x41\x00');
  return data;
}

function buildEscPosReceiptCustomer(view) {
  const WIDTH = 42;
  const data = [];
  data.push('\x1B\x40');
  data.push('\x1B\x61\x01');
  data.push('\x1B\x21\x30');
  data.push("Ziyo Famliy restorani\n");
  data.push('\x1B\x21\x00');
  data.push(`${view.order.heading}\n`);
  data.push(`${fmtDateTime(view.order.created_at)}\n`);
  data.push('-'.repeat(WIDTH) + '\n');
  data.push('\x1B\x61\x00');
  view.items.forEach((it) => {
    const name = `${it.name_snapshot} x${it.quantity}`;
    data.push(padReceiptLine(name, fmtMoney(it.subtotal), WIDTH) + '\n');
  });
  data.push('-'.repeat(WIDTH) + '\n');
  data.push('\x1B\x21\x30');
  data.push(padReceiptLine('JAMI', fmtMoney(view.total), WIDTH) + '\n');
  data.push('\x1B\x21\x00');
  if (view.order.phone) data.push(`Tel: ${view.order.phone}\n`);
  if (view.order.address) data.push(`Manzil: ${view.order.address}\n`);
  data.push('\x1B\x61\x01');
  data.push('Xaridingiz uchun rahmat!\n');
  data.push('\n\n\n');
  data.push('\x1D\x56\x41\x00');
  return data;
}

async function printReceiptView(view) {
  await loadQzTray();
  setupQzSecurity();
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
  }
  const config = qz.configs.create(RECEIPT_PRINTER_NAME, { encoding: 'CP866' });
  const data = view.kind === 'customer' ? buildEscPosReceiptCustomer(view)
    : view.kind === 'manual' ? buildEscPosReceiptManual(view)
    : buildEscPosReceipt(view);
  await qz.print(config, data);
}

// ---------------- Oshxona cheki (kitchen ticket) — narxsiz, faqat taom+soni ----------------
// Mijoz/mehmon chekidan ATAYLAB alohida: bu yerda narx umuman ko'rsatilmaydi
// (oshxonaga faqat "qaysi stolga qaysi taomdan nechta tayyorlash kerak" kerak),
// va bu HECH QANDAY modal/tugma orqali emas — initChefKitchenTicketPrinting()
// tomonidan avtomatik chaqiriladi (pastga qarang).
function buildEscPosKitchenTicket(ticket) {
  const WIDTH = 42;
  const data = [];
  data.push('\x1B\x40');
  data.push('\x1B\x61\x01');
  data.push('\x1B\x21\x00');
  data.push('OSHXONA CHEKI\n');
  data.push(`${fmtDateTime(ticket.created_at)}\n`);
  data.push('='.repeat(WIDTH) + '\n');
  data.push('\x1B\x21\x30');
  data.push(`${ticket.table_name}\n`);
  data.push('-'.repeat(WIDTH) + '\n');
  data.push('\x1B\x61\x00');
  ticket.items.forEach((it) => {
    data.push(`${it.quantity} x ${it.name_snapshot}\n`);
  });
  data.push('\x1B\x21\x00');
  data.push('\n\n\n');
  data.push('\x1D\x56\x41\x00');
  return data;
}

async function printKitchenTicketView(ticket) {
  await loadQzTray();
  setupQzSecurity();
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
  }
  const config = qz.configs.create(KITCHEN_PRINTER_NAME, { encoding: 'CP866' });
  await qz.print(config, buildEscPosKitchenTicket(ticket));
}

// Afitsiant "🍽️ Oshxonaga yuborish" tugmasini bosganda server yangi
// kitchen_tickets yozuvi yaratadi (server/services/orders.js sendPendingItems()).
// Oshpaz kompyuterida doim ochiq turadigan /chef/kitchen.html sahifasi buni har
// 5s'da so'rab (poll), HECH QANDAY tugma bosilmasdan darhol oshxona printeriga
// chop etadi — oshpazning qo'li ovqat tayyorlash bilan band bo'lishi mumkin.
// Muvaffaqiyatli chop etilgach server printed_at bilan belgilanadi (bir marta
// chop etiladi, sahifa qayta yuklansa ham qayta chop etilmaydi). Xato bo'lsa
// (printer o'chiq/QZ Tray ishlamayapti) chek printed_at'siz qoladi — keyingi
// pollda avtomatik qayta urinadi; xato haqidagi ogohlantirish esa oshpazni har
// 5s'da bezovta qilmasligi uchun eng ko'pi bilan 30s'da bir marta ko'rsatiladi.
const printingKitchenTicketIds = new Set();
let lastKitchenPrintErrorAt = 0;

async function pollKitchenTickets() {
  let tickets;
  try {
    tickets = await api('/chef/kitchen-tickets/pending');
    reportPollResult('kitchenTickets', true);
  } catch (e) {
    reportPollResult('kitchenTickets', false, 'oshxona chek navbati');
    return; // keyingi tsiklda qayta urinadi
  }
  for (const ticket of tickets) {
    if (printingKitchenTicketIds.has(ticket.id)) continue;
    printingKitchenTicketIds.add(ticket.id);
    try {
      await printKitchenTicketView(ticket);
      await api(`/chef/kitchen-tickets/${ticket.id}/printed`, { method: 'POST' });
    } catch (err) {
      console.error('Oshxona cheki chop etilmadi:', err);
      const now = Date.now();
      if (now - lastKitchenPrintErrorAt > 30000) {
        lastKitchenPrintErrorAt = now;
        toast(
          `Oshxona chekini chop etib bo'lmadi: ${err.message || err}. Printer va QZ Tray dasturini tekshiring.`,
          'error',
          8000
        );
      }
    } finally {
      printingKitchenTicketIds.delete(ticket.id);
    }
  }
}

function initChefKitchenTicketPrinting() {
  if (!window.location.pathname.includes('/chef/')) return;
  pollKitchenTickets();
  setInterval(pollKitchenTickets, 5000);
}

function showReceiptModal(view) {
  const el = ensureReceiptModal();
  renderReceiptBox(view);
  el.classList.remove('hidden');
  const closeBtn = el.querySelector('#receiptModalClose');
  const printBtn = el.querySelector('#receiptModalPrint');
  const finish = () => {
    el.classList.add('hidden');
    closeBtn.removeEventListener('click', finish);
    printBtn.removeEventListener('click', onPrint);
    el.removeEventListener('click', onBackdrop);
  };
  const onBackdrop = (e) => { if (e.target === el) finish(); };
  const onPrint = async () => {
    printBtn.disabled = true;
    try {
      await printReceiptView(view);
      toast('Chek chop etildi.');
      finish();
    } catch (err) {
      console.error(err);
      alert(
        `Printerga chop etib bo'lmadi: ${err.message || err}\n\n` +
        `Tekshiring: QZ Tray dasturi ishga tushirilganmi va Windows'da printer aynan "${RECEIPT_PRINTER_NAME}" deb nomlanganmi.`
      );
    } finally {
      printBtn.disabled = false;
    }
  };
  closeBtn.addEventListener('click', finish);
  printBtn.addEventListener('click', onPrint);
  el.addEventListener('click', onBackdrop);
}

// area — qaysi rol hududidagi chek endpoint'i ishlatilishi kerak ('waiter'
// standart; kassir sahifasi 'kassir' bilan chaqiradi, server/routes/
// kassirTables.js'dagi GET /orders/:id/receipt'ga mos). Admin har doim ham
// (areaRole tekshiruvidan chetlab o'tadi) ikkalasini ham chaqira oladi.
async function openReceiptByOrderId(orderId, area = 'waiter') {
  try {
    const view = await api(`/${area}/orders/${orderId}/receipt`);
    showReceiptModal(view);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Admin "Buyurtmalar" (customer_orders) sahifasi buyurtmani items bilan
// birga ALLAQACHON yuklab olgan (GET /admin/customer-orders) — alohida
// "chek" API'siga ehtiyoj yo'q, shu obyektning o'zidan chek ko'rinishi
// tuziladi (public/admin/customer-orders.js chaqiradi).
const FULFILLMENT_LABEL_RECEIPT = { pickup: "Olib ketish", delivery: 'Yetkazib berish' };
function openCustomerReceiptModal(order) {
  const view = {
    kind: 'customer',
    order: {
      heading: `${FULFILLMENT_LABEL_RECEIPT[order.fulfillment] || order.fulfillment} — ${order.full_name}`,
      created_at: order.created_at,
      phone: order.phone,
      address: order.address,
      note: order.note,
    },
    items: order.items,
    total: order.total_amount,
  };
  showReceiptModal(view);
}
