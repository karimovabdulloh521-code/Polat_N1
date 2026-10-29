// Ziyo Famliy — mijozlar uchun menyu + savat ("dastavka.html" namunasi
// asosidagi dizayn, 2026-10-18). Mustaqil modul — script.js'dagi
// header/nav/"Stol bron qilish" kodiga tegmaydi, faqat #menu bo'limi + savat
// + checkout shu yerda. Backend API/validatsiya eskisidek
// (GET ../api/public/menu, POST ../api/public/orders) — bu fayl faqat
// ko'rinishni o'zgartiradi.
(function () {
  'use strict';

  const LS_KEY = 'zf-cart';

  // Sof yordamchilar menu-v2-utils.js'da (2026-10-24'da ajratildi).
  const { escapeHtml, fmtSom, haversineKm, computeDeliveryFee, normalizeSearch, itemMatchesSearch } = window.ZfdUtils;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const menuSection = document.querySelector('#menu .zfd-root');
    if (!menuSection) return;

    // ---- DOM ----
    const siteHeader = document.getElementById('siteHeader');
    const toolbarEl = document.getElementById('zfdToolbar');
    const searchInput = document.getElementById('zfdSearchInput');
    const chipsEl = document.getElementById('zfdChips');
    const mainEl = document.getElementById('zfdMain');

    const cartEl = document.getElementById('zfdCart');
    const cartClearBtn = document.getElementById('zfdCartClear');
    const cartCloseBtn = document.getElementById('zfdCartClose');
    const cartLinesEl = document.getElementById('zfdCartLines');
    const cartSumEl = document.getElementById('zfdCartSum');

    const barEl = document.getElementById('zfdBar');
    const barCntEl = document.getElementById('zfdBarCnt');
    const barSumEl = document.getElementById('zfdBarSum');

    const overlayEl = document.getElementById('zfdOverlay');

    const checkoutEl = document.getElementById('zfdCheckout');
    const formViewEl = document.getElementById('zfdFormView');
    const successViewEl = document.getElementById('zfdSuccessView');
    const checkoutForm = document.getElementById('zfdCheckoutForm');
    const segmentEl = document.getElementById('zfdFulfillmentSegment');
    const checkoutLinesEl = document.getElementById('zfdCheckoutLines');
    const checkoutMobileBar = document.getElementById('zfdCheckoutMobileBar');

    const nameField = document.getElementById('zfdNameField');
    const nameInput = document.getElementById('zfdName');
    const nameErrorEl = document.getElementById('zfdNameError');
    const phoneField = document.getElementById('zfdPhoneField');
    const phoneWrap = document.getElementById('zfdPhoneWrap');
    const phoneInput = document.getElementById('zfdPhone');
    const phoneErrorEl = document.getElementById('zfdPhoneError');
    const addressField = document.getElementById('zfdAddressField');
    const addressInput = document.getElementById('zfdAddress');
    const addressErrorEl = document.getElementById('zfdAddressError');
    const pickupBox = document.getElementById('zfdPickupBox');
    const locationBtn = document.getElementById('zfdLocationBtn');
    const locationStatusEl = document.getElementById('zfdLocationStatus');
    const dzWrapEl = document.getElementById('zfdDzWrap');
    const dzMapEl = document.getElementById('zfdDzMap');
    const dzZoneEl = document.getElementById('zfdDzZone');
    const noteInput = document.getElementById('zfdNote');
    const honeypotInput = document.getElementById('zfdExtraNote2');
    const recapEl = document.getElementById('zfdRecap');
    const recapCountEl = document.getElementById('zfdRecapCount');
    const formErrorEl = document.getElementById('zfdFormError');
    const submitBtn = document.getElementById('zfdSubmitBtn');
    const submitBtnMobile = document.getElementById('zfdSubmitBtnMobile');
    const submitSumEl = document.getElementById('zfdSubmitSum');
    const submitSumMobileEl = document.getElementById('zfdSubmitSumMobile');

    const orderNoEl = document.getElementById('zfdOrderNo');
    const successPhoneEl = document.getElementById('zfdSuccessPhone');
    const successItemsEl = document.getElementById('zfdSuccessItems');
    const successSumEl = document.getElementById('zfdSuccessSum');

    const toastWrap = document.getElementById('zfdToastWrap');

    // ---- Holat ----
    let categories = [];
    const itemsById = new Map(); // id -> { ...item, categoryId, parentId?, parentName? }
    const cart = new Map(); // id -> qty
    const cartFlags = new Map(); // id -> 'unavailable'
    const selectedVariant = new Map(); // parentId -> hozir tanlangan variant id
    let activeCat = 'all';
    let searchQuery = '';
    let fulfillment = 'pickup';
    let capturedLocation = null;
    let deliveryZoneConfig = null; // GET ../api/public/delivery-zone natijasi (hali kelmagan bo'lsa null)
    let deliveryQuote = { distanceKm: null, fee: null, overMax: false }; // joriy capturedLocation uchun hisoblangan natija
    let dzMap = null;
    let dzOriginMarker = null;
    let dzUserMarker = null;
    let dzBaseCircle = null;
    let dzMaxCircle = null;

    // Yetkazish hudud sozlamasini oldindan so'raymiz — xarita faqat
    // oshxona koordinatasi sozlangan paytda ko'rsatiladi, aks holda avvalgidek
    // "Operator aytadi" rejimi (sahifaning qolgan qismiga ta'sir qilmaydi).
    fetch('../api/public/delivery-zone')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        deliveryZoneConfig = data;
        // Mijoz "Yetkazib berish"ni ALLAQACHON tanlagan bo'lsa (bu so'rov
        // hali javob bermagan paytda) — xarita shu paytgacha ko'rsatilmay
        // qolar edi, chunki dastlabki ko'rinish faqat segment tugmasi
        // bosilgan ONDA tekshirilardi. Endi javob kelganda ham qayta tekshiradi.
        if (fulfillment === 'delivery' && data && data.configured) {
          dzWrapEl.classList.remove('hidden');
          ensureDzMap();
          setTimeout(() => { if (dzMap) dzMap.invalidateSize(); }, 50);
          updateDeliveryQuote();
        }
      })
      .catch(() => { deliveryZoneConfig = null; });

    function ensureDzMap() {
      if (dzMap || typeof window.L === 'undefined' || !deliveryZoneConfig || !deliveryZoneConfig.configured) return;
      dzMap = window.L.map(dzMapEl, { attributionControl: false }).setView(
        [deliveryZoneConfig.origin_lat, deliveryZoneConfig.origin_lng], 12
      );
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(dzMap);
      dzOriginMarker = window.L.marker([deliveryZoneConfig.origin_lat, deliveryZoneConfig.origin_lng]).addTo(dzMap);
      dzBaseCircle = window.L.circle([deliveryZoneConfig.origin_lat, deliveryZoneConfig.origin_lng], {
        radius: deliveryZoneConfig.base_km * 1000, color: '#6fbf73', weight: 1, fillOpacity: 0.06,
      }).addTo(dzMap);
      dzMaxCircle = window.L.circle([deliveryZoneConfig.origin_lat, deliveryZoneConfig.origin_lng], {
        radius: deliveryZoneConfig.max_km * 1000, color: '#c1502e', weight: 1, fillOpacity: 0.03, dashArray: '6,6',
      }).addTo(dzMap);
      dzMap.fitBounds(dzMaxCircle.getBounds());
      dzMap.on('click', (e) => {
        capturedLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
        placeDzUserMarker(e.latlng.lat, e.latlng.lng);
        locationBtn.classList.add('done');
        locationBtn.querySelector('span').textContent = 'Lokatsiya qo’shildi ✓';
        locationStatusEl.textContent = '';
        updateDeliveryQuote();
      });
    }

    function placeDzUserMarker(lat, lng) {
      if (!dzMap) return;
      if (dzUserMarker) dzMap.removeLayer(dzUserMarker);
      dzUserMarker = window.L.marker([lat, lng], {
        icon: window.L.icon({
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
          iconSize: [25, 41], iconAnchor: [12, 41],
        }),
      }).addTo(dzMap);
    }

    // Zona kartochkasini va "Hisob"dagi yetkazish qatorini capturedLocation/
    // deliveryZoneConfig holatiga qarab yangilaydi — joylashuv bermagan yoki
    // oshxona koordinatasi sozlanmagan bo'lsa (ikkala holatda ham) avvalgidek
    // "Operator aytadi" rejimi (hech narsa o'chirilmaydi, submit ham bloklanmaydi).
    function updateDeliveryQuote() {
      deliveryQuote = { distanceKm: null, fee: null, overMax: false };
      if (!dzZoneEl) { renderRecap(); return; }
      if (!deliveryZoneConfig || !deliveryZoneConfig.configured) {
        dzZoneEl.className = 'zfd-dz-zone';
        dzZoneEl.innerHTML = '';
        renderRecap();
        return;
      }
      if (!capturedLocation) {
        dzZoneEl.className = 'zfd-dz-zone';
        dzZoneEl.innerHTML = '<span>📍 Joylashuvni xaritada belgilang yoki "Lokatsiyamni yuborish"ni bosing</span>';
        renderRecap();
        return;
      }
      const q = computeDeliveryFee(
        haversineKm(deliveryZoneConfig.origin_lat, deliveryZoneConfig.origin_lng, capturedLocation.lat, capturedLocation.lng),
        deliveryZoneConfig
      );
      deliveryQuote = q;
      if (q.overMax) {
        const phoneHtml = deliveryZoneConfig.operator_phone
          ? `<a href="tel:${escapeHtml(deliveryZoneConfig.operator_phone)}">${escapeHtml(deliveryZoneConfig.operator_phone)}</a>`
          : 'operatorga';
        dzZoneEl.className = 'zfd-dz-zone warn';
        dzZoneEl.innerHTML = `<span>📞 Bu manzil yetkazish hududidan tashqarida (${q.distanceKm} km). Narxni ${phoneHtml} qo'ng'iroq qilib kelishing.</span>`;
      } else {
        dzZoneEl.className = 'zfd-dz-zone ok';
        dzZoneEl.innerHTML = `<span>✅ Hudud ichida — ${q.distanceKm} km, ${fmtSom(q.fee)}</span>`;
      }
      renderRecap();
    }

    // ---- Toolbar/header balandligini o'lchash (sticky offset uchun) ----
    function measureOffsets() {
      const headerH = siteHeader ? siteHeader.getBoundingClientRect().height : 72;
      menuSection.style.setProperty('--zfd-header-h', Math.round(headerH) + 'px');
      menuSection.style.setProperty('--zfd-toolbar-h', toolbarEl.offsetHeight + 'px');
    }
    measureOffsets();
    if (window.ResizeObserver) {
      new ResizeObserver(measureOffsets).observe(toolbarEl);
      if (siteHeader) new ResizeObserver(measureOffsets).observe(siteHeader);
    } else {
      window.addEventListener('resize', measureOffsets);
    }

    // ---- Dialog (savat-sheet / checkout-modal) ochish-yopish ----
    let lastFocused = null;
    function lockScroll() { document.body.style.overflow = 'hidden'; }
    function unlockScroll() { document.body.style.overflow = ''; }
    function isMobile() { return window.matchMedia('(max-width:980px)').matches; }

    function openCartSheet() {
      if (!isMobile()) return; // desktopda doim ko'rinadi
      lastFocused = document.activeElement;
      cartEl.classList.add('open');
      overlayEl.classList.add('open');
      lockScroll();
    }
    function openCheckout() {
      if (cartPurchasableEntries().length === 0) return;
      lastFocused = document.activeElement;
      cartEl.classList.remove('open');
      overlayEl.classList.remove('open');
      clearFormErrors();
      renderCheckoutLines();
      renderRecap();
      formViewEl.classList.remove('hidden');
      successViewEl.classList.add('hidden');
      checkoutEl.classList.remove('success');
      checkoutMobileBar.classList.remove('hidden');
      checkoutEl.classList.add('open');
      lockScroll();
      checkoutEl.scrollTop = 0;
      setTimeout(() => nameInput.focus(), 180);
    }
    function closeAll() {
      cartEl.classList.remove('open');
      checkoutEl.classList.remove('open');
      overlayEl.classList.remove('open');
      unlockScroll();
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    }
    overlayEl.addEventListener('click', closeAll);
    cartCloseBtn.addEventListener('click', closeAll);
    checkoutEl.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeAll));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (cartEl.classList.contains('open') || checkoutEl.classList.contains('open')) closeAll();
    });

    // ---- Toast ----
    function showToast(message, isError) {
      const el = document.createElement('div');
      el.className = 'zfd-toast' + (isError ? ' error' : '');
      el.textContent = message;
      toastWrap.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 250);
      }, isError ? 4200 : 2600);
    }

    // ---- Savat: localStorage ----
    function loadCartRaw() {
      try {
        const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        if (raw && typeof raw === 'object') return raw;
      } catch (e) { /* buzilgan qiymat — e'tiborsiz */ }
      return {};
    }
    function saveCart() {
      try {
        const plain = {};
        cart.forEach((qty, id) => { plain[id] = qty; });
        localStorage.setItem(LS_KEY, JSON.stringify(plain));
      } catch (e) { /* localStorage yo'q/to'lgan — savat shu sessiyada baribir ishlayveradi */ }
    }

    // ---- Menyuni yuklash ----
    function renderSkeleton() {
      let html = '';
      for (let i = 0; i < 6; i++) {
        html += `<div class="zfd-skeleton-card"><div class="sk-img"></div><div class="sk-line w60"></div><div class="sk-line w40"></div></div>`;
      }
      mainEl.innerHTML = `<div class="zfd-section"><div class="zfd-grid">${html}</div></div>`;
    }
    function renderLoadError() {
      mainEl.innerHTML = `<div class="zfd-load-error"><p>Menyuni yuklab bo'lmadi, internet aloqasini tekshiring.</p><button type="button" id="zfdRetryBtn">Qayta urinish</button></div>`;
      document.getElementById('zfdRetryBtn').addEventListener('click', fetchMenu);
    }

    function fetchMenu() {
      renderSkeleton();
      fetch('../api/public/menu')
        .then((res) => {
          if (!res.ok) throw new Error('bad status');
          return res.json();
        })
        .then((data) => {
          categories = Array.isArray(data.categories) ? data.categories : [];
          buildItemsIndex();
          reconcileCart();
          renderChips();
          renderSections();
          renderCart();
        })
        .catch(() => renderLoadError());
    }

    function buildItemsIndex() {
      itemsById.clear();
      categories.forEach((cat) => {
        cat.items.forEach((it) => {
          itemsById.set(it.id, { ...it, categoryId: cat.id });
          (it.variants || []).forEach((v) => {
            itemsById.set(v.id, { ...v, categoryId: cat.id, parentId: it.id, parentName: it.name });
          });
        });
      });
    }

    // Savatdagi (localStorage'dan kelgan) bandlarni yangi menyu bilan
    // solishtiradi — o'chirilgan/tugagan band savatdan olib tashlanadi.
    function reconcileCart() {
      cart.clear();
      cartFlags.clear();
      const raw = loadCartRaw();
      let removed = 0;
      Object.keys(raw).forEach((key) => {
        const id = Number(key);
        const qty = Math.max(0, Math.min(50, Math.round(Number(raw[key]) || 0)));
        const item = itemsById.get(id);
        if (!item || !item.available || qty <= 0) { removed += 1; return; }
        cart.set(id, qty);
        if (item.parentId) selectedVariant.set(item.parentId, id);
      });
      if (removed > 0) {
        saveCart();
        showToast(removed === 1 ? "Savatdagi 1 ta taom endi mavjud emas, olib tashlandi" : `Savatdagi ${removed} ta taom endi mavjud emas, olib tashlandi`);
      }
    }

    // ---- Kategoriya chiplari ----
    function renderChips() {
      const totalCount = categories.reduce((s, c) => s + c.items.length, 0);
      const all = [{ id: 'all', name: 'Barchasi', count: totalCount }].concat(
        categories.map((c) => ({ id: c.id, name: c.name, count: c.items.length }))
      );
      chipsEl.innerHTML = all.map((c) => `
        <button type="button" class="zfd-chip${activeCat === c.id ? ' active' : ''}" data-cat="${c.id}" role="tab" aria-selected="${activeCat === c.id}">${escapeHtml(c.name)}<small>${c.count}</small></button>
      `).join('');
      chipsEl.querySelectorAll('[data-cat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const raw = btn.dataset.cat;
          activeCat = raw === 'all' ? 'all' : Number(raw);
          if (searchQuery) { searchInput.value = ''; searchQuery = ''; }
          renderChips();
          renderSections();
          window.scrollTo({ top: menuSection.getBoundingClientRect().top + window.scrollY - 8, behavior: 'smooth' });
        });
      });
    }

    // ---- Variant (tur/hajm) yordamchilari ----
    function itemOptions(it) {
      const variants = it.variants || [];
      return variants.length > 0 ? [{ id: it.id, name: it.name, price: it.price, available: it.available, volume: it.volume }, ...variants] : [it];
    }
    // Turlar ba'zan nomi bilan (masalan "Mini Lavash"/"Sirli Lavash"), ba'zan
    // hajmi bilan (masalan Pepsi 0.5L/1L) farqlanadi — qaysi biri haqiqatan
    // farqlovchi ekanini aniqlab shuni ko'rsatamiz (ikkalasi bir xil bo'lsa,
    // ya'ni variant nomi ota taom nomi bilan bir xil bo'lsa, hajm ustuvor).
    function sizeLabel(o, parentName) {
      if (o.name && o.name !== parentName) return o.name;
      return o.volume || o.name;
    }
    function currentVariantId(it) {
      const options = itemOptions(it);
      if (options.length === 1) return it.id;
      const chosen = selectedVariant.get(it.id);
      if (chosen && options.some((o) => o.id === chosen)) return chosen;
      const firstAvailable = options.find((o) => o.available);
      return firstAvailable ? firstAvailable.id : options[0].id;
    }

    // ---- Mahsulot kartochkasi ----
    function cardImageHtml(it, cls) {
      if (it.image) return `<div class="${cls}"><img src="${escapeHtml(it.image)}" alt="${escapeHtml(it.name)}" loading="lazy" decoding="async"></div>`;
      const letter = (it.name || '?').trim().charAt(0).toUpperCase() || '?';
      return `<div class="${cls} no-image"><span>${escapeHtml(letter)}</span></div>`;
    }

    function controlHtml(effectiveId, effectiveAvailable) {
      if (!effectiveAvailable) return `<button type="button" class="zfd-add-btn" disabled>Tugagan</button>`;
      const qty = cart.get(effectiveId) || 0;
      if (qty > 0) {
        return `
          <div class="zfd-stepper" data-stepper="${effectiveId}">
            <button type="button" data-dec="${effectiveId}" aria-label="Kamaytirish">&minus;</button>
            <span>${qty}</span>
            <button type="button" data-inc="${effectiveId}" aria-label="Oshirish">+</button>
          </div>`;
      }
      return `<button type="button" class="zfd-add-btn" data-add="${effectiveId}" aria-label="Savatga qo'shish"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg></button>`;
    }

    function cardDynamicHtml(it) {
      const options = itemOptions(it);
      const hasVariants = options.length > 1;
      const effectiveId = currentVariantId(it);
      const effective = itemsById.get(effectiveId) || options.find((o) => o.id === effectiveId) || options[0];

      const sizesHtml = hasVariants
        ? `<div class="zfd-sizes">${options.map((o) => `<button type="button" class="zfd-size-btn${o.id === effectiveId ? ' active' : ''}" data-size="${it.id}:${o.id}" ${o.available ? '' : 'disabled'}>${escapeHtml(sizeLabel(o, it.name))}</button>`).join('')}</div>`
        : '';

      return `
        ${sizesHtml}
        <div class="zfd-card-foot">
          <span class="zfd-price">${fmtSom(effective.price)}</span>
          <span data-control="${it.id}">${controlHtml(effectiveId, effective.available)}</span>
        </div>
      `;
    }

    function cardHtml(it) {
      const options = itemOptions(it);
      const cardAvailable = options.some((o) => o.available);
      return `
        <div class="zfd-card${cardAvailable ? '' : ' is-unavailable'}" data-card="${it.id}">
          <div class="zfd-card-img-outer" style="position:relative;">
            ${cardImageHtml(it, 'zfd-card-img')}
            ${!cardAvailable ? `<span class="zfd-card-unavailable-tag">Tugagan</span>` : ''}
          </div>
          <div class="zfd-card-body">
            <h3 class="zfd-card-name">${escapeHtml(it.name)}${it.volume ? ` <span class="zfd-card-volume">(${escapeHtml(it.volume)})</span>` : ''}</h3>
            ${it.description ? `<p class="zfd-card-desc">${escapeHtml(it.description)}</p>` : ''}
            <div data-dynamic="${it.id}">${cardDynamicHtml(it)}</div>
          </div>
        </div>
      `;
    }

    function syncCard(parentId) {
      const it = itemsById.get(parentId);
      const el = mainEl.querySelector(`[data-dynamic="${parentId}"]`);
      if (!it || !el) return;
      el.innerHTML = cardDynamicHtml(it);
    }

    // Delegatsiya BITTA marta ulanadi — innerHTML qayta yozilsa ham ishlayveradi.
    function setupGridDelegation(container) {
      container.addEventListener('click', (e) => {
        const sizeBtn = e.target.closest('[data-size]');
        if (sizeBtn) {
          const [parentIdRaw, variantIdRaw] = sizeBtn.dataset.size.split(':');
          selectedVariant.set(Number(parentIdRaw), Number(variantIdRaw));
          syncCard(Number(parentIdRaw));
          return;
        }
        const addBtn = e.target.closest('[data-add]');
        if (addBtn) {
          const id = Number(addBtn.dataset.add);
          addToCart(id, 1);
          const item = itemsById.get(id);
          showToast(`${item.parentName ? item.parentName + ' — ' + sizeLabel(item, item.parentName) : item.name} savatga qo'shildi`);
          syncParentCard(id);
          renderCart();
          return;
        }
        const incBtn = e.target.closest('[data-inc]');
        if (incBtn) {
          const id = Number(incBtn.dataset.inc);
          addToCart(id, 1);
          syncParentCard(id);
          renderCart();
          return;
        }
        const decBtn = e.target.closest('[data-dec]');
        if (decBtn) {
          const id = Number(decBtn.dataset.dec);
          addToCart(id, -1);
          syncParentCard(id);
          renderCart();
        }
      });
    }
    function syncParentCard(id) {
      const item = itemsById.get(id);
      if (!item) return;
      syncCard(item.parentId || id);
    }

    function addToCart(id, delta) {
      const current = cart.get(id) || 0;
      const next = Math.max(0, Math.min(50, current + delta));
      if (next === 0) cart.delete(id); else cart.set(id, next);
      cartFlags.delete(id);
      saveCart();
    }
    function setQty(id, qty) {
      const next = Math.max(0, Math.min(50, Math.round(qty)));
      if (next === 0) { cart.delete(id); cartFlags.delete(id); } else cart.set(id, next);
      saveCart();
    }

    // ---- Bo'limlar (sections) / qidiruv natijalari ----
    function renderSections() {
      const q = normalizeSearch(searchQuery);

      if (q) {
        // Qidiruv faqat TANLANGAN kategoriya ichida bo'lishi kerak (foydalanuvchi
        // so'rovi, 2026-10-28) — "Barchasi" chipi tanlangan bo'lsagina barcha
        // kategoriyalar bo'yicha qidiradi, aks holda faqat shu kategoriya.
        const activeCategory = activeCat === 'all' ? null : categories.find((c) => c.id === activeCat);
        const pool = activeCategory ? activeCategory.items : categories.flatMap((cat) => cat.items);
        const matched = pool.filter((it) => itemMatchesSearch(it, q));
        const headingSuffix = activeCategory ? ` — ${escapeHtml(activeCategory.name)}` : '';
        mainEl.innerHTML = `
          <div class="zfd-section">
            <div class="zfd-section-head"><h2>Qidiruv natijalari${headingSuffix}</h2><span class="zfd-section-count">${matched.length} ta</span></div>
            ${matched.length === 0
              ? `<p class="zfd-empty">${activeCategory ? escapeHtml(activeCategory.name) + ' ichida ' : ''}&ldquo;${escapeHtml(searchQuery)}&rdquo; bo'yicha hech narsa topilmadi</p>`
              : `<div class="zfd-grid">${matched.map(cardHtml).join('')}</div>`}
          </div>
        `;
        return;
      }

      if (categories.length === 0) {
        mainEl.innerHTML = `<p class="zfd-empty">Hozircha menyu qo'shilmagan.</p>`;
        return;
      }

      const catsToShow = activeCat === 'all' ? categories : categories.filter((c) => c.id === activeCat);
      mainEl.innerHTML = catsToShow.map((cat) => `
        <section class="zfd-section" data-cat="${cat.id}">
          <div class="zfd-section-head"><h2>${escapeHtml(cat.name)}</h2><span class="zfd-section-count">${cat.items.length} ta</span></div>
          <div class="zfd-grid">${cat.items.map(cardHtml).join('')}</div>
        </section>
      `).join('');
    }

    let searchDebounce = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        renderSections();
      }, 120);
    });

    // ---- Savat render ----
    function cartEntries() {
      const list = [];
      cart.forEach((qty, id) => {
        const item = itemsById.get(id);
        if (!item) return;
        list.push({ id, item, qty, flagged: cartFlags.get(id) === 'unavailable' });
      });
      return list;
    }
    function cartPurchasableEntries() { return cartEntries().filter((e) => !e.flagged); }
    function cartTotal() { return cartPurchasableEntries().reduce((sum, e) => sum + e.qty * e.item.price, 0); }
    function cartCount() { return cartPurchasableEntries().reduce((sum, e) => sum + e.qty, 0); }

    function cartLineHtml(entry) {
      const { id, item, qty, flagged } = entry;
      const title = item.parentId ? item.parentName : item.name;
      const sub = item.parentId ? `${escapeHtml(sizeLabel(item, item.parentName))} · ${fmtSom(item.price)}` : fmtSom(item.price);
      return `
        <div class="zfd-cart-line" data-cart-line="${id}">
          ${item.image ? `<img class="zfd-cart-mini" src="${escapeHtml(item.image)}" alt="">` : `<div class="zfd-cart-mini">${escapeHtml((title || '?').charAt(0).toUpperCase())}</div>`}
          <div class="zfd-cart-info">
            <b>${escapeHtml(title)}${flagged ? ' <span class="zfd-cart-flag">(tugagan)</span>' : ''}</b>
            <span>${flagged ? '' : sub}</span>
          </div>
          ${flagged
            ? `<button type="button" class="zfd-cart-remove" data-cart-remove="${id}">Olib tashlash</button>`
            : `<div class="zfd-stepper"><button type="button" data-cart-dec="${id}" aria-label="Kamaytirish">&minus;</button><span>${qty}</span><button type="button" data-cart-inc="${id}" aria-label="Oshirish">+</button></div>`}
        </div>
      `;
    }

    // Savat qatorlarini bitta konteynerga chizadi va +/-/olib tashlash
    // tugmalariga hodisa ulaydi — quick-cart panel VA checkout "Savatingiz"
    // kartasi ikkalasi ham shu bitta funksiyadan foydalanadi.
    function renderLinesInto(container, entries, emptyHtml) {
      container.innerHTML = entries.length ? entries.map(cartLineHtml).join('') : (emptyHtml || '');
      container.querySelectorAll('[data-cart-inc]').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.cartInc); addToCart(id, 1); syncParentCard(id); renderCart(); renderCheckoutLines(); renderRecap();
      }));
      container.querySelectorAll('[data-cart-dec]').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.cartDec); addToCart(id, -1); syncParentCard(id); renderCart(); renderCheckoutLines(); renderRecap();
      }));
      container.querySelectorAll('[data-cart-remove]').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.cartRemove); setQty(id, 0); cartFlags.delete(id); renderCart(); renderCheckoutLines(); renderRecap();
      }));
    }

    function renderCart() {
      const entries = cartEntries();
      const count = cartCount();
      const total = cartTotal();

      cartClearBtn.style.visibility = entries.length ? 'visible' : 'hidden';
      renderLinesInto(cartLinesEl, entries, `<div class="zfd-cart-empty"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/></svg><div>Savat hozircha bo&rsquo;sh</div><div style="font-size:13px;">Menyudan taom tanlang</div></div>`);

      cartSumEl.innerHTML = entries.length ? `
        <div class="row"><span class="zfd-muted">Taomlar</span><span>${fmtSom(total)}</span></div>
        <div class="row"><span class="zfd-muted">Yetkazib berish</span><span class="zfd-gold">Operator aytadi</span></div>
        <div class="row total"><span>Jami</span><span>${fmtSom(total)}</span></div>
        <div class="zfd-cart-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          Yetkazib berish narxi manzilga qarab operator tomonidan telefon orqali aytiladi.
        </div>
        <button type="button" class="zfd-btn" id="zfdToCheckout" ${cartPurchasableEntries().length === 0 ? 'disabled' : ''}>Buyurtmani rasmiylashtirish</button>
      ` : '';
      const checkoutBtn = document.getElementById('zfdToCheckout');
      if (checkoutBtn) checkoutBtn.addEventListener('click', openCheckout);

      barCntEl.textContent = String(count);
      barSumEl.textContent = fmtSom(total);
      barEl.classList.toggle('show', count > 0 || entries.some((e) => e.flagged));
    }

    // Checkout ko'rinishidagi "Savatingiz" kartasi — xuddi shu qatorlar,
    // faqat alohida konteynerda (zfdCheckoutLines).
    function renderCheckoutLines() {
      const entries = cartEntries();
      renderLinesInto(checkoutLinesEl, entries, `<div class="zfd-cart-empty"><div>Savat bo&rsquo;sh</div></div>`);
    }

    barEl.addEventListener('click', openCartSheet);
    cartClearBtn.addEventListener('click', () => {
      cart.clear();
      cartFlags.clear();
      saveCart();
      mainEl.querySelectorAll('[data-dynamic]').forEach((el) => {
        const id = Number(el.dataset.dynamic);
        const it = itemsById.get(id);
        if (it) el.innerHTML = cardDynamicHtml(it);
      });
      renderCart();
    });

    // ---- Checkout: segment, telefon, GPS ----
    function fieldError(fieldEl, errorEl, message) {
      const inputEl = fieldEl.querySelector('.zfd-inp') || fieldEl.querySelector('#zfdPhoneWrap');
      if (message) {
        if (inputEl) inputEl.classList.add('err');
        if (fieldEl === phoneField) phoneWrap.classList.add('err');
        errorEl.textContent = message;
      } else {
        if (inputEl) inputEl.classList.remove('err');
        if (fieldEl === phoneField) phoneWrap.classList.remove('err');
        errorEl.textContent = '';
      }
    }
    function clearFormErrors() {
      fieldError(nameField, nameErrorEl, '');
      fieldError(phoneField, phoneErrorEl, '');
      fieldError(addressField, addressErrorEl, '');
      formErrorEl.textContent = '';
    }

    segmentEl.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        fulfillment = btn.dataset.fulfillment;
        segmentEl.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        addressField.classList.toggle('hidden', fulfillment !== 'delivery');
        pickupBox.classList.toggle('hidden', fulfillment !== 'pickup');
        const showMap = fulfillment === 'delivery' && deliveryZoneConfig && deliveryZoneConfig.configured;
        dzWrapEl.classList.toggle('hidden', !showMap);
        if (showMap) {
          ensureDzMap();
          setTimeout(() => { if (dzMap) dzMap.invalidateSize(); }, 50);
          updateDeliveryQuote();
        }
        renderRecap();
      });
    });

    // Telefon — foydalanuvchi faqat 9 ta raqam kiritadi, "+998" doim ko'rinadi.
    phoneInput.addEventListener('input', () => {
      const digits = phoneInput.value.replace(/\D/g, '').slice(0, 9);
      const groups = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean);
      phoneInput.value = groups.join(' ');
    });

    locationBtn.addEventListener('click', () => {
      const span = locationBtn.querySelector('span');
      if (!navigator.geolocation) {
        locationStatusEl.textContent = "Qurilma joylashuvni aniqlay olmaydi, manzilni qo'lda yozing";
        locationStatusEl.className = 'zfd-location-status';
        return;
      }
      locationBtn.disabled = true;
      span.textContent = 'Aniqlanmoqda…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          capturedLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          locationBtn.classList.add('done');
          span.textContent = 'Lokatsiya qo’shildi ✓';
          locationStatusEl.textContent = '';
          locationBtn.disabled = false;
          if (dzMap) {
            placeDzUserMarker(capturedLocation.lat, capturedLocation.lng);
            dzMap.panTo([capturedLocation.lat, capturedLocation.lng]);
          }
          updateDeliveryQuote();
        },
        () => {
          capturedLocation = null;
          span.textContent = 'Lokatsiyamni yuborish';
          locationStatusEl.textContent = "Ruxsat berilmadi — manzilni to'liq qo'lda yozing";
          locationStatusEl.className = 'zfd-location-status';
          locationBtn.disabled = false;
          updateDeliveryQuote();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });

    function setSubmitButtonsState(disabled, loading) {
      [submitBtn, submitBtnMobile].forEach((btn) => {
        btn.disabled = disabled;
        const label = btn.querySelector('span:first-child');
        if (label) label.innerHTML = loading ? '<span class="zfd-spinner"></span> Yuborilmoqda…' : 'Buyurtma berish';
      });
    }

    function renderRecap() {
      const entries = cartPurchasableEntries();
      const total = entries.reduce((sum, e) => sum + e.qty * e.item.price, 0);
      let deliveryRow;
      let grandTotal = total;
      let overMax = false;
      if (fulfillment === 'delivery') {
        if (deliveryQuote.overMax) {
          overMax = true;
          deliveryRow = `<div class="row"><span>Yetkazib berish</span><span class="zfd-gold">Operator orqali</span></div>`;
        } else if (deliveryQuote.fee != null) {
          grandTotal = total + deliveryQuote.fee;
          deliveryRow = `<div class="row"><span>Yetkazib berish (${deliveryQuote.distanceKm} km)</span><span>${fmtSom(deliveryQuote.fee)}</span></div>`;
        } else {
          deliveryRow = `<div class="row"><span>Yetkazib berish</span><span class="zfd-gold">Operator aytadi</span></div>`;
        }
      } else {
        deliveryRow = `<div class="row"><span>Olib ketish</span><span class="zfd-gold">Bepul</span></div>`;
      }
      recapEl.innerHTML = `
        <div class="row"><span>Taomlar</span><span>${fmtSom(total)}</span></div>
        ${deliveryRow}
        <div class="row total"><span>Jami</span><span>${fmtSom(grandTotal)}</span></div>
      `;
      const count = entries.reduce((s, e) => s + e.qty, 0);
      recapCountEl.textContent = count ? `· ${count} ta taom` : '';
      const sumText = fmtSom(grandTotal);
      submitSumEl.textContent = sumText;
      submitSumMobileEl.textContent = sumText;
      const disabled = entries.length === 0 || overMax;
      submitBtn.disabled = disabled;
      submitBtnMobile.disabled = disabled;
    }

    function resetCheckoutForm() {
      checkoutForm.reset();
      fulfillment = 'pickup';
      segmentEl.querySelectorAll('button').forEach((b, i) => {
        b.classList.toggle('active', i === 0);
        b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      });
      addressField.classList.add('hidden');
      pickupBox.classList.remove('hidden');
      capturedLocation = null;
      locationBtn.classList.remove('done');
      locationBtn.querySelector('span').textContent = 'Lokatsiyamni yuborish';
      locationStatusEl.textContent = '';
      locationStatusEl.className = 'zfd-location-status';
      dzWrapEl.classList.add('hidden');
      deliveryQuote = { distanceKm: null, fee: null, overMax: false };
      if (dzUserMarker && dzMap) { dzMap.removeLayer(dzUserMarker); dzUserMarker = null; }
      clearFormErrors();
    }

    function attemptSubmitOrder() {
      clearFormErrors();

      const entries = cartPurchasableEntries();
      if (entries.length === 0) { formErrorEl.textContent = "Savat bo'sh"; return; }

      const fullName = nameInput.value.trim();
      const phoneDigits = phoneInput.value.replace(/\D/g, '');
      const addressText = addressInput.value.trim();

      let firstInvalid = null;
      if (fullName.length < 2 || fullName.length > 60) {
        fieldError(nameField, nameErrorEl, "Ismingizni to'liq kiriting (2–60 belgi)");
        firstInvalid = firstInvalid || nameInput;
      }
      if (phoneDigits.length !== 9) {
        fieldError(phoneField, phoneErrorEl, 'Raqamni to\'liq kiriting: 9 ta raqam');
        firstInvalid = firstInvalid || phoneInput;
      }
      if (fulfillment === 'delivery' && (addressText.length < 5 || addressText.length > 200)) {
        fieldError(addressField, addressErrorEl, "Manzilni to'liq kiriting (5–200 belgi)");
        firstInvalid = firstInvalid || addressInput;
      }
      if (firstInvalid) { firstInvalid.focus(); return; }

      const payload = {
        full_name: fullName,
        phone: phoneDigits,
        fulfillment,
        address: addressText,
        note: noteInput.value.trim(),
        items: entries.map((e) => ({ menu_item_id: e.id, quantity: e.qty })),
        idempotency_key: crypto.randomUUID(),
        website: honeypotInput.value,
      };
      if (fulfillment === 'delivery' && capturedLocation) {
        payload.location_lat = capturedLocation.lat;
        payload.location_lng = capturedLocation.lng;
      }

      // Muvaffaqiyat ekranida ko'rsatish uchun — savat tozalanishidan OLDIN
      // joriy tarkib/jami summani saqlab qo'yamiz.
      const snapshotEntries = entries.map((e) => ({ ...e }));
      const snapshotTotal = snapshotEntries.reduce((s, e) => s + e.qty * e.item.price, 0);

      setSubmitButtonsState(true, true);

      fetch('../api/public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (res.status === 409 && Array.isArray(data.unavailable_items)) {
            data.unavailable_items.forEach((u) => { cartFlags.set(u.menu_item_id, 'unavailable'); });
            renderCart();
            closeAll();
            showToast(data.error || 'Savatdagi bir nechta taom tugagan, iltimos savatni yangilang', true);
            return;
          }
          if (res.status === 429) {
            formErrorEl.textContent = data.error || "Juda ko'p urinish, birozdan so'ng qayta urinib ko'ring";
            return;
          }
          if (!res.ok) {
            if (data.field === 'full_name') fieldError(nameField, nameErrorEl, data.error);
            else if (data.field === 'phone') fieldError(phoneField, phoneErrorEl, data.error);
            else if (data.field === 'address') fieldError(addressField, addressErrorEl, data.error);
            else if (data.field === 'location') {
              const phoneHtml = data.operator_phone
                ? ` <a href="tel:${escapeHtml(data.operator_phone)}">${escapeHtml(data.operator_phone)}</a>`
                : '';
              fieldError(addressField, addressErrorEl, '');
              formErrorEl.innerHTML = `${escapeHtml(data.error || "Bu manzilga yetkazish hududidan tashqarida")}${phoneHtml}`;
            }
            else formErrorEl.textContent = data.error || "Xatolik yuz berdi, iltimos +998 91 652 77 71 raqamiga qo'ng'iroq qiling";
            return;
          }

          // `data.id` 0/bo'sh bo'lishi mumkin (honeypot ushlanganda server
          // soxta "muvaffaqiyat" qaytaradi) — bunday holatda chalg'ituvchi
          // "#0" ko'rsatish o'rniga raqamni butunlay yashiramiz.
          orderNoEl.textContent = data.id ? '#' + data.id : '';
          successPhoneEl.textContent = '+998 ' + phoneInput.value;
          successItemsEl.innerHTML = snapshotEntries.map((e) => {
            const title = e.item.parentId ? e.item.parentName : e.item.name;
            const sizeTxt = e.item.parentId ? ` <span class="zfd-muted">${escapeHtml(sizeLabel(e.item, e.item.parentName))}</span>` : '';
            return `<div class="zfd-success-line"><span>${e.qty} × ${escapeHtml(title)}${sizeTxt}</span><span>${fmtSom(e.qty * e.item.price)}</span></div>`;
          }).join('');
          // Yetkazish narxi serverdan qaytgan (haqiqiy, qayta hisoblangan)
          // qiymat bo'yicha ko'rsatiladi — mijoz tomonidagi taxminiy
          // hisobga (deliveryQuote) emas.
          const deliveryFeeFromServer = data.delivery_fee;
          const deliverySumRow = deliveryFeeFromServer != null
            ? `<div class="zfd-success-line"><span>Yetkazish (${data.delivery_distance_km} km)</span><span>${fmtSom(deliveryFeeFromServer)}</span></div>`
            : '';
          successItemsEl.innerHTML += deliverySumRow;
          const grandTotal = snapshotTotal + (deliveryFeeFromServer || 0);
          successSumEl.innerHTML = `<span>Jami</span><span>${fmtSom(grandTotal)}</span>`;

          formViewEl.classList.add('hidden');
          successViewEl.classList.remove('hidden');
          checkoutEl.classList.add('success');
          checkoutEl.scrollTop = 0;
          cart.clear();
          cartFlags.clear();
          selectedVariant.clear();
          saveCart();
          renderCart();
          renderSections();
          resetCheckoutForm();
        })
        .catch(() => {
          formErrorEl.textContent = "Internet aloqasi yo'q. Iltimos, qayta urinib ko'ring yoki +998 91 652 77 71 raqamiga qo'ng'iroq qiling.";
        })
        .finally(() => {
          setSubmitButtonsState(false, false);
          renderRecap();
        });
    }

    checkoutForm.addEventListener('submit', (e) => { e.preventDefault(); attemptSubmitOrder(); });
    submitBtn.addEventListener('click', attemptSubmitOrder);
    submitBtnMobile.addEventListener('click', attemptSubmitOrder);

    // ---- Boshlash ----
    setupGridDelegation(mainEl);
    fetchMenu();
  }
})();
