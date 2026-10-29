let inventoryItems = [];
let menuCategories = []; // "Menyuda ko'rsatish" select'i uchun (Menyu bo'limidagi kategoriyalar)
let inventoryCategories = []; // Ombor sahifasidagi turkumlar (ustunlarga ajratish uchun, menuCategories'dan mustaqil)
let inventoryStats = null;
let invSearchTerm = ''; // qidiruv maydoniga kiritilgan matn (kichik harfga keltirilgan)
let invCategoryFilter = 'all'; // 'all' yoki inventory_categories.id (Number)
let editingInvId = null;
let adjustingInvId = null;
let currentInvImageUrl = null; // tanlangan/yuklangan rasm URL'i (item modal ochiq bo'lganda)

// ---------------- Ikonkalar (inline SVG, emoji ishlatilmaydi) ----------------
const OV_ICON_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>';
const OV_ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M4 3h16"/></svg>';
const OV_ICON_HISTORY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 3h6"/></svg>';
const OV_ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>';
const OV_ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';
const OV_ICON_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6"/><path d="M11 6l1-1a3.5 3.5 0 1 1 5 5l-1 1"/><path d="M13 18l-1 1a3.5 3.5 0 1 1-5-5l1-1"/></svg>';
const OV_ICON_KEBAB = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
// Inventarizatsiya (qo'lda sanash) — Ombor auditi (2026-10-10).
const OV_ICON_STOCKTAKE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

// escapeHtml() — ../app.js'dan global (2026-09-09'da 15 xil fayldagi nusxa
// birlashtirildi). fmtMoney() ham ../app.js'da bor, lekin u "X so'm" (bitta
// matn) qaytaradi — bu sahifada raqam va "so'm" alohida chiqishi kerak
// (spetsifikatsiya), shu sabab mustaqil fmtNum() yozildi.
function fmtNum(n) {
  const v = Math.round(Number(n) || 0);
  const neg = v < 0;
  const grouped = Math.abs(v).toLocaleString('en-US').replace(/,/g, ' ');
  return (neg ? '-' : '') + grouped;
}

async function loadAll() {
  try {
    [inventoryItems, menuCategories, inventoryCategories, inventoryStats] = await Promise.all([
      api('/admin/inventory/items'),
      api('/admin/menu/categories').catch(() => []),
      api('/admin/inventory/categories').catch(() => []),
      api('/admin/inventory/stats').catch(() => null),
    ]);
    renderStats();
    renderChips();
    render();
  } catch (err) {
    document.getElementById('ovListMobile').innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
    document.getElementById('ovListDesktop').innerHTML = '';
  }
}

// ---------------- Ko'rsatkichlar (4 kartochka, server/services/inventory.js'dagi
// getStats() — bitta SQL agregatsiya so'rovidan) ----------------

function renderStats() {
  const box = document.getElementById('ovStats');
  const s = inventoryStats || { item_count: 0, category_count: 0, total_value: 0, expected_profit: 0, low_stock_count: 0 };
  const profit = Number(s.expected_profit) || 0;
  const profitSign = profit >= 0 ? '+' : '';
  const profitCls = profit >= 0 ? 'profit' : 'danger';
  box.innerHTML = `
    <div class="ov-stat ov-stat-desktop">
      <div class="ov-stat-label">Mahsulotlar</div>
      <div class="ov-stat-value">${s.item_count}<span class="ov-stat-unit">ta, ${s.category_count} turkumda</span></div>
    </div>
    <div class="ov-stat">
      <div class="ov-stat-label">Ombor qiymati (tan narxda)</div>
      <div class="ov-stat-value">${fmtNum(s.total_value)}<span class="ov-stat-unit">so'm</span></div>
    </div>
    <div class="ov-stat">
      <div class="ov-stat-label">Sotilsa kutilayotgan foyda</div>
      <div class="ov-stat-value ${profitCls}">${profitSign}${fmtNum(profit)}<span class="ov-stat-unit">so'm</span></div>
    </div>
    <div class="ov-stat ov-stat-desktop">
      <div class="ov-stat-label">Tugash arafasida</div>
      <div class="ov-stat-value">${s.low_stock_count}<span class="ov-stat-unit">ta</span></div>
    </div>
  `;
}

// ---------------- Turkum chiplari ----------------

