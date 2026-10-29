// public/waiter/tables.js — "Stollar" sahifasi (2026-10-15 qayta dizayn):
// zal (table_zones) bo'yicha guruhlangan, bo'sh/band/hisob-so'ralgan holati
// bilan. Telefon/planshet/kompyuterda vizual farq butunlay tables.css'dagi
// media so'rovlari orqali — bu yerda faqat bitta DOM struktura to'ldiriladi.
// escapeHtml/fmtMoney/api/toast/customConfirm/reportPollResult — ../app.js'dan
// global (initLogout() ham app.js'ning o'zi DOMContentLoaded'da avtomatik
// chaqiradi, bu yerda qayta chaqirish shart emas).

const HALL_FILTER_KEY = 'polat_waiter_tables_hall';
const STATUS_FILTER_KEY = 'polat_waiter_tables_status';

let overview = null; // so'nggi /waiter/tables/overview javobi
let hallFilter = 'all'; // 'all' | 'none' | "<zone_id>"
let statusFilter = 'all'; // 'all' | 'busy' | 'free'
let selectedTableId = null;
let panelOrderView = null; // joriy ochiq panelning order-detail javobi (null = ochiq buyurtma yo'q)
let panelHallName = '';

function loadFilters() {
  try {
    const h = localStorage.getItem(HALL_FILTER_KEY);
    if (h) hallFilter = h;
  } catch (e) { /* jim */ }
  try {
    const s = localStorage.getItem(STATUS_FILTER_KEY);
    if (s === 'all' || s === 'busy' || s === 'free') statusFilter = s;
  } catch (e) { /* jim */ }
}

