// Kassir "Hisoblash" ekrani — 2026-09-09'da qo'shildi. Stol/menyuga bog'liq
// emas: kassir har bir qatorga taom nomi + narxi + miqdorini qo'lda kiritadi,
// jami shu sahifaning o'zida (client tomonda) jonli hisoblanadi, "Chek
// chiqarish" bosilganda server/routes/kassirBilling.js'dagi POST
// /kassir/manual-bills'ga yuboriladi (server QIYMATLARNI QAYTA TEKSHIRADI VA
// O'ZI HISOBLAYDI — mijozdan kelgan jamiga ishonilmaydi), qaytgan chek
// showReceiptModal() (../app.js'dan global, kind='manual') bilan darhol
// ko'rsatiladi/chop etiladi. escapeHtml()/fmtMoney()/toast()/customConfirm() —
// ../app.js'dan global.
const itemRowsEl = document.getElementById('itemRows');

function rowTemplate() {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <div class="field"><label>Nomi</label><input type="text" class="rowName" placeholder="Masalan: Osh"></div>
    <div class="field price"><label>Narx</label><input type="number" class="rowPrice" min="0" inputmode="numeric" placeholder="0"></div>
    <div class="field qty"><label>Miqdor</label><input type="number" class="rowQty" min="1" step="1" value="1" inputmode="numeric"></div>
    <button type="button" class="remove-item" aria-label="Qatorni o'chirish">×</button>
  `;
  return row;
}

function addRow() {
  itemRowsEl.appendChild(rowTemplate());
}

function removeRow(row) {
  row.remove();
  // Ro'yxat butunlay bo'shab qolmasin — doim kamida bitta qator turadi.
  if (itemRowsEl.children.length === 0) addRow();
  recalcTotal();
}

function readRows() {
  return Array.from(itemRowsEl.querySelectorAll('.item-row')).map((row) => ({
    name: row.querySelector('.rowName').value.trim(),
    unit_price: Number(row.querySelector('.rowPrice').value),
    quantity: Number(row.querySelector('.rowQty').value),
  }));
}

// Yetkazib berish narxi — MAJBURIY EMAS: checkbox (#deliveryPriceEnabled)
// belgilanmaguncha narx inputi o'chirilgan (disabled) turadi va "Jami"ga
// qo'shilmaydi; belgilangandan keyingina hisobga kiradi. Standart qiymat
// 5000 so'm (kassir o'zgartira oladi) (2026-09-27, foydalanuvchi so'rovi).
const DEFAULT_DELIVERY_PRICE = 5000;

function readDeliveryPrice() {
  if (!document.getElementById('deliveryPriceEnabled').checked) return 0;
  const raw = document.getElementById('deliveryPriceInput').value;
  const price = Number(raw);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}

document.getElementById('deliveryPriceEnabled').addEventListener('change', (e) => {
  document.getElementById('deliveryPriceInput').disabled = !e.target.checked;
  recalcTotal();
});

function recalcTotal() {
  const itemsTotal = readRows().reduce((sum, it) => {
    if (!it.name || !Number.isFinite(it.unit_price) || !Number.isFinite(it.quantity)) return sum;
    if (it.unit_price <= 0 || it.quantity <= 0) return sum;
    return sum + it.unit_price * it.quantity;
  }, 0);
  document.getElementById('totalAmount').textContent = fmtMoney(itemsTotal + readDeliveryPrice());
}

function resetForm() {
  itemRowsEl.innerHTML = '';
  addRow();
  document.getElementById('customerPhoneInput').value = '';
  document.getElementById('billNoteInput').value = '';
  document.getElementById('billReasonInput').value = '';
  document.getElementById('deliveryPriceEnabled').checked = false;
  document.getElementById('deliveryPriceInput').value = String(DEFAULT_DELIVERY_PRICE);
  document.getElementById('deliveryPriceInput').disabled = true;
  recalcTotal();
}

itemRowsEl.addEventListener('input', recalcTotal);
document.getElementById('deliveryPriceInput').addEventListener('input', recalcTotal);
itemRowsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.remove-item');
  if (btn) removeRow(btn.closest('.item-row'));
});

document.getElementById('addRowBtn').addEventListener('click', addRow);

// ---------------- "📋 Menyu" — menyudan tanlab qator to'ldirish ----------------
// 2026-09-09'da qo'shildi: GET /kassir/menu'dan (server/routes/kassirMenu.js,
// afitsiantnikiga o'xshash, faqat o'qish) kategoriya+taomlarni olib, bosilgan
// taomni bo'sh qatorga (yoki xuddi shu nom/narxdagi qatorga miqdorini +1
// qilib) yozadi — nomi/narxini qo'lda terish shart bo'lmasin.
let menuCategories = [];
let menuActiveCat = null;
// Sarlavha qatoridagi dumaloq tugma bilan ochiladigan/yopiladigan qidiruv
// (2026-10-03, foydalanuvchi so'rovi) — bo'sh bo'lmasa taom nomi (yoki uning
// "turi"/variant nomi) bo'yicha FAQAT hozir ochiq turgan bo'lim (tab) ichidan
// qidiradi (qarang: searchMenuItems()) — tablar qidiruv paytida ham ko'rinib,
// bosiladigan bo'lib qoladi.
let menuSearchQuery = '';

const MP_SEARCH_ICON_SVG = '<svg class="mp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

function ensureMenuModal() {
  let el = document.getElementById('menuPickModal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'menuPickModal';
    el.className = 'modal-backdrop hidden';
    el.innerHTML = `
      <div class="modal menu-pick-modal">
        <div class="menu-pick-header">
          <div class="menu-pick-title-row">
            <h2>Menyudan tanlash</h2>
            <button type="button" class="mp-search-toggle" id="menuPickSearchToggle" aria-label="Qidirish">${MP_SEARCH_ICON_SVG}</button>
          </div>
          <div class="menu-pick-selected" id="menuPickSelected"></div>
        </div>
        <div class="menu-pick-search hidden" id="menuPickSearchRow">
          <div class="mp-search-box">
            ${MP_SEARCH_ICON_SVG}
            <input type="text" id="menuPickSearchInput" placeholder="Taom nomini qidirish...">
          </div>
        </div>
        <div class="tabs" id="menuPickTabs"></div>
        <div id="menuPickItems" class="menu-pick-items"><p class="dim">Yuklanmoqda...</p></div>
        <div class="modal-actions">
          <button class="btn primary" id="menuPickClose">Yopish</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    // Modal yopilganda ochiq turgan "Turlari" panellari ham yopib qo'yiladi —
    // keyingi safar "📋 Menyu" bosilganda hammasi yopiq holatda boshlanadi
    // (2026-09-15, foydalanuvchi so'rovi). Qidiruv ham shu bilan birga
    // tozalanadi (2026-10-03).
    const finish = () => {
      el.classList.add('hidden');
      expandedKassirItems.clear();
      closeMenuSearch();
    };
    el.querySelector('#menuPickClose').addEventListener('click', finish);
    el.addEventListener('click', (e) => { if (e.target === el) finish(); });

    const searchToggle = el.querySelector('#menuPickSearchToggle');
    const searchRow = el.querySelector('#menuPickSearchRow');
    const searchInput = el.querySelector('#menuPickSearchInput');
    searchToggle.addEventListener('click', () => {
      if (searchRow.classList.contains('hidden')) {
        searchRow.classList.remove('hidden');
        searchToggle.classList.add('active');
        searchInput.focus();
      } else {
        closeMenuSearch();
      }
    });
    searchInput.addEventListener('input', () => {
      menuSearchQuery = searchInput.value;
      renderMenuPickItems();
    });
  }
  return el;
}