function renderChips() {
  const box = document.getElementById('ovChips');
  const counts = {};
  inventoryItems.forEach((it) => { counts[it.category_id || 0] = (counts[it.category_id || 0] || 0) + 1; });
  const chips = [`<button type="button" class="ov-chip" data-chip="all" aria-pressed="${invCategoryFilter === 'all'}">Barchasi <span class="ov-chip-badge">${inventoryItems.length}</span></button>`]
    .concat(inventoryCategories.map((c) => `<button type="button" class="ov-chip" data-chip="${c.id}" aria-pressed="${String(invCategoryFilter) === String(c.id)}">${escapeHtml(c.name)} <span class="ov-chip-badge">${counts[c.id] || 0}</span></button>`));
  box.innerHTML = chips.join('');
  box.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    const val = b.dataset.chip;
    invCategoryFilter = val === 'all' ? 'all' : Number(val);
    renderChips();
    render();
    syncOvUrl();
  }));
}

// ---------------- URL bilan filtr holatini saqlash (?turkum=&q=) ----------------

function readFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const turkum = params.get('turkum');
  invCategoryFilter = turkum ? Number(turkum) : 'all';
  const q = params.get('q') || '';
  invSearchTerm = q.trim().toLowerCase();
  document.getElementById('ovSearchInput').value = q;
}

