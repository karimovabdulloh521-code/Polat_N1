// public/waiter/order.js — "Buyurtma" (stol ichidagi menyu) sahifasi,
// 2026-10-16 qayta dizayni. escapeHtml/fmtMoney/api/toast/customConfirm/
// showInfoModal/reportPollResult — ../app.js'dan global. Bu sahifa ENDI
// ../menu-picker.js'ni ulamaydi (kassir bilan umumiy komponent) — o'z
// mustaqil render mantig'iga ega, shu sabab kassir ekraniga hech narsa
// tegmaydi. Server API va ma'lumot oqimi o'zgarmagan.

const params = new URLSearchParams(window.location.search);
const TABLE_ID = params.get('table');

let menuCategories = [];
let activeCategoryId = null;
let searchQuery = '';
let currentView = null; // so'nggi /waiter/tables/:id/order javobi (yoki null)
let tableLabel = '';
let zoneLabel = '';
let variantModalItemId = null; // hozir ochiq turgan "turlarni tanlash" oynasi uchun asosiy taom id

// ---------------- Qidiruv normalizatsiyasi ----------------
// O'zbekcha apostrof belgilari (o'/oʻ/ʻ/’) turlicha kiritilishi mumkin —
// qidiruvda ularni bir xil deb hisoblaymiz.
function normalizeSearch(s) {
  return String(s || '').toLowerCase().replace(/[ʻʼ'’`]/g, '');
}

function itemMatchesSearch(it, q) {
  if (normalizeSearch(it.name).includes(q)) return true;
  return (it.variants || []).some((v) => normalizeSearch(v.name).includes(q));
}

// ---------------- Header balandligini kuzatish (sticky joylashuvlar uchun) ----------------
// Sarlavha matni ("Stol N") uzunligi va ekran kengligiga qarab header
// balandligi o'zgarishi mumkin — toolbar/sidebar/panel sticky-top qiymati
// shu haqiqiy balandlikka bog'langan (taxminiy piksel emas), aks holda
// turli kengliklarda matn kesilib/ustma-ust tushib qolishi mumkin edi.
function updateHeaderHeightVar() {
  const header = document.getElementById('ordHeader');
  if (!header) return;
  document.documentElement.style.setProperty('--ord-header-h', `${header.offsetHeight}px`);
}

// ---------------- Stol nomi/zal ----------------

async function loadTableInfo() {
  try {
    const overview = await api('/waiter/tables/overview');
    for (const hall of overview.halls) {
      const t = hall.tables.find((x) => String(x.id) === String(TABLE_ID));
      if (t) {
        tableLabel = t.number;
        zoneLabel = hall.name;
        document.getElementById('ordTableTitle').textContent = `Stol ${t.number}`;
        updateHeaderHeightVar();
        break;
      }
    }
  } catch (e) { /* jim — sarlavha "Stol" bo'lib qolaveradi */ }
}

function renderHeaderMeta() {
  const el = document.getElementById('ordMeta');
  if (!currentView || currentView.items.length === 0) {
    el.classList.remove('is-open');
    el.textContent = 'Yangi buyurtma';
  } else {
    const total = currentView.items.reduce((s, it) => s + it.subtotal, 0);
    el.classList.add('is-open');
    el.innerHTML = `<span class="ord-meta-dot"></span> Ochiq buyurtma · ${fmtMoney(total)}`;
  }
  updateHeaderHeightVar();
}

// ---------------- Menyu ----------------

async function loadMenu() {
  try {
    menuCategories = await api('/waiter/menu');
  } catch (err) {
    document.getElementById('ordMenuGrid').innerHTML = `<p class="ord-dim">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!activeCategoryId && menuCategories.length > 0) activeCategoryId = menuCategories[0].id;
  renderCatTabs();
  updateSearchPlaceholder();
  renderMenuGrid();
}

function updateSearchPlaceholder() {
  const cat = menuCategories.find((c) => c.id === activeCategoryId);
  const input = document.getElementById('ordSearchInput');
  input.placeholder = cat ? `${cat.name} ichidan qidirish…` : 'Qidirish…';
}

function renderCatTabs() {
  const tabs = document.getElementById('ordCatTabs');
  const sidebar = document.getElementById('ordCatSidebar');
  tabs.innerHTML = menuCategories.map((c) => `
    <button type="button" class="ord-cat-tab ${c.id === activeCategoryId ? 'is-active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)} <span class="ord-cat-tab-count">${c.items.length}</span></button>
  `).join('');
  sidebar.innerHTML = menuCategories.map((c) => `
    <button type="button" class="ord-sidebar-item ${c.id === activeCategoryId ? 'is-active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)} <span class="ord-sidebar-item-count">${c.items.length}</span></button>
  `).join('');
  tabs.querySelectorAll('[data-cat]').forEach((btn) => btn.addEventListener('click', () => selectCategory(Number(btn.dataset.cat))));
  sidebar.querySelectorAll('[data-cat]').forEach((btn) => btn.addEventListener('click', () => selectCategory(Number(btn.dataset.cat))));

  const activeChip = tabs.querySelector('.is-active');
  if (activeChip) activeChip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function selectCategory(id) {
  if (id === activeCategoryId) return;
  activeCategoryId = id;
  searchQuery = '';
  document.getElementById('ordSearchInput').value = '';
  window.scrollTo(0, 0);
  renderCatTabs();
  updateSearchPlaceholder();
  renderMenuGrid();
}

// ---------------- Taom/variant yordamchilari ----------------

// Ota taom ham, uning har bir "turi" ham mustaqil sotiladigan birlik —
// shu sabab "Turini tanlash" oynasida ota taomning o'zi HAM birinchi
// tanlov sifatida ko'rsatiladi (variantlar bilan bir qatorda).
function itemOptions(it) {
  return [{ id: it.id, name: it.name, price: it.price, volume: it.volume, is_available: it.is_available }, ...(it.variants || [])];
}

function cardQty(it) {
  return itemOptions(it).reduce((sum, opt) => sum + getQtyOf(opt.id), 0);
}

function cheapestPrice(it) {
  return Math.min(...itemOptions(it).map((o) => o.price));
}

function findMenuItemAny(optionId) {
  for (const cat of menuCategories) {
    for (const it of cat.items) {
      if (it.id === optionId) return it;
      const v = (it.variants || []).find((x) => x.id === optionId);
      if (v) return v;
    }
  }
  return null;
}

function findPendingOrderItem(menuItemId) {
  if (!currentView) return null;
  return currentView.items.find((it) => it.menu_item_id === menuItemId && !it.sent_at);
}

// Kartochkada "hozir nechta tanlangan" — faqat hali yuborilmagan (sent_at
// yo'q) qatorlar hisoblanadi, menyudan yana "+" bosilganda o'sha qatorga
// qo'shiladi (server/services/orders.js'dagi birlashtirish mantig'i bilan mos).
function getQtyOf(menuItemId) {
  if (!currentView) return 0;
  return currentView.items
    .filter((it) => it.menu_item_id === menuItemId && !it.sent_at)
    .reduce((sum, it) => sum + it.quantity, 0);
}

// ---------------- Menyu grid ----------------

function renderMenuGrid() {
  const grid = document.getElementById('ordMenuGrid');
  const cat = menuCategories.find((c) => c.id === activeCategoryId);
  if (!cat) {
    grid.innerHTML = '<p class="ord-dim">Bu bo\'limda taom yo\'q.</p>';
    return;
  }
  const q = normalizeSearch(searchQuery);
  let items = cat.items;
  if (q) {
    items = cat.items.filter((it) => itemMatchesSearch(it, q));
    if (items.length === 0) {
      grid.innerHTML = `<p class="ord-dim">${escapeHtml(cat.name)} ichida "${escapeHtml(searchQuery.trim())}" topilmadi</p>`;
      return;
    }
  }
  if (items.length === 0) {
    grid.innerHTML = '<p class="ord-dim">Bu bo\'limda taom yo\'q.</p>';
    return;
  }
  grid.innerHTML = items.map(renderCard).join('');
  attachCardHandlers(grid);
}

function cardImageHtml(it) {
  if (it.image_url) {
    return `<img src="${escapeHtml(it.image_url)}" class="ord-card-img" loading="lazy" alt="">`;
  }
  const letter = (it.name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="ord-card-img-letter">${escapeHtml(letter)}</span>`;
}

function renderCard(it) {
  const hasVariants = it.variants && it.variants.length > 0;
  const available = it.is_available !== false;
  const qty = cardQty(it);
  const optCount = itemOptions(it).length;

  let priceHtml;
  if (hasVariants) {
    priceHtml = `<span class="ord-card-price">${fmtMoney(cheapestPrice(it))}dan</span>`;
  } else {
    priceHtml = `<span class="ord-card-price">${fmtMoney(it.price)}</span>${it.volume ? `<span class="ord-card-unit">/ ${escapeHtml(it.volume)}</span>` : ''}`;
  }

  let actionHtml;
  if (hasVariants) {
    actionHtml = `<button type="button" class="ord-variant-btn" data-open-variants="${it.id}">Turini tanlash ›</button>`;
  } else if (!available) {
    actionHtml = '<button type="button" class="ord-add-btn" disabled>Tugadi</button>';
  } else if (qty > 0) {
    actionHtml = `
      <div class="ord-card-stepper">
        <button type="button" data-card-dec="${it.id}" aria-label="Kamaytirish">−</button>
        <span class="ord-card-stepper-val ord-num">${qty}</span>
        <button type="button" data-card-inc="${it.id}" aria-label="Qo'shish">+</button>
      </div>`;
  } else {
    actionHtml = `<button type="button" class="ord-add-btn" data-card-add="${it.id}">+ Qo'shish</button>`;
  }

  return `
    <div class="ord-card${qty > 0 ? ' in-cart' : ''}${available ? '' : ' unavailable'}">
      <div class="ord-card-img-wrap${it.image_url ? ' ord-skel' : ''}" data-open="${it.id}">
        ${cardImageHtml(it)}
        ${hasVariants ? `<span class="ord-variant-flag">${optCount} turi</span>` : ''}
        ${qty > 0 ? `<span class="ord-cart-badge ord-num">${qty}</span>` : ''}
      </div>
      <div class="ord-card-body" data-open="${it.id}">
        <div class="ord-card-name">${escapeHtml(it.name)}</div>
        <div class="ord-card-price-row">${priceHtml}</div>
        ${!available ? '<span class="ord-badge-low">Tugadi</span>' : ''}
      </div>
      <div class="ord-card-action">${actionHtml}</div>
    </div>`;
}

function attachCardHandlers(grid) {
  grid.querySelectorAll('.ord-card-img').forEach((img) => {
    const wrap = img.closest('.ord-card-img-wrap');
    if (img.complete) { wrap.classList.remove('ord-skel'); return; }
    img.addEventListener('load', () => wrap.classList.remove('ord-skel'), { once: true });
    img.addEventListener('error', () => wrap.classList.remove('ord-skel'), { once: true });
  });
  grid.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.open);
      const item = findMenuItemAny(id);
      if (item && item.variants && item.variants.length > 0) openVariantModal(id);
      else showItemInfo(id);
    });
  });
  grid.querySelectorAll('[data-open-variants]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openVariantModal(Number(btn.dataset.openVariants)); });
  });
  grid.querySelectorAll('[data-card-add]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); addItem(Number(btn.dataset.cardAdd)); });
  });
  grid.querySelectorAll('[data-card-inc]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); addItem(Number(btn.dataset.cardInc)); });
  });
  grid.querySelectorAll('[data-card-dec]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); decrementMenuItem(Number(btn.dataset.cardDec)); });
  });
}

