// QR skanerlab ochiladigan yengil menyu sahifasi — login shart emas, menu.js'ni
// (savat/checkout) ulamaydi, mustaqil va kichik. FAQAT O'QISH: taomni ko'rish,
// qidirish, bo'limlar orasida yurish — savatga qo'shish tugmasi yo'q
// (2026-10-15, yangi "menu.css" dizayni bilan qayta qurildi — avvalgi versiya
// "Holat — 2026-10-10"da qo'shilgan edi).
(function () {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtSom(n) {
    return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";
  }
  function normalizeSearch(s) {
    return String(s || '').toLowerCase().replace(/[ʻʼ'’`]/g, '');
  }
  function itemMatchesSearch(it, q) {
    if (normalizeSearch(it.name).includes(q)) return true;
    return (it.variants || []).some((v) => normalizeSearch(v.name).includes(q));
  }

  const tableId = new URLSearchParams(window.location.search).get('table');
  const tableNameEl = document.getElementById('tmTableName');
  const toolbarEl = document.getElementById('tmToolbar');
  const searchInput = document.getElementById('tmSearchInput');
  const catsEl = document.getElementById('tmCats');
  const mainEl = document.getElementById('tmMain');

  const itemBackdrop = document.getElementById('tmItemBackdrop');
  const itemSheet = document.getElementById('tmItemSheet');
  const itemClose = document.getElementById('tmItemClose');
  const itemImgWrap = document.getElementById('tmItemImgWrap');
  const itemNameEl = document.getElementById('tmItemName');
  const itemVolumeEl = document.getElementById('tmItemVolume');
  const itemDescEl = document.getElementById('tmItemDesc');
  const variantWrap = document.getElementById('tmVariantWrap');
  const variantListEl = document.getElementById('tmVariantList');

  let categories = [];
  const itemsById = new Map();
  let activeCatId = null;
  let searchQuery = '';
  const root = document.querySelector('.zfm-root');

  let overlayReturnFocus = null;
  function openOverlay() {
    overlayReturnFocus = document.activeElement;
    itemBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    itemClose.focus();
  }
  function closeOverlay() {
    itemBackdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (overlayReturnFocus && document.contains(overlayReturnFocus)) overlayReturnFocus.focus();
  }
  itemClose.addEventListener('click', closeOverlay);
  itemBackdrop.addEventListener('click', (e) => { if (e.target === itemBackdrop) closeOverlay(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && itemBackdrop.classList.contains('open')) closeOverlay();
    if (e.key === 'Tab' && itemBackdrop.classList.contains('open')) {
      const f = itemSheet.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  function measureToolbar() {
    root.style.setProperty('--zfm-toolbar-h', toolbarEl.offsetHeight + 'px');
  }
  measureToolbar();
  if (window.ResizeObserver) new ResizeObserver(measureToolbar).observe(toolbarEl);
  else window.addEventListener('resize', measureToolbar);

  function cardImageHtml(it, cls) {
    if (it.image) return `<div class="${cls}"><img src="${escapeHtml(it.image)}" alt="${escapeHtml(it.name)}" loading="lazy" decoding="async"></div>`;
    const letter = (it.name || '?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="${cls} no-image"><span>${escapeHtml(letter)}</span></div>`;
  }

  function itemOptions(it) {
    const variants = it.variants || [];
    return variants.length > 0 ? [{ id: it.id, name: it.name, price: it.price, available: it.available }, ...variants] : [it];
  }

  function cardHtml(it) {
    const hasVariants = (it.variants || []).length > 0;
    const options = itemOptions(it);
    const availableOptions = options.filter((o) => o.available);
    const priceBasis = availableOptions.length ? availableOptions : options;
    const minPrice = Math.min(...priceBasis.map((o) => o.price));
    const cardAvailable = hasVariants ? options.some((o) => o.available) : it.available;

    return `
      <button type="button" class="zfm-card${cardAvailable ? '' : ' is-unavailable'}" data-item-card="${it.id}" style="text-align:left; width:100%; cursor:pointer; font-family:inherit; color:inherit; border:1px solid var(--line); padding:0;">
        <div style="position:relative;">
          ${cardImageHtml(it, 'zfm-card-img')}
          ${hasVariants ? `<span class="zfm-card-tag">${options.length} xil</span>` : ''}
          ${!cardAvailable ? `<span class="zfm-card-unavailable-tag">Tugagan</span>` : ''}
        </div>
        <div class="zfm-card-body">
          <h3 class="zfm-card-name">${escapeHtml(it.name)}${it.volume ? ` <span class="zfm-card-volume">(${escapeHtml(it.volume)})</span>` : ''}</h3>
          ${it.description ? `<p class="zfm-card-desc">${escapeHtml(it.description)}</p>` : ''}
          <div class="zfm-card-price">${hasVariants ? `<span class="from">dan</span> ` : ''}${fmtSom(minPrice)}</div>
        </div>
      </button>
    `;
  }

  function attachCardHandlers(container) {
    container.querySelectorAll('[data-item-card]').forEach((btn) => {
      btn.addEventListener('click', () => openItemView(Number(btn.dataset.itemCard)));
    });
  }

  function openItemView(id) {
    const it = itemsById.get(id);
    if (!it) return;
    itemImgWrap.innerHTML = '';
    itemImgWrap.appendChild(itemClose);
    if (it.image) {
      itemImgWrap.classList.remove('no-image');
      const img = document.createElement('img');
      img.src = it.image; img.alt = it.name; img.loading = 'lazy';
      itemImgWrap.appendChild(img);
    } else {
      itemImgWrap.classList.add('no-image');
      const span = document.createElement('span');
      span.textContent = (it.name || '?').trim().charAt(0).toUpperCase() || '?';
      itemImgWrap.appendChild(span);
    }
    itemNameEl.textContent = it.name;
    itemVolumeEl.textContent = it.volume || '';
    itemVolumeEl.style.display = it.volume ? '' : 'none';
    itemDescEl.textContent = it.description || '';
    itemDescEl.style.display = it.description ? '' : 'none';

    const variants = it.variants || [];
    if (variants.length > 0) {
      const options = itemOptions(it);
      variantWrap.style.display = '';
      variantListEl.innerHTML = options.map((o) => `
        <div class="zfm-variant-opt" style="cursor:default;">
          <span class="name">${escapeHtml(o.name)}${o.available ? '' : ' (tugagan)'}</span>
          <span class="price">${fmtSom(o.price)}</span>
        </div>
      `).join('');
    } else {
      variantWrap.style.display = 'none';
    }
    openOverlay();
  }

  function renderCats() {
    catsEl.innerHTML = categories.map((cat) => `
      <button type="button" class="zfm-cat-btn${cat.id === activeCatId ? ' active' : ''}" data-cat="${cat.id}" role="tab" aria-selected="${cat.id === activeCatId}">${escapeHtml(cat.name)}</button>
    `).join('');
    catsEl.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const catId = Number(btn.dataset.cat);
        if (searchQuery) { searchInput.value = ''; searchQuery = ''; }
        activeCatId = catId;
        renderCats();
        renderSections();
        btn.scrollIntoView({ block: 'nearest', inline: 'center' });
        const target = document.getElementById(`tm-sec-${catId}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderSections() {
    const q = normalizeSearch(searchQuery);

    if (q) {
      // Qidiruv faqat tanlangan kategoriya ichida (foydalanuvchi so'rovi,
      // 2026-10-28) — bu sahifada "Barchasi" degan tanlov yo'q, shu sabab
      // har doim joriy activeCatId'ga qarab cheklanadi.
      const activeCategory = categories.find((c) => c.id === activeCatId);
      const pool = activeCategory ? activeCategory.items : [];
      const matched = pool.filter((it) => itemMatchesSearch(it, q));
      mainEl.innerHTML = `
        <div class="zfm-section">
          <div class="zfm-section-head"><h2>Qidiruv${activeCategory ? ' — ' + escapeHtml(activeCategory.name) : ''}</h2><span class="zfm-section-count">${matched.length} ta</span></div>
          ${matched.length === 0
            ? `<p class="zfm-empty">${activeCategory ? escapeHtml(activeCategory.name) + ' ichida ' : ''}&ldquo;${escapeHtml(searchQuery)}&rdquo; bo'yicha hech narsa topilmadi</p>`
            : `<div class="zfm-grid">${matched.map(cardHtml).join('')}</div>`}
        </div>
      `;
      attachCardHandlers(mainEl);
      return;
    }

    if (categories.length === 0) {
      mainEl.innerHTML = `<p class="zfm-empty">Hozircha menyu qo'shilmagan.</p>`;
      return;
    }

    if (!activeCatId || !categories.some((c) => c.id === activeCatId)) {
      activeCatId = categories[0].id;
      renderCats();
    }

    const cat = categories.find((c) => c.id === activeCatId);
    mainEl.innerHTML = `
      <section class="zfm-section" id="tm-sec-${cat.id}" data-cat="${cat.id}">
        <div class="zfm-section-head"><h2>${escapeHtml(cat.name)}</h2><span class="zfm-section-count">${cat.items.length} ta</span></div>
        <div class="zfm-grid">${cat.items.map(cardHtml).join('')}</div>
      </section>
    `;
    attachCardHandlers(mainEl);
  }

  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      renderSections();
    }, 120);
  });

  function renderSkeleton() {
    let html = '';
    for (let i = 0; i < 6; i++) html += `<div class="zfm-skeleton-card"><div class="zfm-sk-img"></div><div class="zfm-sk-line w60"></div><div class="zfm-sk-line w40"></div></div>`;
    mainEl.innerHTML = `<div class="zfm-section"><div class="zfm-grid">${html}</div></div>`;
  }

  async function loadTableName() {
    if (!tableId) { tableNameEl.textContent = 'Menyu'; return; }
    try {
      const res = await fetch(`../api/public/tables/${tableId}`);
      if (!res.ok) { tableNameEl.textContent = 'Menyu'; return; }
      const t = await res.json();
      tableNameEl.textContent = t.name;
    } catch (e) { tableNameEl.textContent = 'Menyu'; }
  }

  function loadMenu() {
    renderSkeleton();
    fetch('../api/public/menu')
      .then((res) => { if (!res.ok) throw new Error('bad'); return res.json(); })
      .then((data) => {
        categories = Array.isArray(data.categories) ? data.categories : [];
        itemsById.clear();
        categories.forEach((cat) => cat.items.forEach((it) => {
          itemsById.set(it.id, it);
          (it.variants || []).forEach((v) => itemsById.set(v.id, v));
        }));
        renderCats();
        renderSections();
      })
      .catch(() => {
        mainEl.innerHTML = `<div class="zfm-load-error"><p>Menyuni yuklab bo'lmadi.</p><button type="button" id="tmRetryBtn">Qayta urinish</button></div>`;
        document.getElementById('tmRetryBtn').addEventListener('click', loadMenu);
      });
  }

  loadTableName();
  loadMenu();
})();
