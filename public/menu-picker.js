// Umumiy "menyu tanlash" kartochka komponenti (2026-09-15) — afitsiant
// (waiter/order.js, to'liq sahifada) VA kassir (kassir/manual.js, "📋 Menyu"
// modali ichida) bitta xil vizual/render mantiqidan foydalanadi, shu sabab
// bu yerga ajratildi. escapeHtml()/fmtMoney() — ../app.js'dan global.
//
// Ishlatilishi (ikkalasida ham bir xil):
//   mpRenderTabs(tabsEl, categories, activeCategoryId, onSelectCategory)
//   mpRenderGrid(itemsEl, items, expandedSet, { onAdd, onRemove, onInfo, onToggleVariants }, getQty)
//   mpFindItem(categories, categoryId, itemId)  — asosiy taom yoki uning turi (variant)
//
// getQty(id) — ixtiyoriy, chaqiruvchi tomonda "bu taomdan hozir nechta
// tanlangan" sonini qaytaradi. Berilmasa (yoki 0 qaytarsa) kartochkada oddiy
// yagona "+" tugma chiqadi; 0'dan katta bo'lsa o'rniga "− <son> +" stepper
// chiqadi (2026-09-26, foydalanuvchi so'rovi — kassir "Hisoblash" modalida
// nechta tanlanganini kartochkaning o'zida ko'rish uchun).

function mpRenderTabs(tabsEl, categories, activeCategoryId, onSelect) {
  tabsEl.innerHTML = categories.map((c) => `
    <button type="button" data-cat="${c.id}" class="${c.id === activeCategoryId ? 'active' : ''}">${escapeHtml(c.name)}</button>
  `).join('');
  tabsEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(Number(btn.dataset.cat)));
  });
}