function closeMenuSearch() {
  menuSearchQuery = '';
  const row = document.getElementById('menuPickSearchRow');
  const toggle = document.getElementById('menuPickSearchToggle');
  const input = document.getElementById('menuPickSearchInput');
  if (row) row.classList.add('hidden');
  if (toggle) toggle.classList.remove('active');
  if (input) input.value = '';
}

function renderMenuPickTabs() {
  const tabs = document.getElementById('menuPickTabs');
  tabs.innerHTML = menuCategories.map((c) => `
    <button type="button" data-cat="${c.id}" class="${c.id === menuActiveCat ? 'active' : ''}">${escapeHtml(c.name)}</button>
  `).join('');
  tabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      menuActiveCat = Number(btn.dataset.cat);
      renderMenuPickTabs();
      renderMenuPickItems();
    });
  });
}

// Taom "turi" (variant, 2026-09-09) — asosiy taom har doim ko'rinadi, agar
// unga bog'liq turlari bo'lsa pastida "Turlari (N)" tugmasi chiqadi, bosilsa
// o'sha turlar ham (o'z narxi bilan, alohida tanlanadigan) ochiladi. Kartochka
// render mantiqi ../menu-picker.js'da (afitsiantning buyurtma sahifasi bilan
// umumiy, 2026-09-15). Bir vaqtda faqat BITTA taomning turlari ochiq turadi
// (akkordeon) — yangisi ochilganda avvalgisi avtomatik yopiladi, va modal
// yopilganda (ensureMenuModal'dagi finish()) hammasi tozalanadi.
let expandedKassirItems = new Set();