function syncOvUrl() {
  const params = new URLSearchParams();
  if (invCategoryFilter !== 'all') params.set('turkum', String(invCategoryFilter));
  if (invSearchTerm) params.set('q', invSearchTerm);
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

// ---------------- Mahsulot holati (Yetarli/Kam/Tugagan) ----------------

function ovStatus(item) {
  if (item.quantity <= 0) return 'out';
  if (item.low_stock_threshold > 0 && item.quantity <= item.low_stock_threshold) return 'low';
  return 'ok';
}
const OV_STATUS_LABEL = { ok: 'Yetarli', low: 'Kam', out: 'Tugagan' };

function ovPillHtml(status) {
  return `<span class="ov-pill ${status}"><span class="dot"></span>${OV_STATUS_LABEL[status]}</span>`;
}

function ovThumbHtml(item, cls) {
  if (item.image_url) {
    return `<img src="${escapeHtml(item.image_url)}" class="ov-thumb ${cls}" alt="">`;
  }
  const letter = (item.name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="ov-thumb ${cls}">${escapeHtml(letter)}</div>`;
}

function ovLinkedSubHtml(item) {
  const text = item.linked_menu_items ? `Menyu: ${item.linked_menu_items}` : "Menyuga bog'lanmagan";
  return `<div class="ov-link-sub">${OV_ICON_LINK}<span>${escapeHtml(text)}</span></div>`;
}

// ---------------- Filtrlash + guruhlash ----------------

function matchesOvSearch(item) {
  if (!invSearchTerm) return true;
  return item.name.toLowerCase().includes(invSearchTerm)
    || (item.volume && item.volume.toLowerCase().includes(invSearchTerm));
}

// Mahsulotlarni turkumga (category_id) qarab guruhlaydi. Turkum umuman
// yaratilmagan bo'lsa — guruhlarsiz, bitta tekis ro'yxat qaytaradi (eski
// xulq-atvor bilan bir xil). invCategoryFilter bitta turkumga qulflangan
// bo'lsa — faqat shu turkum (bitta guruh) qaytadi.
function buildOvGroups(visibleItems) {
  if (inventoryCategories.length === 0) {
    return [{ cat: null, items: visibleItems }];
  }
  if (invCategoryFilter !== 'all') {
    const cat = inventoryCategories.find((c) => c.id === invCategoryFilter) || null;
    return [{ cat, items: visibleItems.filter((it) => it.category_id === invCategoryFilter) }];
  }
  const grouped = inventoryCategories.map((cat) => ({ cat, items: visibleItems.filter((it) => it.category_id === cat.id) }));
  const uncategorized = visibleItems.filter((it) => !it.category_id);
  return grouped.concat(uncategorized.length ? [{ cat: null, items: uncategorized }] : []);
}

function render() {
  const desktopBox = document.getElementById('ovListDesktop');
  const mobileBox = document.getElementById('ovListMobile');

  if (inventoryItems.length === 0) {
    const msg = '<div class="ov-empty">Hali ombor mahsuloti yo\'q. Yuqoridagi tugma bilan qo\'shing (masalan: Suv, Salfetka).</div>';
    desktopBox.innerHTML = msg;
    mobileBox.innerHTML = msg;
    return;
  }

  const visibleItems = inventoryItems.filter(matchesOvSearch);
  if (visibleItems.length === 0) {
    const msg = '<div class="ov-empty">Bu so\'rov bo\'yicha mahsulot topilmadi.</div>';
    desktopBox.innerHTML = msg;
    mobileBox.innerHTML = msg;
    return;
  }

  const groups = buildOvGroups(visibleItems).filter((g) => g.items.length > 0);
  renderOvDesktop(desktopBox, groups);
  renderOvMobile(mobileBox, groups);
  wireOvActions(desktopBox);
  wireOvActions(mobileBox);
}

function ovGroupTotalQty(items) {
  return items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
}

// ---------------- Desktop jadval ----------------

function renderOvDesktop(box, groups) {
  const rows = groups.map(({ cat, items }) => `
    <div class="ov-group">
      <div class="ov-cat-head">
        <div class="ov-cat-head-left">
          <p class="ov-cat-name">${cat ? escapeHtml(cat.name) : "Turkumsiz"}</p>
          <span class="ov-cat-count">${items.length} ta mahsulot</span>
        </div>
        <span class="ov-cat-total">Jami qoldiq: ${fmtNum(ovGroupTotalQty(items))} dona</span>
      </div>
      ${items.map(ovDesktopRowHtml).join('')}
    </div>
  `).join('');

  box.innerHTML = `
    <div class="ov-table-scroll">
      <div class="ov-table">
        <div class="ov-grid-row ov-thead">
          <div>Mahsulot</div>
          <div>Qoldiq</div>
          <div>Tan narxi</div>
          <div>Sotuv narxi</div>
          <div>Foyda / dona</div>
          <div>Amallar</div>
        </div>
        ${rows}
      </div>
    </div>
  `;
}

function ovDesktopRowHtml(item) {
  const status = ovStatus(item);
  const profit = Number(item.sale_price) - Number(item.cost_price);
  const margin = item.sale_price > 0 ? Math.round((profit / item.sale_price) * 100) : 0;
  const profitCls = profit < 0 ? 'danger' : '';
  const profitSign = profit >= 0 ? '+' : '';
  return `
    <div class="ov-grid-row ov-row">
      <div class="ov-cell-name">
        ${ovThumbHtml(item, '')}
        <div class="ov-cell-name-text">
          <div class="ov-name">${escapeHtml(item.name)}${item.volume ? ` <span style="color:var(--muted); font-weight:400;">(${escapeHtml(item.volume)})</span>` : ''}</div>
          ${ovLinkedSubHtml(item)}
        </div>
      </div>
      <div class="ov-cell-qty">
        <div><span class="ov-qty-num">${fmtNum(item.quantity)}</span><span class="ov-qty-unit">${escapeHtml(item.unit)}</span></div>
        ${ovPillHtml(status)}
      </div>
      <div class="ov-cell-money"><span class="ov-money-num">${fmtNum(item.cost_price)}</span><span class="ov-money-unit">so'm</span></div>
      <div class="ov-cell-money"><span class="ov-money-num">${fmtNum(item.sale_price)}</span><span class="ov-money-unit">so'm</span></div>
      <div class="ov-cell-profit"><span class="ov-profit-num ${profitCls}">${profitSign}${fmtNum(profit)}</span><span class="ov-margin">${margin}% marja</span></div>
      <div class="ov-cell-actions">
        <button class="ov-act-btn ov-act-in" data-in="${item.id}" type="button" aria-label="Kirim" title="Kirim">${OV_ICON_IN}Kirim</button>
        <button class="ov-act-btn ov-act-out" data-out="${item.id}" type="button" aria-label="Chiqim" title="Chiqim">${OV_ICON_OUT}Chiqim</button>
        <button class="ov-icon-btn" data-stocktake="${item.id}" type="button" aria-label="Inventarizatsiya" title="Inventarizatsiya">${OV_ICON_STOCKTAKE}</button>
        <button class="ov-icon-btn" data-history="${item.id}" type="button" aria-label="Tarix" title="Tarix">${OV_ICON_HISTORY}</button>
        <button class="ov-icon-btn" data-edit="${item.id}" type="button" aria-label="Tahrirlash" title="Tahrirlash">${OV_ICON_EDIT}</button>
        <button class="ov-icon-btn danger" data-del="${item.id}" type="button" aria-label="O'chirish" title="O'chirish">${OV_ICON_TRASH}</button>
      </div>
    </div>
  `;
}

// ---------------- Mobil kartochkalar ----------------

function renderOvMobile(box, groups) {
  box.innerHTML = groups.map(({ cat, items }) => `
    <div class="ov-mgroup">
      <div class="ov-mgroup-head">
        <p class="ov-mgroup-name">${cat ? escapeHtml(cat.name) : "Turkumsiz"}</p>
        <span class="ov-mgroup-meta">${items.length} ta · ${fmtNum(ovGroupTotalQty(items))} dona</span>
      </div>
      ${items.map(ovMobileCardHtml).join('')}
    </div>
  `).join('');
}

function ovMobileCardHtml(item) {
  const status = ovStatus(item);
  const profit = Number(item.sale_price) - Number(item.cost_price);
  const margin = item.sale_price > 0 ? Math.round((profit / item.sale_price) * 100) : 0;
  const profitCls = profit < 0 ? 'danger' : 'profit';
  const profitSign = profit >= 0 ? '+' : '';
  return `
    <div class="ov-mcard">
      <div class="ov-mcard-top">
        ${ovThumbHtml(item, '')}
        <div class="ov-mcard-name">
          <div class="ov-name">${escapeHtml(item.name)}${item.volume ? ` <span style="color:var(--muted); font-weight:400;">(${escapeHtml(item.volume)})</span>` : ''}</div>
          ${ovLinkedSubHtml(item)}
        </div>
        <div class="ov-mcard-qty">
          <div><span class="ov-qty-num">${fmtNum(item.quantity)}</span><span class="ov-qty-unit">${escapeHtml(item.unit)}</span></div>
          ${ovPillHtml(status)}
        </div>
      </div>
      <div class="ov-price-box">
        <div class="ov-price-cell"><div class="ov-price-label">Tan narxi</div><div class="ov-price-value">${fmtNum(item.cost_price)}</div></div>
        <div class="ov-price-cell"><div class="ov-price-label">Sotuv narxi</div><div class="ov-price-value">${fmtNum(item.sale_price)}</div></div>
        <div class="ov-price-cell"><div class="ov-price-label">Foyda · ${margin}%</div><div class="ov-price-value ${profitCls}">${profitSign}${fmtNum(profit)}</div></div>
      </div>
      <div class="ov-mcard-actions">
        <button class="ov-act-btn ov-act-in ov-act-flex" data-in="${item.id}" type="button" aria-label="Kirim" title="Kirim">${OV_ICON_IN}Kirim</button>
        <button class="ov-act-btn ov-act-out ov-act-flex" data-out="${item.id}" type="button" aria-label="Chiqim" title="Chiqim">${OV_ICON_OUT}Chiqim</button>
        <button class="ov-icon-btn" data-history="${item.id}" type="button" aria-label="Tarix" title="Tarix">${OV_ICON_HISTORY}</button>
        <div class="ov-more-wrap">
          <button class="ov-icon-btn ov-more-toggle" type="button" aria-label="Qo'shimcha amallar" title="Qo'shimcha amallar">${OV_ICON_KEBAB}</button>
          <div class="ov-more-menu">
            <button type="button" data-stocktake="${item.id}">${OV_ICON_STOCKTAKE}Inventarizatsiya</button>
            <button type="button" data-edit="${item.id}">${OV_ICON_EDIT}Tahrirlash</button>
            <button type="button" class="danger" data-del="${item.id}">${OV_ICON_TRASH}O'chirish</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function wireOvActions(box) {
  box.querySelectorAll('[data-in]').forEach((b) => b.addEventListener('click', () => openAdjustModal(Number(b.dataset.in), 'in')));
  box.querySelectorAll('[data-out]').forEach((b) => b.addEventListener('click', () => openAdjustModal(Number(b.dataset.out), 'out')));
  box.querySelectorAll('[data-history]').forEach((b) => b.addEventListener('click', () => openHistoryModal(Number(b.dataset.history))));
  box.querySelectorAll('[data-stocktake]').forEach((b) => b.addEventListener('click', () => { closeAllOvMoreMenus(); openStocktakeModal(Number(b.dataset.stocktake)); }));
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { closeAllOvMoreMenus(); openInvModal(Number(b.dataset.edit)); }));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { closeAllOvMoreMenus(); delItem(Number(b.dataset.del)); }));
  box.querySelectorAll('.ov-more-toggle').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = b.nextElementSibling;
    const wasOpen = menu.classList.contains('open');
    closeAllOvMoreMenus();
    if (!wasOpen) menu.classList.add('open');
  }));
}

