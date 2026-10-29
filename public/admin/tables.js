let tables = [];
let tableZones = [];
let editingId = null;

// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).
async function loadTables() {
  const box = document.getElementById('tableList');
  try {
    [tables, tableZones] = await Promise.all([
      api('/admin/tables'),
      api('/admin/tables/zones'),
    ]);
    render();
  } catch (err) {
    box.innerHTML = `<p class="helper-text">${escapeHtml(err.message)}</p>`;
  }
}

// Stollarni joy (zal/tashqari) bo'yicha guruhlaydi. Joy umuman qo'shilmagan
// bo'lsa (tableZones bo'sh), guruh sarlavhasi ko'rsatmasdan oddiy ro'yxat
// chiqadi — zonalar funksiyasi hali ishlatilmaganlarga keraksiz "Joysiz"
// yorlig'i bilan bezovta qilmasin.
function groupTablesByZone() {
  const grouped = tableZones.map((zone) => ({ zone, items: tables.filter((t) => t.zone_id === zone.id) }));
  const ungrouped = tables.filter((t) => !t.zone_id);
  return grouped.concat(ungrouped.length ? [{ zone: null, items: ungrouped }] : []);
}

function tableCardHtml(t) {
  // O'chirilgan stol uchun faqat "♻️ Tiklash" ko'rsatiladi — ilgari bu
  // badge abadiy osilib qolardi, tiklash yo'li umuman yo'q edi (2026-10-28
  // audit, public/admin/menu.js'dagi tiklash naqshi bilan bir xil).
  if (!t.is_active) {
    return `
    <div class="card">
      <div class="card-title">${escapeHtml(t.name)} <span class="badge-red">o'chirilgan</span></div>
      <div class="card-actions" style="margin-top:8px;">
        <button class="btn small" data-restore="${t.id}">♻️ Tiklash</button>
      </div>
    </div>
  `;
  }
  return `
    <div class="card">
      <div class="card-title">${escapeHtml(t.name)}</div>
      <div class="card-actions" style="margin-top:8px;">
        <button class="btn small" data-edit="${t.id}">Tahrirlash</button>
        <a class="btn small" href="${API_BASE}api/admin/tables/${t.id}/qr" download="qr-${encodeURIComponent(t.name)}.png">QR kod</a>
        <button class="btn small danger" data-del="${t.id}">O'chirish</button>
      </div>
    </div>
  `;
}

function render() {
  const box = document.getElementById('tableList');
  if (tables.length === 0) {
    box.innerHTML = '<p class="helper-text">Hali stol qo\'shilmagan.</p>';
    return;
  }
  const groups = groupTablesByZone();
  const showHeadings = tableZones.length > 0;
  box.innerHTML = groups.map(({ zone, items }) => `
    <div class="page-section">
      ${showHeadings ? `
        <div class="page-section-head">
          <h2 class="page-section-title">${zone ? escapeHtml(zone.name) : 'Joysiz'}</h2>
          <span class="helper-text">${items.length} ta stol</span>
        </div>
      ` : ''}
      <div class="data-list as-grid">${items.length ? items.map(tableCardHtml).join('') : '<p class="helper-text">Bu joyda hali stol yo\'q.</p>'}</div>
    </div>
  `).join('');
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openModal(Number(b.dataset.edit))));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => delTable(Number(b.dataset.del))));
  box.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => restoreTable(Number(b.dataset.restore))));
}