const menuPickHandlers = {
  onAdd: pickMenuItem,
  onRemove: decrementMenuItem,
  onInfo: showKassirItemInfo,
  onToggleVariants: (id) => {
    const wasOpen = expandedKassirItems.has(id);
    expandedKassirItems.clear();
    if (!wasOpen) expandedKassirItems.add(id);
    renderMenuPickItems();
  },
};

// Taom nomi (yoki uning "turi"/variant nomi) bo'yicha FAQAT hozir ochiq
// turgan bo'lim (tab, menuActiveCat) ichidan moslarini topadi (2026-10-03,
// foydalanuvchi so'rovi — "qaysi bo'limda tursa o'sha bo'limdan qidirsin").
// Bo'lim almashtirilsa, qidiruv matni saqlanib qoladi, lekin natija yangi
// bo'limga qarab qayta hisoblanadi (tablar qidiruv paytida ham ko'rinadi).
// Moslik FAQAT so'z BOSHIDAN (prefiks) qidiriladi, ichidan emas — masalan "la"
// "Lavash"ni topadi, lekin "avash" topmaydi (2026-10-03, foydalanuvchi so'rovi).
function searchMenuItems(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const cat = menuCategories.find((c) => c.id === menuActiveCat);
  if (!cat) return [];
  return cat.items.filter((it) => {
    const nameMatch = it.name.toLowerCase().startsWith(q);
    const variantMatch = it.variants && it.variants.some((v) => v.name.toLowerCase().startsWith(q));
    return nameMatch || variantMatch;
  });
}

function renderMenuPickItems() {
  const itemsEl = document.getElementById('menuPickItems');
  if (menuSearchQuery.trim()) {
    const matched = searchMenuItems(menuSearchQuery);
    if (matched.length === 0) {
      itemsEl.innerHTML = '<p class="dim">Hech narsa topilmadi.</p>';
      return;
    }
    mpRenderGrid(itemsEl, matched, expandedKassirItems, menuPickHandlers, getMenuPickQty);
    return;
  }
  const cat = menuCategories.find((c) => c.id === menuActiveCat);
  mpRenderGrid(itemsEl, cat ? cat.items : [], expandedKassirItems, menuPickHandlers, getMenuPickQty);
}