function closeAllOvMoreMenus() {
  document.querySelectorAll('.ov-more-menu.open').forEach((m) => m.classList.remove('open'));
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ov-more-wrap')) closeAllOvMoreMenus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllOvMoreMenus();
});

// ---------------- Qidiruv (debounce 150ms) ----------------

let ovSearchDebounceTimer = null;
document.getElementById('ovSearchInput').addEventListener('input', (e) => {
  const val = e.target.value;
  clearTimeout(ovSearchDebounceTimer);
  ovSearchDebounceTimer = setTimeout(() => {
    invSearchTerm = val.trim().toLowerCase();
    render();
    syncOvUrl();
  }, 150);
});

// ---------------- Mahsulot qo'shish/tahrirlash modali ----------------

function openInvModal(id) {
  editingInvId = id || null;
  const item = id ? inventoryItems.find((i) => i.id === id) : null;
  document.getElementById('invModalTitle').textContent = item ? 'Mahsulotni tahrirlash' : 'Yangi ombor mahsuloti';
  document.getElementById('invName').value = item ? item.name : '';
  document.getElementById('invVolume').value = item ? (item.volume || '') : '';
  document.getElementById('invUnit').value = item ? item.unit : 'dona';
  document.getElementById('invThreshold').value = item ? item.low_stock_threshold : 0;
  document.getElementById('invCost').value = item ? item.cost_price : 0;
  document.getElementById('invSale').value = item ? item.sale_price : 0;

  const catSel = document.getElementById('invCategory');
  catSel.innerHTML = ['<option value="">— Turkumsiz —</option>']
    .concat(inventoryCategories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`))
    .join('');
  catSel.value = item && item.category_id ? String(item.category_id) : '';

  currentInvImageUrl = item ? (item.image_url || null) : null;
  document.getElementById('invImageFile').value = '';
  document.getElementById('invImageCameraFile').value = '';
  document.getElementById('invImageStatus').textContent = '';
  updateInvImagePreview();

  // Boshlang'ich qoldiq faqat YANGI mahsulot qo'shishda ko'rsatiladi — mavjud
  // mahsulotning qoldig'i "Kirim/Chiqim" (tarix bilan) orqali o'zgartiriladi,
  // to'g'ridan-to'g'ri tahrirlash orqali emas (aks holda harakat tarixi
  // (inventory_movements) bilan mos kelmay qolardi).
  const qtyField = document.getElementById('invQtyField');
  if (item) {
    qtyField.classList.add('hidden');
  } else {
    qtyField.classList.remove('hidden');
    document.getElementById('invQty').value = 0;
  }

  // "Menyuda ko'rsatish" select'i — mahsulot ALLAQACHON biror taomga bog'langan
  // bo'lsa yashiriladi (qayta tanlash yangi dublikat taom yaratib qo'ymasin;
  // server ham buni no-op qiladi, lekin UI'da ham chalkashtirmaslik uchun
  // yashirilgan yaxshi) — o'rniga qaysi taom(lar)ga bog'liqligi matn bilan
  // ko'rsatiladi. Bog'lanmagan bo'lsa — bo'lim tanlab, darhol menyuda
  // ko'rinadigan qilish mumkin.
  const menuCatField = document.getElementById('invMenuCategoryField');
  const linkedNote = document.getElementById('invLinkedNote');
  const isLinked = item && item.linked_menu_count > 0;
  if (isLinked) {
    menuCatField.classList.add('hidden');
    linkedNote.textContent = `Bog'langan menyu taomi: ${item.linked_menu_items}. O'zgartirish/qo'shimcha hajm qo'shish uchun Menyu bo'limiga o'ting.`;
  } else {
    menuCatField.classList.remove('hidden');
    linkedNote.textContent = '';
    const sel = document.getElementById('invMenuCategory');
    sel.innerHTML = ['<option value="">— Menyuda ko\'rsatilmasin (masalan salfetka) —</option>']
      .concat(menuCategories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`))
      .join('');
    sel.value = '';
  }

  document.getElementById('invModal').classList.remove('hidden');
}
function closeInvModal() { document.getElementById('invModal').classList.add('hidden'); editingInvId = null; }

