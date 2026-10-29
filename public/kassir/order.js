// Kassir "Hisob-kitob" ekrani — afitsiantning order.js'idan farqli, bu yerda
// MENYU/taom qo'shish yo'q (kassir faqat mavjud buyurtmani ko'radi va hisob-
// kitob qiladi). escapeHtml() — ../app.js'dan global.
const params = new URLSearchParams(window.location.search);
const TABLE_ID = params.get('table');

async function loadTableName() {
  try {
    const tables = await api('/kassir/tables');
    const t = tables.find((x) => String(x.id) === String(TABLE_ID));
    if (t) {
      document.getElementById('tableTitle').textContent = t.zone_name ? `${t.name} · ${t.zone_name}` : t.name;
    }
  } catch (e) { /* jim */ }
}

let currentOrderTotal = 0; // to'lov turi so'rovida kerak (askPaymentInfo)

function renderOrder(view) {
  const box = document.getElementById('orderLines');
  const totalEl = document.getElementById('totalAmount');
  const closeBtn = document.getElementById('closeBtn');
  const cancelOrderBtn = document.getElementById('cancelOrderBtn');
  currentOrderTotal = view ? view.total : 0;

  if (!view) {
    box.innerHTML = '<p class="dim">Hozircha bu stolda ochiq buyurtma yo\'q.</p>';
    totalEl.textContent = fmtMoney(0);
    closeBtn.style.display = 'none';
    cancelOrderBtn.style.display = 'none';
    return;
  }

  if (view.items.length === 0) {
    // Afitsiant barcha taomlarni bekor qilgan bo'lishi mumkin — closeTable()
    // bo'sh chekni rad etadi, shu sabab stolni bo'shatishning yagona yo'li
    // "Bo'shatish" (cancel-order).
    box.innerHTML = '<p class="dim">Buyurtmada taom yo\'q (hammasi bekor qilingan). Stolni bo\'shatish uchun pastdagi tugmani bosing.</p>';
    totalEl.textContent = fmtMoney(0);
    closeBtn.style.display = 'none';
    cancelOrderBtn.style.display = '';
    return;
  }

  closeBtn.style.display = '';
  cancelOrderBtn.style.display = 'none';
  box.innerHTML = view.items.map((it) => `
    <div class="order-line">
      <div>
        <div class="ol-name">${escapeHtml(it.name_snapshot)}</div>
        <div class="ol-meta">${it.quantity} × ${fmtMoney(it.unit_price)}</div>
      </div>
      <div class="ol-subtotal">${fmtMoney(it.subtotal)}</div>
    </div>
  `).join('');
  totalEl.textContent = fmtMoney(view.total);
}

async function loadOrder() {
  try {
    const view = await api(`/kassir/tables/${TABLE_ID}/order`);
    renderOrder(view);
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('closeBtn').addEventListener('click', async () => {
  const ok = await customConfirm("Stolni yopib, hisob-kitob qilasizmi? Bu amalni ortga qaytarib bo'lmaydi.");
  if (!ok) return;
  // To'lov turi (naqd/karta/aralash) — "Moliya va kassa" auditi (2026-10-10),
  // kassir uchun majburiy (serverda ham tekshiriladi).
  const paymentInfo = await askPaymentInfo(currentOrderTotal);
  if (!paymentInfo) return;
  try {
    const receipt = await api(`/kassir/tables/${TABLE_ID}/close`, { method: 'POST', body: paymentInfo });
    toast('Hisob-kitob yakunlandi.');
    // Chekni kassir o'zi shu yerda ko'rib chop eta oladi (afitsiantdan farqli —
    // u yerda printer administrator kompyuteriga ulangani uchun faqat navbatga
    // qo'yiladi; kassa kompyuterida esa QZ Tray o'rnatilgan deb kutiladi).
    openReceiptByOrderId(receipt.order.id, 'kassir');
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('cancelOrderBtn').addEventListener('click', async () => {
  const ok = await customConfirm('Buyurtmada taom yo\'q. Stolni bo\'shatasizmi? Chek chiqmaydi.');
  if (!ok) return;
  try {
    await api(`/kassir/tables/${TABLE_ID}/cancel-order`, { method: 'POST' });
    toast('Stol bo\'shatildi.');
    setTimeout(() => { window.location.href = 'tables.html'; }, 900);
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  if (!TABLE_ID) {
    window.location.href = 'tables.html';
    return;
  }
  loadTableName();
  loadOrder();
  setInterval(loadOrder, 8000);
});
