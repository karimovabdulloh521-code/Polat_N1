// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).
async function loadTables() {
  const box = document.getElementById('tableOrders');
  try {
    const rows = await api('/chef/tables');
    const occupied = rows.filter((t) => t.occupied);
    if (occupied.length === 0) {
      box.innerHTML = '<p class="dim">Hozircha band stol yo\'q.</p>';
      return;
    }
    box.innerHTML = occupied.map((t) => `
      <div class="card">
        <div class="card-title">${escapeHtml(t.name)}</div>
        <div class="mt-8">
          ${(t.items && t.items.length)
            ? t.items.map((it) => `
              <div class="card-row mt-4">
                <div class="card-sub">
                  ${it.quantity} × ${escapeHtml(it.name_snapshot)} — ${fmtMoney(it.unit_price)}
                  ${it.note ? `<div class="badge debt" style="margin-top:4px;">📝 ${escapeHtml(it.note)}</div>` : ''}
                </div>
                <button class="btn small ${it.ready_at ? 'primary' : ''}" data-ready="${it.id}" data-val="${it.ready_at ? '0' : '1'}">${it.ready_at ? '✅ Tayyor' : '🏁 Tayyor'}</button>
              </div>
            `).join('')
            : '<div class="card-sub">Hali taom qo\'shilmagan</div>'}
        </div>
      </div>
    `).join('');
    box.querySelectorAll('[data-ready]').forEach((b) => b.addEventListener('click', () => toggleItemReady(Number(b.dataset.ready), b.dataset.val === '1')));
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

async function toggleItemReady(id, ready) {
  try {
    await api(`/chef/items/${id}/ready`, { method: 'PUT', body: { ready } });
    loadTables();
  } catch (err) {
    toast(err.message, 'error');
  }
}

const STATUS_LABEL = { new: 'Yangi', confirmed: 'Tasdiqlangan' };
// Oshpaz taomni tayyorlab bo'lgach kimga berilishini bilishi kerak — mijoz
// o'zi olib ketadimi (pickup) yoki dastavkachi keladimi (delivery). Ilgari bu
// yerda umuman ko'rsatilmagan edi (2026-09-08'da topilgan/tuzatilgan bug —
// oshpaz yetkazib berish buyurtmasini olib ketishdan farqlay olmasdi).
const FULFILLMENT_LABEL = { pickup: "Olib ketish", delivery: 'Yetkazib berish' };

async function loadOnlineOrders() {
  const box = document.getElementById('onlineOrders');
  try {
    const rows = await api('/chef/orders');
    if (rows.length === 0) {
      box.innerHTML = '<p class="dim">Hozircha onlayn buyurtma yo\'q.</p>';
      return;
    }
    box.innerHTML = rows.map((o) => `
      <div class="card">
        <div class="card-row">
          <div class="card-title">${escapeHtml(o.full_name)} <span class="badge ${o.fulfillment === 'delivery' ? 'debt' : 'ok'}">${FULFILLMENT_LABEL[o.fulfillment] || o.fulfillment}</span> <span class="badge ${o.status === 'confirmed' ? 'ok' : 'debt'}">${STATUS_LABEL[o.status] || o.status}</span></div>
        </div>
        <div class="card-sub">${fmtDateTime(o.created_at)}</div>
        <div class="mt-8">
          ${o.items.map((it) => `<div class="card-sub">${it.quantity} × ${escapeHtml(it.name_snapshot)}</div>`).join('')}
        </div>
        <div class="mt-8" style="display:flex; gap:6px; flex-wrap:wrap;">
          ${o.status !== 'confirmed' ? `<button class="btn small" data-act="confirmed" data-id="${o.id}">✅ Tasdiqlash</button>` : ''}
          <button class="btn small primary" data-act="completed" data-id="${o.id}">🏁 Tayyor</button>
        </div>
      </div>
    `).join('');
    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => setStatus(Number(b.dataset.id), b.dataset.act)));
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

async function setStatus(id, status) {
  try {
    await api(`/chef/orders/${id}/status`, { method: 'PUT', body: { status } });
    toast('Holat yangilandi');
    loadOnlineOrders();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function loadAll() {
  loadTables();
  loadOnlineOrders();
}

document.addEventListener('DOMContentLoaded', () => {
  loadAll();
  setInterval(loadAll, 15000); // 15 soniyada avtomatik yangilanadi
});