// Bitta menyu taomi (yoki uning turi) "Qatorlar"da hozir nechta kiritilganini
// topadi — nomi+narxi bo'yicha moslashtiradi (pickMenuItem bilan bir xil
// mantiq, chunki qatorlarda menyu taomining id'si saqlanmaydi, faqat
// nomi/narxi/miqdori).
function findRowForMenuItem(item) {
  if (!item) return null;
  return Array.from(itemRowsEl.querySelectorAll('.item-row')).find((row) =>
    row.querySelector('.rowName').value.trim() === item.name
    && Number(row.querySelector('.rowPrice').value) === item.price
  ) || null;
}

// Kartochkadagi "− <son> +" stepper uchun — menyu taomining id'si bo'yicha
// hozirgi miqdorni qaytaradi (2026-09-26, foydalanuvchi so'rovi).
function getMenuPickQty(menuItemId) {
  const item = mpFindItem(menuCategories, menuActiveCat, menuItemId);
  const row = findRowForMenuItem(item);
  return row ? Number(row.querySelector('.rowQty').value) || 0 : 0;
}

// Modal ochiq turgan paytda tepada (sarlavha yonida, o'ng burchakda) hozircha
// tanlangan taomlarni ko'rsatib turadi — kassir modalni yopmasdan "nimalarni
// qo'shdim" deb tekshira oladi (2026-09-26, foydalanuvchi so'rovi).
function renderMenuPickSelected() {
  const el = document.getElementById('menuPickSelected');
  if (!el) return;
  const items = readRows().filter((it) => it.name && Number(it.quantity) > 0);
  el.innerHTML = items.map((it) => `<span class="menu-pick-chip">${escapeHtml(it.name)} <b>×${it.quantity}</b></span>`).join('');
}

function showKassirItemInfo(menuItemId) {
  const item = mpFindItem(menuCategories, menuActiveCat, menuItemId);
  if (!item) return;
  const body = (item.description && item.description.trim())
    ? item.description.trim()
    : "Bu taom haqida hali ma'lumot kiritilmagan.";
  const title = item.volume ? `${item.name} (${item.volume})` : item.name;
  showInfoModal(title, body);
}

function pickMenuItem(menuItemId) {
  const item = mpFindItem(menuCategories, menuActiveCat, menuItemId);
  if (!item) return;

  const existing = findRowForMenuItem(item);
  if (existing) {
    const qtyInput = existing.querySelector('.rowQty');
    qtyInput.value = String((Number(qtyInput.value) || 0) + 1);
  } else {
    const rows = Array.from(itemRowsEl.querySelectorAll('.item-row'));
    const emptyRow = rows.find((row) => !row.querySelector('.rowName').value.trim());
    const target = emptyRow || rowTemplate();
    if (!emptyRow) itemRowsEl.appendChild(target);
    target.querySelector('.rowName').value = item.name;
    target.querySelector('.rowPrice').value = item.price;
    target.querySelector('.rowQty').value = '1';
  }
  recalcTotal();
  renderMenuPickSelected();
  renderMenuPickItems();
}

// Kartochkadagi "−" tugmasi — miqdorni 1ga kamaytiradi, 0'ga tushsa qatorning
// o'zi olib tashlanadi (removeRow — kamida bitta bo'sh qator qoladi qoidasi
// bilan) (2026-09-26, foydalanuvchi so'rovi).
function decrementMenuItem(menuItemId) {
  const item = mpFindItem(menuCategories, menuActiveCat, menuItemId);
  const existing = findRowForMenuItem(item);
  if (!existing) return;

  const qtyInput = existing.querySelector('.rowQty');
  const nextQty = (Number(qtyInput.value) || 0) - 1;
  if (nextQty <= 0) {
    removeRow(existing);
  } else {
    qtyInput.value = String(nextQty);
    recalcTotal();
  }
  renderMenuPickSelected();
  renderMenuPickItems();
}