async function restoreTable(id) {
  try {
    await api(`/admin/tables/${id}`, { method: 'PUT', body: { is_active: true } });
    toast('Stol tiklandi');
    loadTables();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function fillZoneSelect(selectedZoneId) {
  const sel = document.getElementById('fZone');
  sel.innerHTML = '<option value="">Joysiz</option>' + tableZones.map((z) => `<option value="${z.id}">${escapeHtml(z.name)}</option>`).join('');
  sel.value = selectedZoneId ? String(selectedZoneId) : '';
}

function openModal(id) {
  editingId = id;
  const t = tables.find((x) => x.id === id);
  document.getElementById('modalTitle').textContent = t ? 'Stolni tahrirlash' : 'Yangi stol';
  document.getElementById('fName').value = t ? t.name : '';
  document.getElementById('fSort').value = t ? t.sort_order : 0;
  fillZoneSelect(t ? t.zone_id : null);
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); editingId = null; }

document.getElementById('addBtn').addEventListener('click', () => openModal(null));
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('saveBtn').addEventListener('click', async () => {
  const name = document.getElementById('fName').value.trim();
  const sort_order = Number(document.getElementById('fSort').value) || 0;
  const zoneVal = document.getElementById('fZone').value;
  const zone_id = zoneVal ? Number(zoneVal) : null;
  if (!name) return toast('Nomini kiriting', 'error');
  try {
    if (editingId) {
      await api(`/admin/tables/${editingId}`, { method: 'PUT', body: { name, sort_order, zone_id } });
    } else {
      await api('/admin/tables', { method: 'POST', body: { name, sort_order, zone_id } });
    }
    closeModal();
    toast('Saqlandi');
    loadTables();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function delTable(id) {
  if (!confirm("Stolni o'chirasizmi?")) return;
  try {
    await api(`/admin/tables/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    loadTables();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------- Joylar (Zal/Tashqari guruhlash) ----------------

function renderZoneList() {
  const box = document.getElementById('zoneList');
  if (tableZones.length === 0) {
    box.innerHTML = '<p class="dim" style="font-size:12px;">Hali joy yo\'q — pastdan qo\'shing.</p>';
    return;
  }
  box.innerHTML = tableZones.map((z) => `
    <div class="card-row" style="padding:6px 0; border-bottom:1px solid var(--border); gap:8px;">
      <input data-zone-name-input="${z.id}" value="${escapeHtml(z.name)}" style="flex:1;">
      <button class="btn small" data-zone-save="${z.id}">Saqlash</button>
      <button class="btn small danger" data-zone-del="${z.id}">🗑</button>
    </div>
  `).join('');
  box.querySelectorAll('[data-zone-save]').forEach((b) => b.addEventListener('click', () => saveZoneName(Number(b.dataset.zoneSave))));
  box.querySelectorAll('[data-zone-del]').forEach((b) => b.addEventListener('click', () => delZone(Number(b.dataset.zoneDel))));
}

function openZoneModal() {
  document.getElementById('newZoneName').value = '';
  renderZoneList();
  document.getElementById('zoneModal').classList.remove('hidden');
}
document.getElementById('zonesBtn').addEventListener('click', openZoneModal);
document.getElementById('zoneCloseBtn').addEventListener('click', () => {
  document.getElementById('zoneModal').classList.add('hidden');
  render();
});

async function saveZoneName(id) {
  const input = document.querySelector(`[data-zone-name-input="${id}"]`);
  const name = input.value.trim();
  if (!name) return toast('Nomini kiriting', 'error');
  try {
    await api(`/admin/tables/zones/${id}`, { method: 'PUT', body: { name } });
    toast('Saqlandi');
    await loadTables();
    renderZoneList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function delZone(id) {
  const zone = tableZones.find((z) => z.id === id);
  const ok = await customConfirm(`"${zone ? zone.name : 'joy'}"ni o'chirasizmi? Unga tegishli stollar "Joysiz" bo'lib qoladi.`);
  if (!ok) return;
  try {
    await api(`/admin/tables/zones/${id}`, { method: 'DELETE' });
    toast("O'chirildi");
    await loadTables();
    renderZoneList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.getElementById('addZoneSaveBtn').addEventListener('click', async () => {
  const name = document.getElementById('newZoneName').value.trim();
  if (!name) return toast('Nomini kiriting', 'error');
  try {
    await api('/admin/tables/zones', { method: 'POST', body: { name, sort_order: tableZones.length } });
    document.getElementById('newZoneName').value = '';
    toast('Qo\'shildi');
    await loadTables();
    renderZoneList();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initLayout('tables');
  loadTables();
});
