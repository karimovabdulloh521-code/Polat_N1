// Kassir "Stollar" ekrani — afitsiantning tables.js bilan bir xil ko'rinish/
// naqsh, faqat /api/kassir/tables'dan o'qiydi va bosilganda order.html (kassir
// papkasidagi, taom qo'shish tugmasisiz) sahifasiga o'tadi.
// escapeHtml() — ../app.js'dan global.
// Zal (table_zones) bo'yicha guruhlash (2026-10-19) — stol qaysi zalda (masalan
// "Katta zal") ekani ko'rinsin deb. Server /kassir/tables javobini allaqachon
// zal bo'yicha tartiblab qaytaradi (listTablesOverview()), shu sabab bu yerda
// qayta saralash shart emas — faqat ketma-ket zal nomi o'zgargan joyda yangi
// sarlavha qo'yiladi.
function tileHtml(t) {
  return `
    <a class="table-tile ${t.occupied ? 'occupied' : 'free'}" href="order.html?table=${t.id}">
      <div class="t-name">${escapeHtml(t.name)}</div>
      <div class="t-status">${t.occupied ? `Band · ${t.item_count} taom` : "Bo'sh"}</div>
      ${t.occupied ? `<div class="t-total">${fmtMoney(t.total)}</div>` : ''}
    </a>`;
}

async function loadTables() {
  const grid = document.getElementById('tableGrid');
  try {
    const tables = await api('/kassir/tables');
    if (tables.length === 0) {
      grid.innerHTML = '<p class="dim">Hali stollar qo\'shilmagan. Admin bilan bog\'laning.</p>';
      return;
    }
    let html = '';
    let currentZone = undefined; // hali hech qanday guruh ochilmagan
    for (const t of tables) {
      const zoneName = t.zone_name || "Boshqa";
      if (zoneName !== currentZone) {
        if (currentZone !== undefined) html += '</div>';
        html += `<div class="card-title mt-8">${escapeHtml(zoneName)}</div><div class="table-grid">`;
        currentZone = zoneName;
      }
      html += tileHtml(t);
    }
    html += '</div>';
    grid.innerHTML = html;
  } catch (err) {
    grid.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

// "Kassada kutayotgan hisoblar" (2026-10-15) — afitsiant "Hisob-kitob"
// bosib kassaga yuborgan, hali to'lanmagan hisoblar (server/services/
// orders.js'dagi requestBillToCashier() shu navbatga yozadi). askPaymentInfo()/
// openReceiptByOrderId() — shift-ui.js/app.js'dan global.
let lastPendingBillIds = new Set();
let lastPendingBillsData = [];

function fmtMinutesAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'hozirgina';
  return `${mins} daq oldin`;
}

async function loadPendingBills() {
  const section = document.getElementById('pendingBillsSection');
  const list = document.getElementById('pendingBillsList');
  try {
    const bills = await api('/kassir/pending-bills');
    lastPendingBillsData = bills;
    if (bills.length === 0) {
      section.style.display = 'none';
      lastPendingBillIds = new Set();
      return;
    }
    section.style.display = '';
    const newOnes = bills.filter((b) => !lastPendingBillIds.has(b.order_id));
    if (lastPendingBillIds.size > 0 && newOnes.length > 0) {
      newOnes.forEach((b) => toast(`Yangi hisob keldi: ${escapeHtml(b.zone_name ? `${b.zone_name} · ` : '')}Stol ${escapeHtml(b.table_name)}`));
    }
    lastPendingBillIds = new Set(bills.map((b) => b.order_id));

    list.innerHTML = bills.map((b) => `
      <div class="card">
        <div class="card-row" style="justify-content:space-between; align-items:center;">
          <div class="card-title">${b.zone_name ? `${escapeHtml(b.zone_name)} · ` : ''}Stol ${escapeHtml(b.table_name)}</div>
          <div class="card-sub">${fmtMinutesAgo(b.closed_at)}</div>
        </div>
        <div class="card-sub">${escapeHtml(b.waiter_name || '')} · ${fmtMoney(b.total)}</div>
        <button class="btn small primary mt-8" data-pay="${b.order_id}">To'lovni qabul qilish</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-pay]').forEach((btn) => {
      btn.addEventListener('click', () => payPendingBillClick(Number(btn.dataset.pay)));
    });
  } catch (err) {
    section.style.display = 'none';
  }
}

async function payPendingBillClick(orderId) {
  const bill = lastPendingBillsData.find((b) => b.order_id === orderId);
  const total = bill ? bill.total : 0;
  const paymentInfo = await askPaymentInfo(total);
  if (!paymentInfo) return;
  try {
    await api(`/kassir/bills/${orderId}/pay`, { method: 'POST', body: paymentInfo });
    toast("To'lov qabul qilindi");
    openReceiptByOrderId(orderId, 'kassir');
    loadPendingBills();
    loadTables();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initNav('tables');
  loadTables();
  loadPendingBills();
  setInterval(() => {
    loadTables();
    loadPendingBills();
  }, 15000);
});
