// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).
const STATUS_LABEL = { new: 'Yangi', confirmed: 'Tasdiqlangan', cancelled: 'Bekor qilingan' };
const STATUS_BADGE = { new: 'gold', confirmed: 'green', cancelled: 'dim' };

// Holat tablari (2026-10-03) — yangi API so'rovisiz, allaqachon yuklangan
// ro'yxatni mijoz tomonda filtrlaydi. "Ochiq" = hali bekor qilinmagan
// (yangi/tasdiqlangan), "Yopilgan" = bekor qilingan.
let reservations = [];
let currentFilter = 'all';

function matchesFilter(r, filter) {
  if (filter === 'open') return r.status !== 'cancelled';
  if (filter === 'closed') return r.status === 'cancelled';
  return true;
}

function renderReservations() {
  const box = document.getElementById('reservationList');
  const rows = reservations.filter((r) => matchesFilter(r, currentFilter));
  if (rows.length === 0) {
    box.innerHTML = '<p class="dim">Bu bo\'limda bron topilmadi.</p>';
    return;
  }
  box.innerHTML = rows.map((r) => `
    <div class="card">
      <div class="card-row">
        <div>
          <div class="card-title">${escapeHtml(r.full_name)} <span class="badge badge-${STATUS_BADGE[r.status]}">${STATUS_LABEL[r.status]}</span></div>
          <div class="card-sub">${escapeHtml(r.res_date)} · ${escapeHtml(r.res_time)} · ${r.party_size} kishi</div>
          <div class="card-sub"><a href="tel:${escapeHtml(r.phone)}">${escapeHtml(r.phone)}</a>${r.note ? ' · ' + escapeHtml(r.note) : ''}</div>
        </div>
      </div>
      <div class="card-actions mt-8" style="display:flex; gap:6px; flex-wrap:wrap;">
        ${r.status !== 'confirmed' ? `<button class="btn small" data-act="confirmed" data-id="${r.id}">Tasdiqlash</button>` : ''}
        ${r.status !== 'cancelled' ? `<button class="btn small" data-act="cancelled" data-id="${r.id}">Bekor qilish</button>` : ''}
        <button class="btn small danger" data-del="${r.id}">O'chirish</button>
      </div>
    </div>
  `).join('');
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => setStatus(Number(b.dataset.id), b.dataset.act)));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => delReservation(Number(b.dataset.del))));
}

async function loadReservations() {
  const box = document.getElementById('reservationList');
  try {
    reservations = await api('/admin/reservations');
    renderReservations();
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

async function setStatus(id, status) {
  try {
    await api(`/admin/reservations/${id}`, { method: 'PUT', body: { status } });
    toast('Holat yangilandi');
    loadReservations();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function delReservation(id) {
  if (!confirm("Bronni o'chirasizmi?")) return;
  try {
    await api(`/admin/reservations/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    loadReservations();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('reservations');
  document.querySelectorAll('#statusTabs .status-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#statusTabs .status-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderReservations();
    });
  });
  loadReservations();
});
