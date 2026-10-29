// "Bosh sahifa" (admin dashboard) — 2026-10-03 mobil+desktop qayta dizayn.
// Faqat ko'rinish: ma'lumot xuddi avvalgidek /admin/reports/summary,
// /waiter/tables va /admin/reservations'dan olinadi, backend/baza
// o'zgarmagan. escapeHtml()/api()/fmtMoney()/toast() — ../app.js'dan global,
// renderShellDate()/initLayout() — layout.js'dan global.
//
// Har bir ko'rsatkich (tushum/xarajat/sof foyda/yopilgan/ochiq buyurtma/bron)
// mobil VA desktop qatlamida ALOHIDA DOM elementida (bir xil .js-stat-*
// klassi bilan) ko'rinadi — shu sabab setAllText() bitta qiymatni BARCHA mos
// elementlarga (hozir ko'rinmayotganiga ham) yozadi.
function setAllText(selector, value) {
  document.querySelectorAll(selector).forEach((el) => { el.textContent = value; });
}

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString('uz-UZ');
}

async function loadSummary() {
  try {
    const today = todayStr();
    const s = await api(`/admin/reports/summary?from=${today}&to=${today}`);
    setAllText('.js-stat-revenue', fmtNum(s.revenue));
    setAllText('.js-stat-expenses', fmtMoney(s.expenses_total));
    setAllText('.js-stat-net', fmtMoney(s.net));
    setAllText('.js-stat-closed', s.orders_count);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Kassaga yuborilgan, lekin hali to'lanmagan hisoblar (2026-10-24, "Moliyaviy
// aniqlik"). Bu summa "Bugungi tushum"ga kiradi, lekin kassa smenasida
// ko'rinmaydi — admin buni darhol payqashi uchun ogohlantirish.
async function loadUnpaid() {
  const box = document.getElementById('unpaidAlert');
  if (!box) return;
  try {
    const u = await api('/admin/reports/unpaid');
    if (!u.count) { box.classList.add('hidden'); return; }
    const list = u.items.slice(0, 5).map((it) => `
      <li><b>${escapeHtml(it.table_name)}</b> — ${fmtMoney(it.total_amount)}
        <span class="unpaid-alert-meta">${escapeHtml(fmtDateTimeSafe(it.closed_at))}${it.bill_requested ? '' : ' · eski usulda yopilgan'}</span></li>
    `).join('');
    box.innerHTML = `
      <div class="unpaid-alert-title">⚠️ To'lanmagan hisoblar: ${u.count} ta — ${fmtMoney(u.amount)}</div>
      <p class="unpaid-alert-sub">Bu hisoblar kassaga yuborilgan, lekin kassir to'lov turini (naqd/karta) hali kiritmagan. Ular tushumga kiradi, lekin kassa smenasida ko'rinmaydi.</p>
      <ul class="unpaid-alert-list">${list}</ul>
      ${u.count > 5 ? `<p class="unpaid-alert-sub">…va yana ${u.count - 5} ta</p>` : ''}
    `;
    box.classList.remove('hidden');
  } catch (err) {
    box.classList.add('hidden');
  }
}

function fmtDateTimeSafe(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderEmptyTables(box) {
  box.innerHTML = `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1.2"/><path d="M5 12v7"/><path d="M19 12v7"/></svg>
      <div class="empty-state-title">Hozir band stol yo'q</div>
      <div class="empty-state-sub">Yangi buyurtma ochilganda stollar shu yerda ko'rinadi.</div>
    </div>
  `;
}

async function loadOccupied() {
  const boxes = document.querySelectorAll('.js-occupied-tables');
  try {
    const tables = await api('/waiter/tables');
    const occupied = tables.filter((t) => t.occupied);
    setAllText('.js-stat-open', occupied.length);
    boxes.forEach((box) => {
      if (occupied.length === 0) {
        renderEmptyTables(box);
        return;
      }
      box.innerHTML = occupied.map((t) => `
        <div class="card card-row">
          <div>
            <div class="card-title">${escapeHtml(t.name)}</div>
            <div class="card-sub">${t.item_count} taom</div>
          </div>
          <div class="card-title">${fmtMoney(t.total)}</div>
        </div>
      `).join('');
    });
  } catch (err) {
    setAllText('.js-stat-open', '—');
    boxes.forEach((box) => { box.innerHTML = `<p class="helper-text">${escapeHtml(err.message)}</p>`; });
  }
}

// Desktop'dagi "Yaqin bronlar" ustuni — xuddi shu /admin/reservations
// chaqiruvidan (yangi API yo'q), bugungi bekor qilinmagan bronlarni
// vaqt bo'yicha saralab ko'rsatadi.
async function loadTodayReservations() {
  const upcomingBoxes = document.querySelectorAll('.js-upcoming-reservations');
  try {
    const list = await api('/admin/reservations');
    const today = todayStr();
    const todays = list.filter((r) => r.res_date === today && r.status !== 'cancelled');
    setAllText('.js-stat-reservations', todays.length);

    const upcoming = todays.slice().sort((a, b) => a.res_time.localeCompare(b.res_time));
    upcomingBoxes.forEach((box) => {
      if (upcoming.length === 0) {
        box.innerHTML = '<p class="helper-text">Bugun bron yo\'q.</p>';
        return;
      }
      box.innerHTML = upcoming.map((r) => `
        <div class="card card-row">
          <div>
            <div class="card-title">${escapeHtml(r.full_name)}</div>
            <div class="card-sub">${escapeHtml(r.res_time)} · ${r.party_size} kishi</div>
          </div>
        </div>
      `).join('');
    });
  } catch (err) {
    setAllText('.js-stat-reservations', '—');
    upcomingBoxes.forEach((box) => { box.innerHTML = `<p class="helper-text">${escapeHtml(err.message)}</p>`; });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('index');
  loadSummary();
  loadUnpaid();
  loadOccupied();
  loadTodayReservations();
});