function mpCardImage(it) {
  if (it.image_url) {
    return `<div class="mp-card-img-wrap"><img src="${escapeHtml(it.image_url)}" class="mp-card-img" loading="lazy" alt=""></div>`;
  }
  const letter = (it.name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="mp-card-img-wrap noimg"><span class="mp-card-img-letter">${escapeHtml(letter)}</span></div>`;
}

// hasVariants/expanded — "Turlari (N)" tugmasi va uning ochiq paneli endi
// kartochkaning O'ZI ICHIDA (bir xil chegara ichida, pastki qator sifatida)
// chiqadi, tashqarida ajralib osilib turmaydi (2026-09-15, foydalanuvchi
// so'rovi bilan).
// available/qty asosida "+" (hech narsa tanlanmagan) yoki "− <son> +" (kamida
// bitta tanlangan) boshqaruvini chiqaradi. variantRow=true bo'lsa "Turlari"
// panelidagi kichikroq tugma klasslaridan (.mp-vr-add) foydalanadi.
function mpQtyControl(id, available, qty, variantRow) {
  if (!available) {
    return variantRow
      ? `<button type="button" class="mp-vr-add" disabled>—</button>`
      : `<button type="button" class="mp-add-btn" disabled>—</button>`;
  }
  if (qty > 0) {
    return `
      <div class="qty-stepper mp-qty-stepper">
        <button type="button" data-remove="${id}">−</button>
        <span class="qty-val">${qty}</span>
        <button type="button" data-add="${id}">+</button>
      </div>
    `;
  }
  return variantRow
    ? `<button type="button" class="mp-vr-add" data-add="${id}">+</button>`
    : `<button type="button" class="mp-add-btn" data-add="${id}">+</button>`;
}

function mpRenderCard(it, hasVariants, expanded, qtyOf) {
  const available = it.is_available !== false;
  return `
    <div class="mp-card${available ? '' : ' unavailable'}">
      ${mpCardImage(it)}
      <div class="mp-card-body" data-info="${it.id}">
        <div class="mp-card-name">${escapeHtml(it.name)}${it.volume ? ` <span class="mp-volume">(${escapeHtml(it.volume)})</span>` : ''}${available ? '' : ' <span class="badge low">Tugadi</span>'}</div>
        <div class="mp-card-row">
          <span class="mp-card-price">${fmtMoney(it.price)}</span>
          ${mpQtyControl(it.id, available, qtyOf(it.id), false)}
        </div>
      </div>
      ${hasVariants ? `
        <button type="button" class="mp-variants-toggle${expanded ? ' open' : ''}" data-toggle-variants="${it.id}">${expanded ? 'Turlarini yashirish' : `Turlari (${it.variants.length})`}</button>
        ${expanded ? `<div class="mp-variants-panel">${it.variants.map((v) => mpRenderVariantRow(v, qtyOf(v.id))).join('')}</div>` : ''}
      ` : ''}
    </div>
  `;
}

// Nomi TEPADA, o'z to'liq eniga ega alohida qatorda (uzun nomlar ham to'liq
// o'qiladi) — narxi va +/− tugmasi esa PASTDA, ikkinchi qatorda (2026-09-26,
// foydalanuvchi so'rovi: avvalgi bir qatorli joylashuvda stepper matnni
// siqib, uzun nomlar kesilib qolardi).
function mpRenderVariantRow(v, qty) {
  const available = v.is_available !== false;
  return `
    <div class="mp-variant-row">
      <div class="mp-vr-info" data-info="${v.id}">
        <div class="mp-vr-name">${escapeHtml(v.name)}${v.volume ? ` <span class="mp-volume">(${escapeHtml(v.volume)})</span>` : ''}${available ? '' : ' <span class="badge low">Tugadi</span>'}</div>
      </div>
      <div class="mp-vr-bottom">
        <span class="mp-vr-price">${fmtMoney(v.price)}</span>
        ${mpQtyControl(v.id, available, qty, true)}
      </div>
    </div>
  `;
}

// items: bitta kategoriyaning taomlar ro'yxati (har birida ixtiyoriy .variants[]).
// expandedSet: Set<number> — chaqiruvchi tomonda saqlanadigan "ochiq turlar" holati.
// handlers: { onAdd(id), onRemove(id) [ixtiyoriy], onInfo(id) [ixtiyoriy], onToggleVariants(id) }
// getQty(id) — ixtiyoriy, yuqoridagi fayl boshidagi izohga qarang.
function mpRenderGrid(itemsEl, items, expandedSet, handlers, getQty) {
  const qtyOf = getQty || (() => 0);
  if (!items || items.length === 0) {
    itemsEl.innerHTML = '<p class="dim">Bu bo\'limda taom yo\'q.</p>';
    return;
  }
  // Grid ICHKI o'ralgan <div class="mp-grid"> ustida quriladi, itemsEl'ning
  // o'zida EMAS — kassir modalida itemsEl (#menuPickItems) o'zi flex-child
  // (flex:1 1 auto; overflow-y:auto), va bunday holatda CSS Grid'ni to'g'ridan
  // -to'g'ri O'SHA elementga qo'yish qatorlar balandligini juda kichik (2026-
  // 09-15'da haqiqiy rasmlar bilan sinab topilgan — kartochkalar bir-birining
  // ustiga chiqib qolgan edi) hisoblashiga olib kelardi. Ichki wrapper bu
  // ikki konsern (tashqi flex/scroll va ichki grid)ni butunlay ajratadi.
  itemsEl.innerHTML = `<div class="mp-grid">${items.map((it) => {
    const hasVariants = it.variants && it.variants.length > 0;
    const expanded = expandedSet.has(it.id);
    return mpRenderCard(it, hasVariants, expanded, qtyOf);
  }).join('')}</div>`;

  // mp-add-btn/mp-qty-stepper .mp-card-body (data-info) ICHIDA joylashgan —
  // stopPropagation bo'lmasa, bosilganda klik yuqoriga ko'tarilib info-modalni
  // ham ochib yuboradi (mp-variant-row'da bunday muammo yo'q, u yerda tugmalar
  // info blokining opa-singlisi, ichida emas).
  itemsEl.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onAdd(Number(btn.dataset.add));
    });
  });
  if (handlers.onRemove) {
    itemsEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.onRemove(Number(btn.dataset.remove));
      });
    });
  }
  if (handlers.onInfo) {
    itemsEl.querySelectorAll('[data-info]').forEach((el) => {
      el.addEventListener('click', () => handlers.onInfo(Number(el.dataset.info)));
    });
  }
  itemsEl.querySelectorAll('[data-toggle-variants]').forEach((btn) => {
    btn.addEventListener('click', () => handlers.onToggleVariants(Number(btn.dataset.toggleVariants)));
  });
}

function mpFindItem(categories, categoryId, itemId) {
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return null;
  for (const it of cat.items) {
    if (it.id === itemId) return it;
    const v = it.variants && it.variants.find((x) => x.id === itemId);
    if (v) return v;
  }
  return null;
}
