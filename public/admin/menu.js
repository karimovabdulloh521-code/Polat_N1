let categories = [];
let items = [];
let inventoryItems = []; // Ombor mahsulotlari (taom modalidagi bog'lash select'i uchun)
let editingCatId = null;
let editingItemId = null;
let itemModalCategoryId = null;
// itemModalParentId — "+ Turi qo'shish" bilan ochilganda ota taom id'si
// (2026-09-09). Yangi ASOSIY taom qo'shilayotganda yoki mavjud taom
// tahrirlanayotganda null/mos qiymatga o'rnatiladi (openItemModal()ga qarang).
let itemModalParentId = null;
let currentImageUrl = null; // taom modalida hozir tanlangan rasm URL'i (ixtiyoriy, null bo'lishi mumkin)
// O'chirilgan (is_active=0) kategoriya/taomlar bo'limi ochiq/yopiqligi —
// standart holatda yopiq (2026-09-09'da qo'shildi, pastdagi izohga qarang).
let showInactive = false;
// Har bir kategoriya (bo'lim) endi akkordeon — bir vaqtda faqat bittasi ochiq
// turadi (2026-09-27, admin ekranida kategoriyalar juda uzun/chalkash
// ko'rinayotgani sababli). null = hech qaysi ochiq emas.
let openCategoryId = null;

// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).

// "Taomlar" -> "Taom", "Shirinliklar" -> "Shirinlik", "Ichimliklar" -> "Ichimlik"
// — "+ Taom qo'shish" tugmasi endi har bir kategoriyaning o'z nomi bilan
// boshlanadi ("+ Ichimlik qo'shish" va h.k.). Ko'plik qo'shimchasi ("-lar")
// bo'lsa olib tashlanadi, bo'lmasa (masalan "burger") nomi o'zgarishsiz
// ishlatiladi.
function singularizeCategoryName(name) {
  const n = String(name || '').trim();
  return /lar$/i.test(n) ? n.slice(0, -3) : n;
}

// ?include_inactive=1 — o'chirilgan (is_active=0) kategoriya/taomlarni ham
// olib kelamiz (2026-09-09'da qo'shildi). Ilgari GET har doim faqat faol
// qatorlarni qaytarardi va admin panelida ularni ko'rish/tiklashning HECH
// QANDAY yo'li yo'q edi — buyurtma tarixi tufayli hard-delete qilib
// bo'lmaydigan (shu sabab is_active=0 qilingan) kategoriya/taom adminning
// o'zi uchun ham abadiy "yo'qolgan" bo'lib qolardi. Endi pastdagi
// renderInactiveSection() shu qatorlarni alohida ko'rsatib, ♻️ Tiklash
// tugmasi bilan qayta faollashtirish imkonini beradi.
async function loadAll() {
  const box = document.getElementById('categoryList');
  try {
    [categories, items, inventoryItems] = await Promise.all([
      api('/admin/menu/categories?include_inactive=1'),
      api('/admin/menu/items?include_inactive=1'),
      api('/admin/inventory/items').catch(() => []), // ombor bo'lmasa ham menyu ishlayversin
    ]);
    render();
  } catch (err) {
    box.innerHTML = `<p class="dim">${escapeHtml(err.message)}</p>`;
  }
}

