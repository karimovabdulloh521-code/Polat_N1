// Kassir uchun mijoz (onlayn) buyurtmalari — FAQAT KO'RISH, hech qanday
// amal tugmasi yo'q (holat/bekor qilish — admin huquqida). 2026-10-18 (3).
const STATUS_LABEL = { new: 'Yangi', confirmed: 'Tasdiqlangan', completed: 'Tayyor' };
const STATUS_BADGE = { new: 'debt', confirmed: 'ok', completed: 'ok' };
const FULFILLMENT_LABEL = { pickup: 'Olib ketish', delivery: 'Yetkazib berish' };

async function loadCustomerOrders() {
  const box = document.getElementById('customerOrders');
  try {
    const rows = await api('/kassir/customer-orders');
    if (rows.length === 0) {
      box.innerHTML = '<p class="dim">Hozircha mijoz buyurtmasi yo\'q.</p>';
      return;
    }
    box.innerHTML = rows.map((o) => {
      const delivered = o.fulfillment === 'delivery' && !!o.delivered_at;
      let stateHtml;
      if (delivered) {
        stateHtml = `<span class="badge ok">✅ Yetkazildi</span>`;
      } else {
        stateHtml = `<span class="badge ${STATUS_BADGE[o.status] || 'ok'}">${STATUS_LABEL[o.status] || o.status}</span>`;
      }
      return `
      <div class="card"${delivered || o.status === 'completed' ? ' style="opacity:0.75;"' : ''}>
        <div class="card-row">
          <div>
            <div class="card-title">${escapeHtml(o.full_name)}
              <span class="badge">${FULFILLMENT_LABEL[o.fulfillment] || o.fulfillment}</span>
              ${stateHtml}
            </div>
            <div class="card-sub">${fmtDateTime(o.created_at)}</div>
          </div>
          <div class="card-title text-right">${fmtMoney(o.total_amount)}</div>
        </div>
        <div class="mt-8">
          <div class="card-sub"><a href="tel:${escapeHtml(o.phone)}">${escapeHtml(o.phone)}</a></div>
          ${o.address ? `<div class="card-sub">${escapeHtml(o.address)}</div>` : ''}
          ${o.fulfillment === 'delivery' && o.delivery_fee != null ? `<div class="card-sub">Yetkazish: ${o.delivery_distance_km} km — ${fmtMoney(o.delivery_fee)}</div>` : ''}
          ${o.note ? `<div class="card-sub">📝 ${escapeHtml(o.note)}</div>` : ''}
        </div>
        <div class="mt-8" style="border-top:1px dashed var(--border); padding-top:8px;">
          ${o.items.map((it) => `<div class="card-sub">${it.quantity} × ${escapeHtml(it.name_snapshot)}</div>`).join('')}
        </div>
      </div>
    `;
    }).join('');
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadCustomerOrders();
  setInterval(loadCustomerOrders, 15000); // 15 soniyada avtomatik yangilanadi
});