function showItemInfo(menuItemId) {
  const item = findMenuItemAny(menuItemId);
  if (!item) return;
  const body = (item.description && item.description.trim())
    ? item.description.trim()
    : "Bu taom haqida hali ma'lumot kiritilmagan.";
  const title = item.volume ? `${item.name} (${item.volume})` : item.name;
  showInfoModal(title, body);
}

// ---------------- Turlarni tanlash oynasi ----------------

function openVariantModal(itemId) {
  variantModalItemId = itemId;
  renderVariantModalBody();
  document.getElementById('ordVariantBackdrop').classList.add('is-open');
  document.body.classList.add('ord-lock');
}

function closeVariantModal() {
  variantModalItemId = null;
  document.getElementById('ordVariantBackdrop').classList.remove('is-open');
  document.body.classList.remove('ord-lock');
}

function renderVariantModalBody() {
  const item = findMenuItemAny(variantModalItemId);
  if (!item) return;
  document.getElementById('ordVariantTitle').textContent = item.name;
  const opts = itemOptions(item);
  const body = document.getElementById('ordVariantBody');
  body.innerHTML = opts.map((o) => {
    const available = o.is_available !== false;
    const qty = getQtyOf(o.id);
    let action;
    if (!available) {
      action = '<button type="button" class="ord-vr-add" disabled>—</button>';
    } else if (qty > 0) {
      action = `
        <div class="ord-vr-stepper">
          <button type="button" data-vr-dec="${o.id}" aria-label="Kamaytirish">−</button>
          <span class="ord-qty-val ord-num">${qty}</span>
          <button type="button" data-vr-add="${o.id}" aria-label="Qo'shish">+</button>
        </div>`;
    } else {
      action = `<button type="button" class="ord-vr-add" data-vr-add="${o.id}">+ Qo'shish</button>`;
    }
    return `
      <div class="ord-variant-row">
        <div class="ord-variant-row-info">
          <div class="ord-variant-row-name">${escapeHtml(o.name)}${o.volume ? ` (${escapeHtml(o.volume)})` : ''}${available ? '' : ' <span class="ord-badge-low">Tugadi</span>'}</div>
          <div class="ord-variant-row-price ord-num">${fmtMoney(o.price)}</div>
        </div>
        <div class="ord-variant-row-action">${action}</div>
      </div>`;
  }).join('');
  body.querySelectorAll('[data-vr-add]').forEach((btn) => {
    btn.addEventListener('click', () => addItem(Number(btn.dataset.vrAdd)));
  });
  body.querySelectorAll('[data-vr-dec]').forEach((btn) => {
    btn.addEventListener('click', () => decrementMenuItem(Number(btn.dataset.vrDec)));
  });
  const totalQty = opts.reduce((s, o) => s + getQtyOf(o.id), 0);
  document.getElementById('ordVariantDoneBtn').textContent = totalQty > 0 ? `Tayyor · ${totalQty} ta` : 'Tayyor';
}