function saveHallFilter() {
  try { localStorage.setItem(HALL_FILTER_KEY, hallFilter); } catch (e) { /* jim */ }
}
function saveStatusFilter() {
  try { localStorage.setItem(STATUS_FILTER_KEY, statusFilter); } catch (e) { /* jim */ }
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function loadMe() {
  try {
    const me = await api('/me');
    const name = me.full_name || me.username;
    document.getElementById('tblWaiterName').textContent = name;
    document.getElementById('tblAvatar').textContent = initials(name);
  } catch (e) { /* jim — avatar/ism ko'rinmasa ham sahifa ishlayveradi */ }
}

function minutesSince(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

function statusLabel(status) {
  if (status === 'busy') return 'BAND';
  if (status === 'bill') return 'HISOB';
  return "BO'SH";
}

function hallKey(hall) {
  return hall.id === null ? 'none' : String(hall.id);
}

function hallMatchesFilter(hall) {
  return hallFilter === 'all' || hallKey(hall) === hallFilter;
}

function tableMatchesStatus(t) {
  if (statusFilter === 'all') return true;
  if (statusFilter === 'busy') return t.status === 'busy' || t.status === 'bill';
  return t.status === 'free';
}

function findTableAndHall(tableId) {
  if (!overview) return null;
  for (const hall of overview.halls) {
    const table = hall.tables.find((t) => t.id === tableId);
    if (table) return { table, hallName: hall.name };
  }
  return null;
}

// ---------------- Render: header statistikasi ----------------

function renderStats() {
  document.getElementById('tblStatBusy').textContent = overview.summary.busy;
  document.getElementById('tblStatFree').textContent = overview.summary.free;
  document.getElementById('tblStatOpenTotal').textContent = fmtMoney(overview.summary.openTotal);
  const readyBox = document.getElementById('tblStatReadyBox');
  if (overview.summary.readyItems > 0) {
    readyBox.style.display = '';
    document.getElementById('tblStatReady').textContent = overview.summary.readyItems;
  } else {
    readyBox.style.display = 'none';
  }
}

// ---------------- Render: zal tablari ----------------

function renderHallTabs() {
  const box = document.getElementById('tblHallTabs');
  const totalCount = overview.halls.reduce((s, h) => s + h.tables.length, 0);
  const parts = [
    `<button class="tbl-hall-tab ${hallFilter === 'all' ? 'is-active' : ''}" data-hall="all" role="tab" aria-selected="${hallFilter === 'all'}">Hammasi <span class="tbl-hall-tab-count">${overview.summary.busy}/${totalCount}</span></button>`,
  ];
  overview.halls.forEach((h) => {
    const key = hallKey(h);
    const busy = h.tables.filter((t) => t.status !== 'free').length;
    parts.push(
      `<button class="tbl-hall-tab ${hallFilter === key ? 'is-active' : ''}" data-hall="${key}" role="tab" aria-selected="${hallFilter === key}">${escapeHtml(h.name)} <span class="tbl-hall-tab-count">${busy}/${h.tables.length}</span></button>`
    );
  });
  box.innerHTML = parts.join('');
  box.querySelectorAll('[data-hall]').forEach((btn) => {
    btn.addEventListener('click', () => {
      hallFilter = btn.dataset.hall;
      saveHallFilter();
      renderHallTabs();
      renderMain();
    });
  });
}

function renderSegment() {
  document.querySelectorAll('#tblSegment .tbl-segment-btn').forEach((btn) => {
    const active = btn.dataset.status === statusFilter;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

// ---------------- Render: stol kartochkalari ----------------

function cardHtml(t) {
  if (t.status === 'free') {
    return `
      <button class="tbl-card is-free" data-table="${t.id}" data-status="free">
        <div class="tbl-card-top">
          <span class="tbl-card-number tbl-num">${escapeHtml(t.number)}</span>
        </div>
        <span class="tbl-pill is-free">BO'SH</span>
        <span class="tbl-card-open-action">+ Ochish</span>
      </button>`;
  }
  const statusClass = t.status === 'bill' ? 'is-bill' : 'is-busy';
  const guestsHtml = t.guests ? `<span class="tbl-card-guests">${escapeHtml(String(t.guests))} kishi</span>` : '';
  // Tayyor taom (readyCount) — eng muhim signal, nuqtasi miltillaydi.
  // Yuborilmagan taom (pendingCount) — kichikroq, kamroq urg'u bilan.
  const readyHtml = t.readyCount > 0 ? `<span class="tbl-ready-flag"><span class="tbl-ready-dot"></span>${t.readyCount} tayyor</span>` : '';
  const pendingHtml = t.pendingCount > 0 ? `<span class="tbl-pending-flag">${t.pendingCount} yuborilmagan</span>` : '';
  return `
    <button class="tbl-card ${statusClass}" data-table="${t.id}" data-status="${t.status}">
      <div class="tbl-card-top">
        <span class="tbl-card-number tbl-num">${escapeHtml(t.number)}</span>
        ${guestsHtml}
      </div>
      <span class="tbl-pill ${statusClass}">${statusLabel(t.status)}</span>
      ${readyHtml}
      <span class="tbl-card-total tbl-num">${fmtMoney(t.total)}</span>
      <span class="tbl-card-meta">${t.dishes} taom · ${t.minutes} daq ${pendingHtml}</span>
    </button>`;
}

function attachCardHandlers(container) {
  container.querySelectorAll('[data-table]').forEach((btn) => {
    btn.addEventListener('click', () => onCardClick(Number(btn.dataset.table), btn.dataset.status));
  });
}

function onCardClick(tableId, status) {
  if (status === 'free') {
    // Bo'sh stol uchun mavjud oqim — to'g'ridan-to'g'ri menyu/buyurtma sahifasi.
    window.location.href = `order.html?table=${tableId}`;
    return;
  }
  openPanel(tableId);
}

function renderMain() {
  const main = document.getElementById('tblMain');
  if (!overview || overview.halls.length === 0) {
    main.innerHTML = '<p class="tbl-empty">Hali stollar qo\'shilmagan. Admin bilan bog\'laning.</p>';
    return;
  }
  const visibleHalls = overview.halls.filter(hallMatchesFilter);
  if (visibleHalls.length === 0) {
    main.innerHTML = '<p class="tbl-empty">Bu zalda stol topilmadi.</p>';
    return;
  }
  main.innerHTML = visibleHalls
    .map((hall) => {
      const total = hall.tables.length;
      const busy = hall.tables.filter((t) => t.status !== 'free').length;
      const pct = total > 0 ? Math.round((busy / total) * 100) : 0;
      const filtered = hall.tables.filter(tableMatchesStatus);
      const body = filtered.length === 0
        ? '<p class="tbl-empty">Bu holatda stol yo\'q.</p>'
        : `<div class="tbl-grid">${filtered.map(cardHtml).join('')}</div>`;
      return `
        <section class="tbl-hall-section">
          <div class="tbl-hall-head">
            <span class="tbl-hall-name">${escapeHtml(hall.name)}</span>
            <span class="tbl-hall-count tbl-num">${busy} band · ${total - busy} bo'sh</span>
          </div>
          <div class="tbl-hall-progress"><div class="tbl-hall-progress-fill" style="width:${pct}%"></div></div>
          ${body}
        </section>`;
    })
    .join('');
  attachCardHandlers(main);
}

function renderAll() {
  renderStats();
  renderHallTabs();
  renderSegment();
  renderMain();
}

// ---------------- Buyurtma paneli ----------------

function showPanel() {
  document.getElementById('tblPanel').classList.add('is-open');
  document.getElementById('tblPanel').setAttribute('aria-hidden', 'false');
  document.getElementById('tblPanelBackdrop').classList.add('is-open');
  document.body.classList.add('tbl-panel-lock');
}

function closePanel() {
  selectedTableId = null;
  panelOrderView = null;
  document.getElementById('tblPanel').classList.remove('is-open');
  document.getElementById('tblPanel').setAttribute('aria-hidden', 'true');
  document.getElementById('tblPanelBackdrop').classList.remove('is-open');
  document.body.classList.remove('tbl-panel-lock');
  document.getElementById('tblPanelNumber').textContent = '—';
  document.getElementById('tblPanelMeta').textContent = '';
  document.getElementById('tblPanelBillRow').style.display = 'none';
  document.getElementById('tblPanelBody').innerHTML = '<p class="tbl-panel-empty">Stolni tanlang</p>';
  document.getElementById('tblPanelFooter').style.display = 'none';
}

function renderPanelShell(table) {
  document.getElementById('tblPanelNumber').textContent = table ? table.number : '—';
  document.getElementById('tblPanelMeta').textContent = 'Yuklanmoqda...';
  document.getElementById('tblPanelBillRow').style.display = 'none';
  document.getElementById('tblPanelBody').innerHTML = '<p class="tbl-panel-empty">Yuklanmoqda...</p>';
  document.getElementById('tblPanelFooter').style.display = 'none';
}

function renderPanelDetail() {
  const view = panelOrderView;
  const metaEl = document.getElementById('tblPanelMeta');
  const bodyEl = document.getElementById('tblPanelBody');
  const footerEl = document.getElementById('tblPanelFooter');
  const actionsEl = document.getElementById('tblPanelActions');
  const totalEl = document.getElementById('tblPanelTotal');
  const billRow = document.getElementById('tblPanelBillRow');
  const billBtn = document.getElementById('tblBillToggleBtn');

  if (!view) {
    metaEl.textContent = panelHallName;
    billRow.style.display = 'none';
    bodyEl.innerHTML = '<p class="tbl-panel-empty">Bu stolda ochiq buyurtma yo\'q.</p>';
    totalEl.textContent = fmtMoney(0);
    actionsEl.innerHTML = `<button class="tbl-btn is-primary" id="tblPanelOpenBtn">Buyurtma ochish</button>`;
    footerEl.style.display = '';
    document.getElementById('tblPanelOpenBtn').addEventListener('click', () => {
      window.location.href = `order.html?table=${selectedTableId}`;
    });
    return;
  }

  const minutes = minutesSince(view.order.opened_at);
  const metaParts = [panelHallName, `${minutes} daq`, view.order.opened_by_name].filter(Boolean);
  metaEl.textContent = metaParts.join(' · ');

  billRow.style.display = '';
  const billOn = !!view.order.bill_requested;
  billBtn.classList.toggle('is-on', billOn);
  billBtn.textContent = billOn ? "🧾 Hisob so'ralgan — bekor qil" : "🧾 Hisob so'ra";
  billBtn.onclick = () => toggleBillRequest(!billOn);

  if (view.items.length === 0) {
    bodyEl.innerHTML = '<p class="tbl-panel-empty">Hali taom qo\'shilmagan.</p>';
  } else {
    bodyEl.innerHTML = view.items
      .map(
        (it) => `
      <div class="tbl-panel-line">
        <span class="tbl-line-name">${escapeHtml(it.name_snapshot)}</span>
        <span class="tbl-line-qty tbl-num">× ${it.quantity}</span>
        <span class="tbl-line-sub tbl-num">${fmtMoney(it.subtotal)}</span>
      </div>`
      )
      .join('');
  }
  totalEl.textContent = fmtMoney(view.total);

  actionsEl.innerHTML = `
    <button class="tbl-btn" id="tblPanelAddBtn">Taom qo'shish</button>
    <button class="tbl-btn is-primary" id="tblPanelCloseBtn">Hisobni yopish</button>
  `;
  footerEl.style.display = '';
  document.getElementById('tblPanelAddBtn').addEventListener('click', () => {
    window.location.href = `order.html?table=${selectedTableId}`;
  });
  document.getElementById('tblPanelCloseBtn').addEventListener('click', onCloseTableClick);
}

async function openPanel(tableId) {
  selectedTableId = tableId;
  const found = findTableAndHall(tableId);
  panelHallName = found ? found.hallName : '';
  renderPanelShell(found ? found.table : null);
  showPanel();
  try {
    panelOrderView = await api(`/waiter/tables/${tableId}/order`);
    if (selectedTableId === tableId) renderPanelDetail();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function refreshPanelIfOpen() {
  if (selectedTableId === null) return;
  const found = findTableAndHall(selectedTableId);
  if (!found) {
    // Stol endi ro'yxatda yo'q (masalan admin o'chirdi) — panelni yopamiz.
    closePanel();
    return;
  }
  panelHallName = found.hallName;
  if (found.table.status === 'free') {
    // Boshqa afitsiant/kassir allaqachon hisob-kitob qilib yopgan.
    panelOrderView = null;
    renderPanelDetail();
    document.getElementById('tblPanelNumber').textContent = found.table.number;
    return;
  }
  try {
    const view = await api(`/waiter/tables/${selectedTableId}/order`);
    panelOrderView = view;
    renderPanelDetail();
  } catch (e) { /* jim — keyingi 15s pollda qayta uriniladi */ }
}

async function toggleBillRequest(next) {
  if (!selectedTableId) return;
  try {
    panelOrderView = await api(`/waiter/tables/${selectedTableId}/bill-request`, {
      method: 'PATCH',
      body: { requested: next },
    });
    renderPanelDetail();
    toast(next ? "Hisob so'raldi deb belgilandi" : 'Bekor qilindi');
    loadOverview();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// "Hisob-kitob → kassaga" (2026-10-15) — eski /close o'rniga /request-bill
// chaqiriladi: hisob kassaga yuboriladi, stol darhol bo'shaydi, chekni
// kassir o'zi chop etadi. Yuborilmagan (hali oshxonaga jo'natilmagan) taom
// bo'lsa server 409 qaytaradi — shunda qo'shimcha tasdiq so'rab, bekor
// qilib davom etiladi.
async function requestBillFlow(tableId) {
  try {
    return await api(`/waiter/tables/${tableId}/request-bill`, { method: 'POST', body: { discardPending: false } });
  } catch (err) {
    if (/Yuborilmagan taomlar bor/.test(err.message)) {
      const ok = await customConfirm(
        'Hali oshxonaga yuborilmagan taomlar bor. Davom etilsa ular bekor qilinadi va hisobga kirmaydi. Davom etasizmi?'
      );
      if (!ok) return null;
      return api(`/waiter/tables/${tableId}/request-bill`, { method: 'POST', body: { discardPending: true } });
    }
    throw err;
  }
}

async function onCloseTableClick() {
  const ok = await customConfirm("Stol hisobini kassaga yuborib, stolni bo'shatasizmi?");
  if (!ok) return;
  try {
    const result = await requestBillFlow(selectedTableId);
    if (!result) return;
    toast("Hisob kassaga yuborildi — stol bo'shadi.");
    closePanel();
    loadOverview();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------- Yuklash / avtomatik yangilanish ----------------

async function loadOverview() {
  try {
    overview = await api('/waiter/tables/overview');
    renderAll();
    reportPollResult('tblOverview', true);
    refreshPanelIfOpen();
  } catch (err) {
    reportPollResult('tblOverview', false, 'stollar');
    if (!overview) {
      document.getElementById('tblMain').innerHTML = `<p class="tbl-empty">${escapeHtml(err.message)}</p>`;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadFilters();
  loadMe();
  loadOverview();

  document.querySelectorAll('#tblSegment [data-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      statusFilter = btn.dataset.status;
      saveStatusFilter();
      renderSegment();
      renderMain();
    });
  });

  document.getElementById('tblPanelClose').addEventListener('click', closePanel);
  document.getElementById('tblPanelBackdrop').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedTableId !== null) closePanel();
  });

  // Boshqa afitsiant/kassir shu stolga tegsa ham ko'rinishi uchun — sahifa
  // ko'rinmay turganda (boshqa tab/ilova) so'rov yuborilmaydi.
  setInterval(() => {
    if (document.hidden) return;
    loadOverview();
  }, 15000);
});