async function openMenuPicker() {
  const el = ensureMenuModal();
  el.classList.remove('hidden');
  renderMenuPickSelected();
  document.getElementById('menuPickItems').innerHTML = '<p class="dim">Yuklanmoqda...</p>';
  // Har safar ochilganda QAYTA so'raladi (kesh yo'q) — kassir sahifasi smena
  // davomida uzoq ochiq turadi, shu orada admin ombordan yangi taom qo'shishi/
  // bog'lashi mumkin; eski keshlangan ro'yxat bo'lsa yangi taom sahifa F5
  // qilinmaguncha ko'rinmay qolardi (2026-09-27, haqiqiy holat aniqlanib
  // tuzatildi). Tanlangan bo'lim (menuActiveCat) mavjud bo'lsa saqlanadi.
  try {
    menuCategories = await api('/kassir/menu');
    if (menuCategories.length === 0) {
      document.getElementById('menuPickItems').innerHTML = '<p class="dim">Menyu hali bo\'sh.</p>';
      return;
    }
    if (!menuCategories.some((c) => c.id === menuActiveCat)) {
      menuActiveCat = menuCategories[0].id;
    }
  } catch (err) {
    document.getElementById('menuPickItems').innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
    return;
  }
  renderMenuPickTabs();
  renderMenuPickItems();
}

document.getElementById('menuBtn').addEventListener('click', openMenuPicker);

document.getElementById('clearBtn').addEventListener('click', async () => {
  const ok = await customConfirm("Kiritilgan qatorlarni tozalaysizmi?");
  if (!ok) return;
  resetForm();
});

document.getElementById('createBtn').addEventListener('click', async () => {
  // Bo'sh (nomi yo'q) qatorlarni tashlab, faqat to'ldirilganlarini yuboramiz —
  // odatda oxirgi qator bo'sh qoladi (kassir "+ Qator qo'shish"ni ehtiyot
  // uchun bosib qo'ygan bo'lishi mumkin).
  const items = readRows().filter((it) => it.name);
  if (items.length === 0) {
    toast("Kamida bitta taom kiriting", 'error');
    return;
  }
  const invalid = items.find((it) => !Number.isFinite(it.unit_price) || it.unit_price <= 0
    || !Number.isFinite(it.quantity) || it.quantity <= 0);
  if (invalid) {
    toast(`"${invalid.name}" uchun narx/miqdor noto'g'ri`, 'error');
    return;
  }

  const customerPhone = document.getElementById('customerPhoneInput').value.trim() || undefined;
  const note = document.getElementById('billNoteInput').value.trim() || undefined;
  const reason = document.getElementById('billReasonInput').value.trim() || undefined;
  const deliveryPrice = readDeliveryPrice();

  // To'lov turi (naqd/karta/aralash) — "Moliya va kassa" auditi (2026-10-10),
  // kassir uchun majburiy (serverda ham tekshiriladi).
  const itemsTotal = items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0);
  const paymentInfo = await askPaymentInfo(itemsTotal + deliveryPrice);
  if (!paymentInfo) return;

  const btn = document.getElementById('createBtn');
  btn.disabled = true;
  try {
    // Takroriy-yuborish himoyasi (2026-10-10) — tugma ikki marta bosilsa
    // yoki tarmoq qayta so'rov yuborsa, server ikkinchi marta yangi chek
    // yaratmaydi (bitta bosishga bitta kalit).
    const idempotency_key = crypto.randomUUID();
    const receipt = await api('/kassir/manual-bills', { method: 'POST', body: { items, customer_phone: customerPhone, note, reason, delivery_price: deliveryPrice, idempotency_key, ...paymentInfo } });
    toast('Chek yaratildi.');
    // Chek chiqarilgandan keyin qatorlar ENDI avtomatik tozalanmaydi (2026-
    // 09-27, foydalanuvchi so'rovi) — kassir "Tozalash" tugmasini bosmaguncha
    // tanlangan mahsulotlar ekranda qoladi.
    showReceiptModal(receipt);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initNav('manual');
  resetForm();
});
