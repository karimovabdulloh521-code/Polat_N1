// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).
const STATUS_LABEL = { new: 'Yangi', confirmed: 'Tasdiqlangan', completed: 'Bajarildi', cancelled: 'Bekor qilingan' };
const STATUS_BADGE = { new: 'gold', confirmed: 'green', completed: 'green', cancelled: 'dim' };
// server/routes/adminCustomerOrders.js'dagi ALLOWED_STATUS_TRANSITIONS bilan
// AYNAN bir xil bo'lishi SHART — aks holda bu yerda ko'rsatilgan tugma
// bosilganda serverdan 400 qaytadi (2026-10-28 audit bilan topilgan, masalan
// 'completed'dan "Tasdiqlash" yoki 'new'dan to'g'ridan-to'g'ri "Bajarildi").
const ALLOWED_STATUS_TRANSITIONS = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: ['cancelled'],
  cancelled: ['new', 'confirmed'],
};
const FULFILLMENT_LABEL = { pickup: "Olib ketish", delivery: 'Yetkazib berish' };

// "Chek" tugmasi bosilganda shu massivdan (id bo'yicha) topib
// openCustomerReceiptModal()ga uzatiladi — alohida "chek" API'si shart emas,
// items allaqachon shu yerda (GET /admin/customer-orders) yuklangan.
let orders = [];
let couriers = []; // {id, username, full_name} — admin "kuryer biriktirish" dropdown uchun

// Holat tablari (2026-10-03) — yangi API so'rovisiz, mijoz tomonda filtrlaydi.
// "Ochiq" = yangi/tasdiqlangan (hali yakunlanmagan), "Yopilgan" = bajarilgan/
// bekor qilingan.
let currentFilter = 'all';
function matchesFilter(o, filter) {
  if (filter === 'open') return o.status === 'new' || o.status === 'confirmed';
  if (filter === 'closed') return o.status === 'completed' || o.status === 'cancelled';
  return true;
}

