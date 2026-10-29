// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).
const STATUS_LABEL = { new: 'Yangi', confirmed: 'Tasdiqlangan', completed: 'Tayyor' };
const STATUS_BADGE = { new: 'debt', confirmed: 'ok', completed: 'ok' };

async function loadOrders() {
  const box = document.getElementById('deliveryOrders');
  try {
    const rows = await api('/courier/orders');
    if (rows.length === 0) {
      box.innerHTML = '<p class="dim">Hozircha yetkazib berish buyurtmasi yo\'q.</p>';
      return;
    }
    box.innerHTML = rows.map((o) => {
      const delivered = !!o.delivered_at;
      const mapsLink = (o.location_lat != null && o.location_lng != null)
        ? `<a class="btn small light block" href="https://www.google.com/maps?q=${o.location_lat},${o.location_lng}" target="_blank" rel="noopener">🗺 Xaritada ko'rish</a>`
        : '';
      let actionHtml;
      if (delivered) {
        actionHtml = `<span class="badge ok">✅ Yetkazildi &middot; ${fmtDateTime(o.delivered_at)}</span>`;
      } else if (o.status === 'completed') {
        actionHtml = `<button class="btn small primary block" data-deliver="${o.id}">🚚 Yetkazildi</button>`;
      } else {
        actionHtml = '<span class="dim">Oshxonada tayyorlanmoqda...</span>';
      }
      // Xaritada ko'rish + Yetkazildi — pastda, yonma-yon 2 ustunli qator
      // (lokatsiya bo'lmasa faqat amal ustuni to'liq kenglikda ko'rinadi).
      const bottomRow = mapsLink
        ? `<div class="mt-8" style="display:flex; gap:8px;">
             <div style="flex:1;">${mapsLink}</div>
             <div style="flex:1; display:flex; align-items:center; justify-content:center;">${actionHtml}</div>
           </div>`
        : `<div class="mt-8">${actionHtml}</div>`;
      return `
      <div class="card"${delivered ? ' style="opacity:0.6;"' : ''}>
        <div class="card-row">
          <div>
            <div class="card-title">${escapeHtml(o.full_name)} <span class="badge ${STATUS_BADGE[o.status] || 'ok'}">${STATUS_LABEL[o.status] || o.status}</span></div>
            <div class="card-sub">${fmtDateTime(o.created_at)}</div>
          </div>
          <div class="card-title text-right">${fmtMoney(o.total_amount)}</div>
        </div>
        <div class="mt-8">
          <div class="card-sub"><a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a></div>
          ${o.address ? `<div class="card-sub">${escapeHtml(o.address)}</div>` : ''}
          ${o.delivery_fee != null ? `<div class="card-sub">Yetkazish: ${o.delivery_distance_km} km — ${fmtMoney(o.delivery_fee)}</div>` : ''}
          ${o.note ? `<div class="card-sub">📝 ${escapeHtml(o.note)}</div>` : ''}
        </div>
        <div class="mt-8" style="border-top:1px dashed var(--border); padding-top:8px;">
          ${o.items.map((it) => `<div class="card-sub">${it.quantity} × ${escapeHtml(it.name_snapshot)}</div>`).join('')}
        </div>
        ${bottomRow}
      </div>
    `;
    }).join('');
    box.querySelectorAll('[data-deliver]').forEach((b) => b.addEventListener('click', () => markDelivered(Number(b.dataset.deliver))));
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

async function markDelivered(id) {
  try {
    await api(`/courier/orders/${id}/deliver`, { method: 'PUT' });
    toast('Yetkazildi deb belgilandi');
    loadOrders();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadOrders();
  setInterval(loadOrders, 15000); // 15 soniyada avtomatik yangilanadi
});