// ---------------- Savatga qo'shish / kamaytirish ----------------

function refreshAfterCartChange() {
  renderMenuGrid();
  renderPanel();
  renderHeaderMeta();
  if (variantModalItemId) renderVariantModalBody();
}

async function addItem(menuItemId) {
  try {
    currentView = await api(`/waiter/tables/${TABLE_ID}/items`, { method: 'POST', body: { menu_item_id: menuItemId, quantity: 1 } });
    refreshAfterCartChange();
    const item = findMenuItemAny(menuItemId);
    toast(item ? `${item.name} tanlandi` : "Qo'shildi");
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function decrementMenuItem(menuItemId) {
  const oi = findPendingOrderItem(menuItemId);
  if (!oi) return;
  await changeQty(oi.id, -1);
}

// ---------------- Savat paneli ----------------

function statusOf(it) {
  if (it.picked_up_at) return 'done';
  if (it.ready_at) return 'ready';
  if (it.sent_at) return 'cooking';
  return 'pending';
}

function minutesSince(iso) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function pendingLineHtml(it) {
  return `
    <div class="ord-line" data-line="${it.id}">
      <div class="ord-line-top">
        <div class="ord-line-info">
          <div class="ord-line-name">${escapeHtml(it.name_snapshot)}</div>
          <div class="ord-line-unit ord-num">${it.quantity} × ${fmtMoney(it.unit_price)}</div>
        </div>
        <div class="ord-line-right">
          <div class="ord-line-amount ord-num">${fmtMoney(it.subtotal)}</div>
          <div class="ord-stepper">
            <button type="button" data-dec="${it.id}" aria-label="Kamaytirish">−</button>
            <span class="ord-qty-val ord-num">${it.quantity}</span>
            <button type="button" data-inc="${it.id}" aria-label="Qo'shish">+</button>
          </div>
        </div>
      </div>
      ${it.note ? `<div class="ord-line-note">📝 ${escapeHtml(it.note)}</div>` : ''}
      <div class="ord-line-actions">
        <button type="button" class="ord-note-btn" data-note-toggle="${it.id}">${it.note ? 'Izohni tahrirlash' : '+ Oshpazga izoh'}</button>
      </div>
      <input type="text" class="ord-line-note-input" style="display:none;" data-note-input="${it.id}" maxlength="200" placeholder="Masalan: achchiq bo'lmasin" value="${escapeHtml(it.note || '')}">
    </div>`;
}

function sentLineHtml(it) {
  const status = statusOf(it);
  let badge;
  if (status === 'cooking') badge = `<span class="ord-status-badge is-cooking"><span class="ord-dot"></span>Tayyorlanmoqda · ${minutesSince(it.sent_at)} daq</span>`;
  else if (status === 'ready') badge = '<span class="ord-status-badge is-ready"><span class="ord-dot"></span>Tayyor</span>';
  else badge = '<span class="ord-status-badge is-done">Berildi</span>';
  return `
    <div class="ord-line">
      <div class="ord-line-top">
        <div class="ord-line-info">
          <div class="ord-line-name">${it.quantity} × ${escapeHtml(it.name_snapshot)}</div>
        </div>
      </div>
      ${it.note ? `<div class="ord-line-note">📝 ${escapeHtml(it.note)}</div>` : ''}
      <div class="ord-line-actions">
        ${badge}
        ${status === 'ready' ? `<button type="button" class="ord-pickup-btn" data-pickup="${it.id}">Oldim</button>` : ''}
      </div>
    </div>`;
}

function renderPanel() {
  // 10s avtomatik yangilanish (loadOrder) renderPanel()ni so'rovsiz chaqiradi —
  // afitsiant shu paytda oshpazga izoh yozayotgan bo'lsa, butun panel qayta
  // qurilib uning hali saqlanmagan matnini (va fokusni) yo'q qilib yuborardi.
  // Izoh input fokusda ekan — panelni tegmay qoldiramiz.
  if (document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-note-input]')) {
    return;
  }
  const body = document.getElementById('ordPanelBody');
  const sub = document.getElementById('ordPanelSub');
  const totalEl = document.getElementById('ordPanelTotal');
  const sendBtn = document.getElementById('ordSendBtn');
  const billBtn = document.getElementById('ordBillBtn');
  const bottomBar = document.getElementById('ordBottomBar');
  const bottomBarCount = document.getElementById('ordBottomBarCount');
  const bottomBarTotal = document.getElementById('ordBottomBarTotal');

  sub.textContent = [zoneLabel, currentView ? `${minutesSince(currentView.order.opened_at)} daq` : null].filter(Boolean).join(' · ');

  if (!currentView || currentView.items.length === 0) {
    if (currentView && currentView.items.length === 0) {
      body.innerHTML = `<p class="ord-panel-empty">Barcha taomlar bekor qilindi.</p><button class="ord-btn" id="ordCancelEmptyBtn" style="width:100%;">Stolni bo'shatish</button>`;
      document.getElementById('ordCancelEmptyBtn').addEventListener('click', onCancelEmptyOrder);
    } else {
      body.innerHTML = '<p class="ord-panel-empty">Buyurtma bo\'sh. Menyudan taom qo\'shing.</p>';
    }
    totalEl.textContent = fmtMoney(0);
    sendBtn.disabled = true;
    billBtn.disabled = true;
    bottomBar.style.display = 'none';
    return;
  }

  const pending = currentView.items.filter((it) => !it.sent_at);
  const sent = currentView.items.filter((it) => it.sent_at);
  const total = currentView.items.reduce((s, it) => s + it.subtotal, 0);

  let html = '';
  if (pending.length > 0) {
    html += `<div class="ord-group-title-row"><span class="ord-group-title">Tanlangan · hali yuborilmagan</span><button type="button" class="ord-clear-link" id="ordClearBtn">Tozalash</button></div>`;
    html += pending.map(pendingLineHtml).join('');
  }
  if (sent.length > 0) {
    html += '<div class="ord-group-title-row"><span class="ord-group-title">Oshxonada</span></div>';
    html += sent.map(sentLineHtml).join('');
  }
  body.innerHTML = html;

  body.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => changeQty(Number(b.dataset.dec), -1)));
  body.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => changeQty(Number(b.dataset.inc), 1)));
  body.querySelectorAll('[data-note-toggle]').forEach((b) => b.addEventListener('click', () => toggleNoteInput(Number(b.dataset.noteToggle))));
  body.querySelectorAll('[data-note-input]').forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('blur', () => saveNote(Number(input.dataset.noteInput), input.value));
  });
  body.querySelectorAll('[data-pickup]').forEach((b) => b.addEventListener('click', () => pickupItem(Number(b.dataset.pickup))));
  const clearBtn = document.getElementById('ordClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', clearPending);

  totalEl.textContent = fmtMoney(total);
  sendBtn.disabled = pending.length === 0;
  billBtn.disabled = sent.length === 0;

  bottomBar.style.display = '';
  const totalQty = currentView.items.reduce((s, it) => s + it.quantity, 0);
  bottomBarCount.textContent = String(totalQty);
  bottomBarTotal.textContent = fmtMoney(total);
}