// Bitta taom qatorini chizadi — asosiy taom UCHUN HAM, "turi" (variant) UCHUN
// HAM bir xil ko'rinish (variant biroz kichikroq/chekinib chiqadi,
// isVariant=true bo'lganda). 2026-09-09'da "turi" funksiyasi qo'shilganda
// avvalgi inline shablon shu funksiyaga chiqarildi (nested render uchun).
function renderItemRow(it, c, isVariant) {
  return `
    <div class="menu-item-row${isVariant ? ' menu-item-variant' : ''}">
      <div style="display:flex; align-items:center; gap:10px;">
        ${it.image_url ? `<img src="${escapeHtml(it.image_url)}" style="width:40px; height:40px; object-fit:cover; border-radius:var(--radius-sm); flex-shrink:0;">` : ''}
        <div>
          <div class="mi-name">${escapeHtml(it.name)}${it.volume ? ` <span class="dim" style="font-weight:400;">(${escapeHtml(it.volume)})</span>` : ''}</div>
          <div class="mi-price">${fmtMoney(it.price)}${it.cost_price != null ? ` <span class="dim" style="font-size:12px; font-weight:400;">(tan narxi ${fmtMoney(it.cost_price)}, foyda ${fmtMoney(it.price - it.cost_price)})</span>` : ''}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        ${it.inventory_item_id
          ? `<span class="badge ${it.inventory_quantity > 0 ? 'ok' : 'low'}">📦 ${escapeHtml(it.inventory_name || '')}${it.inventory_volume ? ` (${escapeHtml(it.inventory_volume)})` : ''}: ${it.inventory_quantity} ${escapeHtml(it.inventory_unit || '')}</span>`
          : c.require_inventory_link
            ? `<span class="badge low" title="Bu bo'lim faqat ombor bilan bog'langan taomlarni ko'rsatadi — bog'lanmaguncha mijoz/afitsiant menyusida yashirin">🚫 Yashirin (ombor yo'q)</span>`
            : `<label style="display:flex; align-items:center; gap:4px; font-size:12px;">
                 <input type="checkbox" data-avail="${it.id}" ${it.is_available ? 'checked' : ''}> mavjud
               </label>`}
        <button class="btn small" data-edit-item="${it.id}">✎</button>
        <button class="btn small danger" data-del-item="${it.id}">🗑</button>
      </div>
    </div>
  `;
}

// Taomlar balandligi har xil bo'lgani uchun (ba'zisida ko'p "turi" bor)
// CSS'ning tayyor ustun mexanizmi (column-width) ularni teng taqsimlay
// olmaydi — bir ustun juda uzun, boshqasi qisqa qolib, katta bo'sh joy
// paydo bo'ladi. Shu sabab klassik "masonry" mantig'i qo'lda qilingan:
// har bir taom blokini navbat bilan hozircha ENG QISQA ustunga qo'yamiz.
// Tor ekranda (bitta ustunga sig'adigan joy bo'lsa) hech narsa qilinmaydi —
// taomlar oddiy vertikal ro'yxat bo'lib qoladi.
function layoutMasonryColumns(container) {
  const COL_WIDTH = 280;
  const GAP = 24;
  const width = container.clientWidth;
  const columns = Math.max(1, Math.floor((width + GAP) / (COL_WIDTH + GAP)));
  if (columns <= 1) return;
  const blocks = Array.from(container.children);
  if (blocks.length === 0) return;
  const colHeights = new Array(columns).fill(0);
  const colEls = Array.from({ length: columns }, () => {
    const d = document.createElement('div');
    d.className = 'menu-items-col';
    return d;
  });
  // Ustunlar avval DOM'ga qo'shiladi (bo'sh holda) — shundan keyingina
  // ularning haqiqiy (tor) kengligi ma'lum bo'ladi. Har bir blokni AVVAL
  // shu tor ustunning biriga qo'yib, SHUNDAN KEYIN balandligini o'qiymiz —
  // aks holda blok hali to'liq kenglikda turgan chog'da o'lchansa, matn
  // kamroq qatorga sig'ib, ustunga tushgandagidan qisqaroq ko'rsatilib,
  // natijada ustunlar notekis (ba'zisi juda uzun, ba'zisi bo'sh) chiqib
  // qolgan edi (2026-09-27).
  container.classList.add('menu-items-columns-js');
  colEls.forEach((col) => container.appendChild(col));
  blocks.forEach((block) => {
    colEls[0].appendChild(block);
    const height = block.offsetHeight;
    let shortest = 0;
    for (let i = 1; i < columns; i++) {
      if (colHeights[i] < colHeights[shortest]) shortest = i;
    }
    if (shortest !== 0) colEls[shortest].appendChild(block);
    colHeights[shortest] += height + GAP;
  });
}

function render() {
  const box = document.getElementById('categoryList');
  const activeCategories = categories.filter((c) => c.is_active);
  if (activeCategories.length === 0 && categories.length === 0) {
    box.innerHTML = '<p class="dim">Hali kategoriya yo\'q.</p>';
    return;
  }
  const catsHtml = activeCategories.length === 0
    ? '<p class="dim">Hali faol kategoriya yo\'q.</p>'
    : activeCategories.map((c) => {
    // Faqat ASOSIY taomlar (parent_item_id yo'q) shu bo'limda to'g'ridan-to'g'ri
    // ko'rsatiladi — har birining "turi" (variant) 2026-09-09'da qo'shilgan
    // pastdagi ichma-ich ro'yxatda, "+ Turi qo'shish" tugmasi bilan chiqadi.
    const catItems = items.filter((it) => it.category_id === c.id && it.is_active && !it.parent_item_id);
    const isOpen = openCategoryId === c.id;
    return `
      <div class="card${isOpen ? ' card-open' : ''}">
        <div class="card-row">
          <div class="card-title menu-cat-toggle" data-toggle-cat="${c.id}">
            <span class="cat-chevron">${isOpen ? '▾' : '▸'}</span>
            ${escapeHtml(c.name)}${c.require_inventory_link ? ' <span class="badge ok">📦 Faqat ombor</span>' : ''}
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn small" data-edit-cat="${c.id}">Tahrirlash</button>
            <button class="btn small danger" data-del-cat="${c.id}">O'chirish</button>
          </div>
        </div>
        <div class="mt-8${isOpen ? '' : ' hidden'}">
          ${catItems.length === 0 ? '<p class="dim" style="font-size:13px;">Taom yo\'q</p>' : `<div class="menu-items-columns">${catItems.map((it) => {
            const variants = items.filter((v) => v.parent_item_id === it.id && v.is_active);
            return `<div class="menu-item-block">${renderItemRow(it, c, false)}
              <div class="menu-item-variants">
                ${variants.map((v) => renderItemRow(v, c, true)).join('')}
                <button class="btn small" data-add-variant="${it.id}">+ Turi qo'shish</button>
              </div>
            </div>`;
          }).join('')}</div>`}
          <button class="btn small mt-8" data-add-item-cat="${c.id}">+ ${escapeHtml(singularizeCategoryName(c.name))} qo'shish</button>
        </div>
      </div>
    `;
  }).join('');

  box.innerHTML = `<div class="category-grid">${catsHtml}</div>` + renderInactiveSection();

  // Ochilgan kategoriyaning taomlari — CSS multi-column (column-width) taom
  // balandliklari bir xil bo'lmagani (ba'zisida ko'p "turi" bor) sababli
  // ustunlarda katta bo'sh joy qoldirib qo'yayotgan edi. Endi haqiqiy
  // "masonry" (har yangi taom eng qisqa ustunga qo'yiladi) JS orqali
  // qilinadi — bo'sh joy qolmaydi (2026-09-27).
  if (openCategoryId != null) {
    const toggleEl = box.querySelector(`[data-toggle-cat="${openCategoryId}"]`);
    const colsEl = toggleEl ? toggleEl.closest('.card').querySelector('.menu-items-columns') : null;
    if (colsEl) layoutMasonryColumns(colsEl);
  }

  box.querySelectorAll('[data-toggle-cat]').forEach((el) => el.addEventListener('click', () => {
    const id = Number(el.dataset.toggleCat);
    openCategoryId = openCategoryId === id ? null : id;
    render();
  }));

  box.querySelectorAll('[data-edit-cat]').forEach((b) => b.addEventListener('click', () => openCatModal(Number(b.dataset.editCat))));
  box.querySelectorAll('[data-del-cat]').forEach((b) => b.addEventListener('click', () => delCategory(Number(b.dataset.delCat))));
  box.querySelectorAll('[data-avail]').forEach((b) => b.addEventListener('change', () => toggleAvailability(Number(b.dataset.avail), b.checked)));
  box.querySelectorAll('[data-edit-item]').forEach((b) => b.addEventListener('click', () => openItemModal(null, Number(b.dataset.editItem))));
  box.querySelectorAll('[data-del-item]').forEach((b) => b.addEventListener('click', () => delItem(Number(b.dataset.delItem))));
  box.querySelectorAll('[data-add-item-cat]').forEach((b) => b.addEventListener('click', () => openItemModal(Number(b.dataset.addItemCat), null)));
  box.querySelectorAll('[data-add-variant]').forEach((b) => b.addEventListener('click', () => openItemModal(null, null, Number(b.dataset.addVariant))));
  const toggleBtn = document.getElementById('toggleInactiveBtn');
  if (toggleBtn) toggleBtn.addEventListener('click', () => { showInactive = !showInactive; render(); });
  box.querySelectorAll('[data-restore-cat]').forEach((b) => b.addEventListener('click', () => restoreCategory(Number(b.dataset.restoreCat))));
  box.querySelectorAll('[data-restore-item]').forEach((b) => b.addEventListener('click', () => restoreItem(Number(b.dataset.restoreItem))));
}

// O'chirilgan (is_active=0) kategoriya/taomlar — standart holatda yig'ilgan
// (faqat soni ko'rsatiladi), "Ko'rsatish" bosilsa ochilib, har biri uchun
// ♻️ Tiklash tugmasi chiqadi (2026-09-09'da qo'shildi — GET /categories va
// GET /items o'chirilganlarni butunlay yashirgani uchun, ilgari bunday
// qatorni admin panelidan qayta tiklashning HECH QANDAY yo'li yo'q edi).
function renderInactiveSection() {
  const inactiveCats = categories.filter((c) => !c.is_active);
  const inactiveItems = items.filter((it) => !it.is_active);
  if (inactiveCats.length === 0 && inactiveItems.length === 0) return '';
  return `
    <div class="card" style="margin-top:16px;">
      <div class="card-row">
        <div class="card-title dim">🗑 O'chirilganlar (${inactiveCats.length + inactiveItems.length})</div>
        <button class="btn small" id="toggleInactiveBtn">${showInactive ? 'Yashirish' : "Ko'rsatish"}</button>
      </div>
      ${showInactive ? `
        <div class="mt-8">
          ${inactiveCats.map((c) => `
            <div class="menu-item-row">
              <div class="mi-name dim">${escapeHtml(c.name)} <span class="dim" style="font-size:12px;">(bo'lim)</span></div>
              <button class="btn small" data-restore-cat="${c.id}">♻️ Tiklash</button>
            </div>
          `).join('')}
          ${inactiveItems.map((it) => `
            <div class="menu-item-row">
              <div class="mi-name dim">${escapeHtml(it.name)}</div>
              <button class="btn small" data-restore-item="${it.id}">♻️ Tiklash</button>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

async function restoreCategory(id) {
  try {
    await api(`/admin/menu/categories/${id}`, { method: 'PUT', body: { is_active: true } });
    toast('Tiklandi');
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function restoreItem(id) {
  try {
    await api(`/admin/menu/items/${id}`, { method: 'PUT', body: { is_active: true } });
    toast('Tiklandi');
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------- Kategoriya modal ----------------

function openCatModal(id) {
  editingCatId = id;
  const cat = categories.find((c) => c.id === id);
  document.getElementById('catModalTitle').textContent = cat ? 'Kategoriyani tahrirlash' : 'Yangi kategoriya';
  document.getElementById('catName').value = cat ? cat.name : '';
  document.getElementById('catSort').value = cat ? cat.sort_order : 0;
  document.getElementById('catRequireInventory').checked = cat ? !!cat.require_inventory_link : false;
  document.getElementById('catModal').classList.remove('hidden');
}
function closeCatModal() { document.getElementById('catModal').classList.add('hidden'); editingCatId = null; }

document.getElementById('addCatBtn').addEventListener('click', () => openCatModal(null));
document.getElementById('catCancelBtn').addEventListener('click', closeCatModal);
document.getElementById('catSaveBtn').addEventListener('click', async () => {
  const name = document.getElementById('catName').value.trim();
  const sort_order = Number(document.getElementById('catSort').value) || 0;
  const require_inventory_link = document.getElementById('catRequireInventory').checked;
  if (!name) return toast('Nomini kiriting', 'error');
  try {
    if (editingCatId) {
      await api(`/admin/menu/categories/${editingCatId}`, { method: 'PUT', body: { name, sort_order, require_inventory_link } });
    } else {
      await api('/admin/menu/categories', { method: 'POST', body: { name, sort_order, require_inventory_link } });
    }
    closeCatModal();
    toast('Saqlandi');
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function delCategory(id) {
  if (!confirm("Kategoriyani o'chirasizmi? (unga tegishli taomlar ko'rinmay qoladi)")) return;
  try {
    await api(`/admin/menu/categories/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------- Taom modal ----------------

// parentId — "+ Turi qo'shish" tugmasi bosilganda beriladi (2026-09-09):
// itemId=null, parentId=<ota taom id'si> bo'lsa yangi VARIANT qo'shiladi
// (kategoriya avtomatik ota taomnikidan olinadi, foydalanuvchi tanlamaydi).
// Mavjud taom tahrirlanayotganda (itemId berilgan) uning parent_item_id'si
// o'zgarishsiz saqlanadi — bu modal orqali variant boshqa taomga "ko'chirilmaydi".
function openItemModal(categoryId, itemId, parentId) {
  editingItemId = itemId;
  const item = itemId ? items.find((it) => it.id === itemId) : null;
  const parentItem = (!item && parentId) ? items.find((it) => it.id === parentId) : null;
  itemModalParentId = item ? (item.parent_item_id || null) : (parentItem ? parentItem.id : null);
  itemModalCategoryId = item ? item.category_id : (parentItem ? parentItem.category_id : categoryId);
  // Sarlavha ham "+ Ichimlik qo'shish" tugmasi bilan bir xil mantiqda —
  // kategoriya nomiga moslab chiqadi ("Yangi Ichimlik", "Ichimlikni tahrirlash").
  const cat = categories.find((c) => c.id === itemModalCategoryId);
  const catLabel = cat ? singularizeCategoryName(cat.name) : 'Taom';
  const parentHintEl = document.getElementById('itemParentHint');
  if (parentItem) {
    document.getElementById('itemModalTitle').textContent = `"${parentItem.name}" uchun yangi tur`;
    parentHintEl.textContent = `Bu — "${parentItem.name}" taomining bir turi. Mijoz/afitsiant uni "${parentItem.name}" ustidagi "Turlari" tugmasi bosilganda ko'radi.`;
    parentHintEl.classList.remove('hidden');
  } else {
    document.getElementById('itemModalTitle').textContent = item ? `${catLabel}ni tahrirlash` : `Yangi ${catLabel}`;
    parentHintEl.classList.add('hidden');
    parentHintEl.textContent = '';
  }
  document.getElementById('itemName').value = item ? item.name : '';
  document.getElementById('itemVolume').value = item ? (item.volume || '') : '';
  document.getElementById('itemCostPrice').value = item && item.cost_price != null ? item.cost_price : '';
  document.getElementById('itemPrice').value = item ? item.price : '';
  document.getElementById('itemSort').value = item ? item.sort_order : 0;
  document.getElementById('itemDescription').value = item ? (item.description || '') : '';
  renderInventorySelect(item ? item.inventory_item_id : null);
  document.getElementById('itemImageFile').value = '';
  document.getElementById('itemImageCameraFile').value = '';
  document.getElementById('itemImageStatus').textContent = '';
  currentImageUrl = item ? (item.image_url || null) : null;
  updateImagePreview();
  document.getElementById('itemModal').classList.remove('hidden');
}
function closeItemModal() { document.getElementById('itemModal').classList.add('hidden'); editingItemId = null; itemModalParentId = null; }

// Taom modalidagi "Ombor mahsuloti bilan bog'lash" select'ini har safar ochilganda
// joriy ombor ro'yxati bilan to'ldiradi (faol mahsulotlar + hozir tanlangan bo'lsa
// o'chirilgan bo'lsa ham ko'rinishi uchun).
function renderInventorySelect(selectedId) {
  const sel = document.getElementById('itemInventory');
  const options = ['<option value="">— Bog\'lanmagan (mavjudlik qo\'lda boshqariladi) —</option>']
    .concat(inventoryItems.map((inv) => `<option value="${inv.id}">${escapeHtml(inv.name)}${inv.volume ? ` (${escapeHtml(inv.volume)})` : ''} — ${inv.quantity} ${escapeHtml(inv.unit)}</option>`));
  sel.innerHTML = options.join('');
  sel.value = selectedId ? String(selectedId) : '';
  applyInventoryPriceLock();
}

// Ombor mahsuloti tanlangan bo'lsa — narx VA tan narx maydonlari O'ZI KIRITILMAYDI,
// ombordagi sotuv/tan narxidan avtomatik to'ldirilib "readonly" qilinadi (server ham
// buni mustaqil kafolatlaydi — adminMenu.js, mijoz/admin yuborgan narxga ishonmaydi).
// Bog'lanish uzilsa (bo'sh tanlansa) — ikkala maydon ham yana qo'lda tahrirlanadigan bo'ladi.
function applyInventoryPriceLock() {
  const sel = document.getElementById('itemInventory');
  const priceInput = document.getElementById('itemPrice');
  const hint = document.getElementById('itemPriceHint');
  const costInput = document.getElementById('itemCostPrice');
  const costHint = document.getElementById('itemCostPriceHint');
  const invId = sel.value ? Number(sel.value) : null;
  const inv = invId ? inventoryItems.find((i) => i.id === invId) : null;
  if (inv) {
    priceInput.value = inv.sale_price;
    priceInput.readOnly = true;
    hint.textContent = `Narx "${inv.name}" ombor mahsulotining sotuv narxidan avtomatik olinadi (o'zgartirish uchun Ombor bo'limiga o'ting).`;
    costInput.value = inv.cost_price != null ? inv.cost_price : '';
    costInput.readOnly = true;
    costHint.textContent = `Tan narx "${inv.name}" ombor mahsulotidan avtomatik olinadi (o'zgartirish uchun Ombor bo'limiga o'ting).`;
  } else {
    priceInput.readOnly = false;
    hint.textContent = '';
    costInput.readOnly = false;
    costHint.textContent = '';
  }
}
document.getElementById('itemInventory').addEventListener('change', applyInventoryPriceLock);

function updateImagePreview() {
  const img = document.getElementById('itemImagePreview');
  if (currentImageUrl) {
    img.src = currentImageUrl;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
    img.removeAttribute('src');
  }
}

document.getElementById('itemCancelBtn').addEventListener('click', closeItemModal);

// Rasm — MAJBURIY EMAS: fayl tanlangan zahoti (Saqlash bosilishidan oldin)
// alohida (multipart, oddiy JSON api() orqali emas) so'rov bilan yuklanadi,
// natijada kelgan URL keyin taom saqlanganda yuboriladi.
// Ikkita manba bor: galereyadan tanlash va kamerada bevosita olish (capture="environment") —
// ikkalasi ham bir xil yuklash funksiyasiga ulanadi.
async function handleItemImageInputChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('itemImageStatus');
  statusEl.textContent = 'Yuklanmoqda...';
  try {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${API_BASE}api/admin/menu/upload-image`, { method: 'POST', body: form, credentials: 'same-origin' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || 'Rasm yuklashda xatolik');
    currentImageUrl = data.url;
    updateImagePreview();
    statusEl.textContent = 'Rasm yuklandi.';
  } catch (err) {
    statusEl.textContent = '';
    toast(err.message, 'error');
    e.target.value = '';
  }
}
document.getElementById('itemImageFile').addEventListener('change', handleItemImageInputChange);
document.getElementById('itemImageCameraFile').addEventListener('change', handleItemImageInputChange);

document.getElementById('itemImageRemoveBtn').addEventListener('click', () => {
  currentImageUrl = null;
  document.getElementById('itemImageFile').value = '';
  document.getElementById('itemImageCameraFile').value = '';
  document.getElementById('itemImageStatus').textContent = '';
  updateImagePreview();
});

document.getElementById('itemSaveBtn').addEventListener('click', async () => {
  const name = document.getElementById('itemName').value.trim();
  const volume = document.getElementById('itemVolume').value.trim();
  const costPriceRaw = document.getElementById('itemCostPrice').value.trim();
  const cost_price = costPriceRaw === '' ? null : Number(costPriceRaw);
  const price = Number(document.getElementById('itemPrice').value);
  const sort_order = Number(document.getElementById('itemSort').value) || 0;
  const description = document.getElementById('itemDescription').value.trim();
  const image_url = currentImageUrl || '';
  const inventorySelectVal = document.getElementById('itemInventory').value;
  const inventory_item_id = inventorySelectVal ? Number(inventorySelectVal) : null;
  if (!name) return toast('Nomini kiriting', 'error');
  if (!Number.isFinite(price) || price < 0) return toast("Sotuv narxini to'g'ri kiriting", 'error');
  if (cost_price !== null && (!Number.isFinite(cost_price) || cost_price < 0)) return toast("Tan narxni to'g'ri kiriting", 'error');
  try {
    if (editingItemId) {
      await api(`/admin/menu/items/${editingItemId}`, { method: 'PUT', body: { name, price, cost_price, sort_order, description, image_url, volume, inventory_item_id } });
    } else {
      await api('/admin/menu/items', { method: 'POST', body: { category_id: itemModalCategoryId, name, price, cost_price, sort_order, description, image_url, volume, inventory_item_id, parent_item_id: itemModalParentId } });
    }
    closeItemModal();
    toast('Saqlandi');
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function toggleAvailability(id, checked) {
  try {
    await api(`/admin/menu/items/${id}/availability`, { method: 'PATCH', body: { is_available: checked } });
  } catch (err) {
    toast(err.message, 'error');
    loadAll();
  }
}

async function delItem(id) {
  if (!confirm("Taomni o'chirasizmi?")) return;
  try {
    await api(`/admin/menu/items/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('menu');
  loadAll();
});