function renderOrders() {
  const box = document.getElementById('orderList');
  const rows = orders.filter((o) => matchesFilter(o, currentFilter));
  if (rows.length === 0) {
    box.innerHTML = '<p class="dim">Bu bo\'limda buyurtma topilmadi.</p>';
    return;
  }
  box.innerHTML = rows.map((o) => {
    // Yetkazib berish buyurtmasi "tayyor" (status='completed') bo'lganda ham
    // dastavkachi hali yetkazmagan bo'lishi mumkin — shunday holatda "Bajarildi"
    // deyish CHALG'ITADI (admin buyurtma bilan hech narsa qilish shart emas deb
    // o'ylashi mumkin). Shu sabab yetkazib berish buyurtmalari uchun asosiy
    // status-belgisi delivered_at'ga qarab aniqlashtiriladi (2026-09-08 bug fix).
    let badgeCls = STATUS_BADGE[o.status];
    let badgeLabel = STATUS_LABEL[o.status];
    if (o.status === 'completed' && o.fulfillment === 'delivery') {
      if (o.delivered_at) {
        badgeCls = 'green';
        badgeLabel = 'Yetkazildi';
      } else {
        badgeCls = 'gold';
        badgeLabel = 'Yetkazilishi kutilmoqda';
      }
    }
    return `
    <div class="card">
      <div class="card-row">
        <div>
          <div class="card-title">${escapeHtml(o.full_name)} <span class="badge badge-${badgeCls}">${badgeLabel}</span></div>
          <div class="card-sub">${FULFILLMENT_LABEL[o.fulfillment]} · ${fmtDateTime(o.created_at)}</div>
          <div class="card-sub"><a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a>${o.address ? ' · ' + escapeHtml(o.address) : ''}${o.location_lat != null && o.location_lng != null ? ` · <a href="https://www.google.com/maps?q=${o.location_lat},${o.location_lng}" target="_blank" rel="noopener">Xaritada ko'rish</a>` : ''}</div>
          ${o.fulfillment === 'delivery' && o.delivery_fee != null ? `<div class="card-sub">Yetkazish: ${o.delivery_distance_km} km — ${fmtMoney(o.delivery_fee)}</div>` : ''}
          ${o.note ? `<div class="card-sub">${escapeHtml(o.note)}</div>` : ''}
          ${o.status === 'cancelled' && o.cancel_reason ? `<div class="card-sub">Bekor qilish sababi: ${escapeHtml(o.cancel_reason)}</div>` : ''}
          ${o.fulfillment === 'delivery' ? `
          <div class="card-sub">
            Kuryer:
            <select style="width:auto; display:inline-block;" data-assign-courier="${o.id}">
              <option value="">— biriktirilmagan (hammaga ko'rinadi) —</option>
              ${couriers.map((c) => `<option value="${c.id}" ${o.assigned_courier_id === c.id ? 'selected' : ''}>${escapeHtml(c.full_name || c.username)}</option>`).join('')}
            </select>
          </div>` : ''}
        </div>
        <div class="card-title text-right">${fmtMoney(o.total_amount)}</div>
      </div>
      <div class="mt-8" style="border-top:1px dashed var(--border); padding-top:8px;">
        ${o.items.map((it) => `<div class="card-sub">${it.quantity} × ${escapeHtml(it.name_snapshot)} — ${fmtMoney(it.subtotal)}</div>`).join('')}
      </div>
      <div class="card-actions mt-8" style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn small" data-print="${o.id}">Chek</button>
        ${ALLOWED_STATUS_TRANSITIONS[o.status]?.includes('confirmed') ? `<button class="btn small" data-act="confirmed" data-id="${o.id}">Tasdiqlash</button>` : ''}
        ${ALLOWED_STATUS_TRANSITIONS[o.status]?.includes('completed') ? `<button class="btn small" data-act="completed" data-id="${o.id}">Bajarildi</button>` : ''}
        ${ALLOWED_STATUS_TRANSITIONS[o.status]?.includes('cancelled') ? `<button class="btn small" data-act="cancelled" data-id="${o.id}">Bekor qilish</button>` : ''}
        <button class="btn small danger" data-del="${o.id}">O'chirish</button>
      </div>
    </div>
  `;
  }).join('');
  box.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => {
    const order = orders.find((o) => o.id === Number(b.dataset.print));
    if (order) openCustomerReceiptModal(order);
  }));
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => setStatus(Number(b.dataset.id), b.dataset.act)));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => delOrder(Number(b.dataset.del))));
  box.querySelectorAll('[data-assign-courier]').forEach((sel) => sel.addEventListener('change', () => {
    assignCourier(Number(sel.dataset.assignCourier), sel.value ? Number(sel.value) : null);
  }));
}

async function assignCourier(orderId, courierId) {
  try {
    await api(`/admin/customer-orders/${orderId}/assign-courier`, { method: 'PUT', body: { courier_id: courierId } });
    toast(courierId ? 'Kuryer biriktirildi' : 'Biriktirish bekor qilindi');
    loadOrders();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadOrders() {
  const box = document.getElementById('orderList');
  try {
    orders = await api('/admin/customer-orders');
    renderOrders();
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

async function loadCouriers() {
  try {
    couriers = await api('/admin/customer-orders/couriers');
  } catch (err) {
    couriers = []; // kuryer ro'yxatini yuklab bo'lmasa ham, buyurtmalar ko'rinishda davom etsin
  }
}

async function setStatus(id, status) {
  let cancel_reason;
  if (status === 'cancelled') {
    cancel_reason = prompt('Bekor qilish sababini yozing:');
    if (cancel_reason === null) return; // admin bekor qildi — hech narsa o'zgarmaydi
  }
  try {
    await api(`/admin/customer-orders/${id}`, { method: 'PUT', body: { status, cancel_reason } });
    toast('Holat yangilandi');
    loadOrders();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function delOrder(id) {
  if (!confirm("Buyurtmani o'chirasizmi?")) return;
  try {
    await api(`/admin/customer-orders/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    loadOrders();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('customer-orders');
  document.querySelectorAll('#statusTabs .status-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#statusTabs .status-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderOrders();
    });
  });
  loadCouriers().then(loadOrders);
  // Ilgari faqat sahifa ochilganda bir marta yuklanardi — admin dastavka
  // holatini (masalan "Yetkazildi"ga o'zgarishini) ko'rish uchun qo'lda
  // yangilashga (F5) majbur edi. Oshpaz/dastavkachi ekranlari bilan bir xil
  // 15s avtomatik yangilanish qo'shildi (2026-09-08 bug fix).
  setInterval(loadOrders, 15000);
});