function toggleNoteInput(itemId) {
  const line = document.querySelector(`[data-line="${itemId}"]`);
  if (!line) return;
  const input = line.querySelector('[data-note-input]');
  const btn = line.querySelector('[data-note-toggle]');
  if (input.style.display === 'none') {
    input.style.display = '';
    input.focus();
    btn.style.display = 'none';
  }
}

async function saveNote(itemId, value) {
  const trimmed = value.trim();
  try {
    currentView = await api(`/waiter/items/${itemId}`, { method: 'PATCH', body: { note: trimmed } });
    renderPanel();
  } catch (err) {
    toast(err.message, 'error');
    renderPanel();
  }
}

async function changeQty(itemId, delta) {
  const line = currentView.items.find((it) => it.id === itemId);
  if (!line) return;
  const nextQty = line.quantity + delta;
  let reason;
  if (delta < 0 && line.sent_at) {
    reason = prompt("Bu taom oshxonaga yuborilgan. Kamaytirish/bekor qilish sababini yozing:");
    if (reason === null) return;
    if (!reason.trim()) { toast('Sabab kiritilishi shart', 'error'); return; }
  }
  try {
    if (nextQty <= 0) {
      currentView = await api(`/waiter/items/${itemId}`, { method: 'DELETE', body: reason ? { reason } : undefined });
    } else {
      currentView = await api(`/waiter/items/${itemId}`, { method: 'PATCH', body: { quantity: nextQty, reason } });
    }
    refreshAfterCartChange();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function pickupItem(itemId) {
  try {
    currentView = await api(`/waiter/items/${itemId}/picked-up`, { method: 'POST' });
    renderPanel();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function clearPending() {
  if (!currentView) return;
  const pending = currentView.items.filter((it) => !it.sent_at);
  if (pending.length === 0) return;
  const ok = await customConfirm(`${pending.length} ta hali yuborilmagan taomni tozalaysizmi?`);
  if (!ok) return;
  try {
    for (const it of pending) {
      currentView = await api(`/waiter/items/${it.id}`, { method: 'DELETE' });
    }
    refreshAfterCartChange();
    toast('Tozalandi');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function sendToKitchen() {
  try {
    currentView = await api(`/waiter/tables/${TABLE_ID}/send`, { method: 'POST' });
    refreshAfterCartChange();
    toast('Buyurtma oshxonaga yuborildi');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onCancelEmptyOrder() {
  const ok = await customConfirm("Buyurtmada taom yo'q. Stolni bo'shatasizmi? Chek chiqmaydi.");
  if (!ok) return;
  try {
    await api(`/waiter/tables/${TABLE_ID}/cancel-order`, { method: 'POST' });
    toast("Stol bo'shatildi.");
    setTimeout(() => { window.location.href = 'tables.html'; }, 900);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------- Panel ochish/yopish (mobil bottom-sheet) ----------------

function openPanel() {
  document.getElementById('ordPanel').classList.add('is-open');
  document.getElementById('ordPanel').setAttribute('aria-hidden', 'false');
  document.getElementById('ordBackdrop').classList.add('is-open');
  document.body.classList.add('ord-lock');
}
function closePanel() {
  document.getElementById('ordPanel').classList.remove('is-open');
  document.getElementById('ordPanel').setAttribute('aria-hidden', 'true');
  document.getElementById('ordBackdrop').classList.remove('is-open');
  document.body.classList.remove('ord-lock');
}

// ---------------- Hisob-kitob tasdiqlash oynasi ----------------

function openBillModal() {
  if (!currentView) return;
  const sent = currentView.items.filter((it) => it.sent_at);
  const pending = currentView.items.filter((it) => !it.sent_at);
  if (sent.length === 0) return;

  document.getElementById('ordBillTitle').textContent = `${tableLabel ? `Stol ${tableLabel}` : 'Stol'} hisobi${zoneLabel ? ` · ${zoneLabel}` : ''} · kassaga yuboriladi`;
  const total = sent.reduce((sum, it) => sum + it.subtotal, 0);
  const body = document.getElementById('ordBillBody');
  body.innerHTML = sent.map((it) => `
    <div class="ord-bill-line">
      <span class="ord-bill-name">${escapeHtml(it.name_snapshot)} <span class="ord-bill-sub">${it.quantity} × ${fmtMoney(it.unit_price)}</span></span>
      <span class="ord-num">${fmtMoney(it.subtotal)}</span>
    </div>
  `).join('') + `
    <div class="ord-bill-total-row">
      <span class="ord-bill-total-label">Jami</span>
      <span class="ord-bill-total-value ord-num">${fmtMoney(total)}</span>
    </div>
  `;

  const warning = document.getElementById('ordBillWarning');
  const confirmBtn = document.getElementById('ordBillConfirm');
  if (pending.length > 0) {
    const pendingQty = pending.reduce((s, it) => s + it.quantity, 0);
    warning.style.display = '';
    warning.textContent = `${pendingQty} ta tanlangan taom hali oshxonaga yuborilmagan. Ular bekor qilinadi va hisobga kirmaydi.`;
    confirmBtn.textContent = 'Bekor qilib, kassaga yuborish';
    confirmBtn.dataset.discard = '1';
  } else {
    warning.style.display = 'none';
    confirmBtn.textContent = 'Kassaga yuborish';
    confirmBtn.dataset.discard = '';
  }

  document.getElementById('ordBillBackdrop').classList.add('is-open');
}

function closeBillModal() {
  document.getElementById('ordBillBackdrop').classList.remove('is-open');
}

async function confirmBill() {
  const discardPending = document.getElementById('ordBillConfirm').dataset.discard === '1';
  try {
    await api(`/waiter/tables/${TABLE_ID}/request-bill`, { method: 'POST', body: { discardPending } });
    closeBillModal();
    closePanel();
    toast(`Hisob kassaga yuborildi — Stol ${tableLabel || ''} bo'shadi`);
    setTimeout(() => { window.location.href = 'tables.html'; }, 1000);
  } catch (err) {
    // api() xatoni oddiy Error sifatida qaytaradi, HTTP status saqlanmaydi —
    // shu sabab "stol allaqachon yopilgan" holatini xabar matnidan aniqlaymiz
    // (server/services/orders.js'dagi requestBillToCashier() xabari bilan mos).
    if (/ochiq buyurtma yo'q/.test(err.message)) {
      closeBillModal();
      toast('Bu stol allaqachon yopilgan', 'error');
      setTimeout(() => { window.location.href = 'tables.html'; }, 800);
      return;
    }
    toast(err.message, 'error');
  }
}

// ---------------- Yuklash / avtomatik yangilanish ----------------

async function loadOrder() {
  try {
    currentView = await api(`/waiter/tables/${TABLE_ID}/order`);
    renderMenuGrid();
    renderPanel();
    renderHeaderMeta();
    reportPollResult('ordOrder', true);
  } catch (err) {
    reportPollResult('ordOrder', false, 'buyurtma');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!TABLE_ID) {
    window.location.href = 'tables.html';
    return;
  }

  updateHeaderHeightVar();
  if (window.ResizeObserver) {
    new ResizeObserver(updateHeaderHeightVar).observe(document.getElementById('ordHeader'));
  } else {
    window.addEventListener('resize', updateHeaderHeightVar);
  }

  document.getElementById('ordBackBtn').addEventListener('click', () => { window.location.href = 'tables.html'; });

  document.getElementById('ordSearchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderMenuGrid();
  });

  document.getElementById('ordBottomBar').addEventListener('click', openPanel);
  document.getElementById('ordPanelClose').addEventListener('click', closePanel);
  document.getElementById('ordBackdrop').addEventListener('click', closePanel);
  document.getElementById('ordSendBtn').addEventListener('click', sendToKitchen);
  document.getElementById('ordBillBtn').addEventListener('click', openBillModal);

  document.getElementById('ordVariantClose').addEventListener('click', closeVariantModal);
  document.getElementById('ordVariantDoneBtn').addEventListener('click', closeVariantModal);
  document.getElementById('ordVariantBackdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeVariantModal();
  });

  document.getElementById('ordBillClose').addEventListener('click', closeBillModal);
  document.getElementById('ordBillCancel').addEventListener('click', closeBillModal);
  document.getElementById('ordBillConfirm').addEventListener('click', confirmBill);
  document.getElementById('ordBillBackdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeBillModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('ordBillBackdrop').classList.contains('is-open')) closeBillModal();
    else if (document.getElementById('ordVariantBackdrop').classList.contains('is-open')) closeVariantModal();
    else if (document.getElementById('ordPanel').classList.contains('is-open')) closePanel();
  });

  loadTableInfo();
  loadMenu();
  loadOrder();
  setInterval(() => {
    if (document.hidden) return;
    loadOrder();
  }, 10000);
});