function updateInvImagePreview() {
  const img = document.getElementById('invImagePreview');
  if (currentInvImageUrl) {
    img.src = currentInvImageUrl;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
    img.removeAttribute('src');
  }
}

// Rasm — MAJBURIY EMAS: fayl tanlangan zahoti (Saqlash bosilishidan oldin)
// alohida (multipart) so'rov bilan yuklanadi, natijada kelgan URL keyin
// mahsulot saqlanganda yuboriladi (public/admin/menu.js'dagi bilan bir xil naqsh).
// Ikkita manba bor: galereyadan tanlash va kamerada bevosita olish (capture="environment") —
// ikkalasi ham bir xil yuklash funksiyasiga ulanadi.
async function handleInvImageInputChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('invImageStatus');
  statusEl.textContent = 'Yuklanmoqda...';
  try {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${API_BASE}api/admin/inventory/upload-image`, { method: 'POST', body: form, credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || 'Rasm yuklashda xatolik');
    currentInvImageUrl = data.url;
    updateInvImagePreview();
    statusEl.textContent = 'Rasm yuklandi.';
  } catch (err) {
    statusEl.textContent = '';
    toast(err.message, 'error');
    e.target.value = '';
  }
}
document.getElementById('invImageFile').addEventListener('change', handleInvImageInputChange);
document.getElementById('invImageCameraFile').addEventListener('change', handleInvImageInputChange);

document.getElementById('invImageRemoveBtn').addEventListener('click', () => {
  currentInvImageUrl = null;
  document.getElementById('invImageFile').value = '';
  document.getElementById('invImageCameraFile').value = '';
  document.getElementById('invImageStatus').textContent = '';
  updateInvImagePreview();
});

document.getElementById('addItemBtn').addEventListener('click', () => openInvModal(null));
document.getElementById('invCancelBtn').addEventListener('click', closeInvModal);
document.getElementById('invSaveBtn').addEventListener('click', async () => {
  const name = document.getElementById('invName').value.trim();
  const volume = document.getElementById('invVolume').value.trim();
  const unit = document.getElementById('invUnit').value.trim() || 'dona';
  const low_stock_threshold = Number(document.getElementById('invThreshold').value) || 0;
  const cost_price = Number(document.getElementById('invCost').value) || 0;
  const sale_price = Number(document.getElementById('invSale').value) || 0;
  const menuCatVal = document.getElementById('invMenuCategory').value;
  const menu_category_id = menuCatVal ? Number(menuCatVal) : null;
  const catVal = document.getElementById('invCategory').value;
  const category_id = catVal ? Number(catVal) : null;
  const image_url = currentInvImageUrl || '';
  if (!name) return toast('Nomini kiriting', 'error');
  try {
    let result;
    if (editingInvId) {
      result = await api(`/admin/inventory/items/${editingInvId}`, { method: 'PUT', body: { name, unit, low_stock_threshold, cost_price, sale_price, volume, menu_category_id, category_id, image_url } });
    } else {
      const quantity = Number(document.getElementById('invQty').value) || 0;
      result = await api('/admin/inventory/items', { method: 'POST', body: { name, unit, quantity, low_stock_threshold, cost_price, sale_price, volume, menu_category_id, category_id, image_url } });
    }
    closeInvModal();
    // Mahsulot har doim saqlanadi, lekin "Menyuda ko'rsatish" bog'lash qismi
    // (masalan eskirgan kategoriya tanlangan bo'lsa) alohida muvaffaqiyatsiz
    // bo'lishi mumkin — shu holatda server _link_warning bilan ogohlantiradi
    // (2026-09-09'da qo'shildi, server/services/inventory.js'dagi izohga qarang).
    if (result && result._link_warning) {
      toast(`Mahsulot saqlandi, lekin menyuga bog'lashda xatolik: ${result._link_warning}`, 'error');
    } else {
      toast('Saqlandi');
    }
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function delItem(id) {
  const item = inventoryItems.find((i) => i.id === id);
  const label = item ? item.name : 'mahsulot';
  const ok = await customConfirm(`"${label}"ni o'chirasizmi? Unga bog'langan menyu taomlari uzilib, qo'lda boshqariladigan bo'lib qoladi.`);
  if (!ok) return;
  try {
    await api(`/admin/inventory/items/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------- Kirim/chiqim (qoldiqni o'zgartirish) modali ----------------
// mode: 'in' = kirim (mahsulot keldi — doim musbat son so'raladi, "Necha dona
// keldi?"), 'out' = chiqim (buzildi/isrof bo'ldi va h.k. — "Necha dona ketdi?").
// Ikkalasida ham admin FAQAT musbat son kiritadi — ishora (+/-) ichkarida
// avtomatik qo'yiladi, shu bilan "manfiy son kiritish kerakmi?" degan
// chalkashlik butunlay yo'qoladi.
let adjustMode = 'in';

function openAdjustModal(id, mode) {
  adjustingInvId = id;
  adjustMode = mode;
  const item = inventoryItems.find((i) => i.id === id);
  if (!item) return;
  const modeLabel = mode === 'in' ? 'Kirim' : 'Chiqim';
  document.getElementById('adjustModalTitle').textContent = `${item.name} — ${modeLabel}`;
  document.getElementById('adjustQtyLabel').textContent = mode === 'in' ? 'Necha dona keldi?' : 'Necha dona ketdi?';
  document.getElementById('adjustCurrentQty').textContent = `Hozirgi qoldiq: ${item.quantity} ${item.unit}`;
  document.getElementById('adjustDelta').value = '';
  document.getElementById('adjustDelta').placeholder = mode === 'in' ? 'masalan: 24' : 'masalan: 3';
  document.getElementById('adjustReasonField').classList.toggle('hidden', mode !== 'out');
  document.getElementById('adjustReason').value = 'adjustment';
  document.getElementById('adjustNote').value = '';
  document.getElementById('adjustSaveBtn').textContent = mode === 'in' ? 'Kirim qilish' : 'Chiqim qilish';
  document.getElementById('adjustModal').classList.remove('hidden');
}
function closeAdjustModal() { document.getElementById('adjustModal').classList.add('hidden'); adjustingInvId = null; }

document.getElementById('adjustCancelBtn').addEventListener('click', closeAdjustModal);
document.getElementById('adjustSaveBtn').addEventListener('click', async () => {
  const qty = Number(document.getElementById('adjustDelta').value);
  const note = document.getElementById('adjustNote').value.trim();
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
    return toast("Miqdorni to'g'ri kiriting (masalan 24)", 'error');
  }
  const delta = adjustMode === 'in' ? qty : -qty;
  const reason = adjustMode === 'out' ? document.getElementById('adjustReason').value : undefined;
  try {
    await api(`/admin/inventory/items/${adjustingInvId}/adjust`, { method: 'POST', body: { delta, note, reason } });
    closeAdjustModal();
    toast('Saqlandi');
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------------- Inventarizatsiya (qo'lda fizik sanash) modali ----------------
// Admin "haqiqatda nechta bor" sonini kiritadi — farq serverda avtomatik
// hisoblanadi va 'stocktake' sababi bilan yoziladi (2026-10-10, Ombor auditi).
let stocktakeInvId = null;

function openStocktakeModal(id) {
  stocktakeInvId = id;
  const item = inventoryItems.find((i) => i.id === id);
  if (!item) return;
  document.getElementById('stocktakeModalTitle').textContent = `${item.name} — Inventarizatsiya`;
  document.getElementById('stocktakeCurrentQty').textContent = `Tizimdagi qoldiq: ${item.quantity} ${item.unit}`;
  document.getElementById('stocktakeQty').value = '';
  document.getElementById('stocktakeQty').placeholder = `masalan: ${item.quantity}`;
  document.getElementById('stocktakeNote').value = '';
  document.getElementById('stocktakeModal').classList.remove('hidden');
}
function closeStocktakeModal() { document.getElementById('stocktakeModal').classList.add('hidden'); stocktakeInvId = null; }

document.getElementById('stocktakeCancelBtn').addEventListener('click', closeStocktakeModal);
document.getElementById('stocktakeSaveBtn').addEventListener('click', async () => {
  const actual_quantity = Number(document.getElementById('stocktakeQty').value);
  const note = document.getElementById('stocktakeNote').value.trim();
  if (!Number.isFinite(actual_quantity) || !Number.isInteger(actual_quantity) || actual_quantity < 0) {
    return toast("Haqiqiy qoldiqni to'g'ri kiriting", 'error');
  }
  try {
    await api(`/admin/inventory/items/${stocktakeInvId}/stocktake`, { method: 'POST', body: { actual_quantity, note } });
    closeStocktakeModal();
    toast('Saqlandi');
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------------- Tarix (har bir kirim/chiqim harakati) ----------------

const MOVEMENT_LABELS = {
  restock: 'Kirim',
  adjustment: 'Chiqim / tuzatish',
  waste: 'Isrof',
  stocktake: 'Inventarizatsiya',
  order: 'Buyurtma orqali sarflandi',
  return: "Bekor qilingan buyurtma qaytardi",
};

async function openHistoryModal(id) {
  const item = inventoryItems.find((i) => i.id === id);
  document.getElementById('historyModalTitle').textContent = item ? `${item.name} — tarix` : 'Tarix';
  const box = document.getElementById('historyList');
  box.innerHTML = '<p class="dim">Yuklanmoqda...</p>';
  document.getElementById('historyModal').classList.remove('hidden');
  try {
    const rows = await api(`/admin/inventory/items/${id}/movements`);
    if (rows.length === 0) {
      box.innerHTML = '<p class="dim">Hali hech qanday harakat yo\'q.</p>';
      return;
    }
    box.innerHTML = rows.map((r) => {
      const sign = r.delta > 0 ? '+' : '';
      const cls = r.delta > 0 ? 'ok' : 'low';
      const label = MOVEMENT_LABELS[r.reason] || r.reason;
      return `
        <div class="card-row" style="padding:8px 0; border-bottom:1px solid var(--border);">
          <div>
            <div>${escapeHtml(label)}${r.note ? ` — ${escapeHtml(r.note)}` : ''}</div>
            <div class="dim" style="font-size:12px;">${fmtDateTime(r.created_at)}${r.created_by_name ? ` · ${escapeHtml(r.created_by_name)}` : ''}</div>
          </div>
          <div class="badge ${cls}">${sign}${r.delta} ${item ? escapeHtml(item.unit) : ''}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}
document.getElementById('historyCloseBtn').addEventListener('click', () => {
  document.getElementById('historyModal').classList.add('hidden');
});
document.getElementById('historyModal').addEventListener('click', (e) => {
  if (e.target.id === 'historyModal') document.getElementById('historyModal').classList.add('hidden');
});

// ---------------- Turkumlar (Ombor sahifasini ustunlarga ajratish) ----------------

function renderCategoryList() {
  const box = document.getElementById('categoryList');
  if (inventoryCategories.length === 0) {
    box.innerHTML = '<p class="dim" style="font-size:12px;">Hali turkum yo\'q — pastdan qo\'shing.</p>';
    return;
  }
  box.innerHTML = inventoryCategories.map((c) => `
    <div class="card-row" style="padding:6px 0; border-bottom:1px solid var(--border); gap:8px;">
      <input data-cat-name-input="${c.id}" value="${escapeHtml(c.name)}" style="flex:1;">
      <button class="btn small" data-cat-save="${c.id}">Saqlash</button>
      <button class="btn small danger" data-cat-del="${c.id}">🗑</button>
    </div>
  `).join('');
  box.querySelectorAll('[data-cat-save]').forEach((b) => b.addEventListener('click', () => saveCategoryName(Number(b.dataset.catSave))));
  box.querySelectorAll('[data-cat-del]').forEach((b) => b.addEventListener('click', () => delCategory(Number(b.dataset.catDel))));
}

function openCategoryModal() {
  document.getElementById('newCategoryName').value = '';
  renderCategoryList();
  document.getElementById('categoryModal').classList.remove('hidden');
}
document.getElementById('addCategoryBtn').addEventListener('click', openCategoryModal);
document.getElementById('categoryCloseBtn').addEventListener('click', () => {
  document.getElementById('categoryModal').classList.add('hidden');
});

async function saveCategoryName(id) {
  const input = document.querySelector(`[data-cat-name-input="${id}"]`);
  const name = input.value.trim();
  if (!name) return toast('Nomini kiriting', 'error');
  try {
    await api(`/admin/inventory/categories/${id}`, { method: 'PUT', body: { name } });
    toast('Saqlandi');
    await loadAll();
    renderCategoryList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function delCategory(id) {
  const cat = inventoryCategories.find((c) => c.id === id);
  const ok = await customConfirm(`"${cat ? cat.name : 'turkum'}"ni o'chirasizmi? Unga tegishli mahsulotlar "Turkumsiz" bo'lib qoladi.`);
  if (!ok) return;
  try {
    await api(`/admin/inventory/categories/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    if (invCategoryFilter === id) invCategoryFilter = 'all';
    await loadAll();
    renderCategoryList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('addCategorySaveBtn').addEventListener('click', async () => {
  const name = document.getElementById('newCategoryName').value.trim();
  if (!name) return toast('Nomini kiriting', 'error');
  try {
    await api('/admin/inventory/categories', { method: 'POST', body: { name, sort_order: inventoryCategories.length } });
    document.getElementById('newCategoryName').value = '';
    toast('Qo\'shildi');
    await loadAll();
    renderCategoryList();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initLayout('inventory');
  readFiltersFromUrl();
  loadAll();
});
