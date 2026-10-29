let users = [];
let editingId = null;
let resettingId = null;

// escapeHtml() — endi ../app.js'dan global (2026-09-09'da 15 xil fayldagi
// nusxa birlashtirildi).
//
// ROLE_LABEL/ROLE_BADGE quyida — bu ro'yxat server/roles.js'dagi kabi
// mustaqil (build tizimi yo'q, oddiy <script> fayllar bu yerdan
// server-side modulni ulab bo'lmaydi): kelajakda yangi rol qo'shilsa,
// server/roles.js bilan BIRGA shu ro'yxatga ham (va public/login.html'dagi
// redirect switch'iga) qo'lda qo'shish kerak.
const ROLE_LABEL = { admin: 'admin', waiter: 'afitsiant', chef: 'oshpaz', courier: 'dastavka', kassir: 'kassir' };
const ROLE_BADGE = { admin: 'gold', waiter: 'green', chef: 'dim', courier: 'green', kassir: 'dim' };

async function loadUsers() {
  const box = document.getElementById('userList');
  try {
    users = await api('/admin/users');
    box.innerHTML = users.map((u) => {
      const canHardDelete = !u.has_activity;
      let actionBtns = '';
      if (u.is_active) {
        const label = canHardDelete ? "O'chirish" : 'Faolsizlantirish';
        actionBtns = `<button class="btn small danger" data-del="${u.id}" data-hard="${canHardDelete}">${label}</button>`;
      } else {
        actionBtns = `<button class="btn small" data-activate="${u.id}">Faollashtirish</button>`;
        if (canHardDelete) {
          actionBtns += `<button class="btn small danger" data-del="${u.id}" data-hard="true">Butunlay o'chirish</button>`;
        }
      }
      return `
      <div class="card">
        <div class="card-title">${escapeHtml(u.full_name || u.username)} <span class="badge badge-${ROLE_BADGE[u.role] || 'green'}">${ROLE_LABEL[u.role] || u.role}</span> ${u.is_active ? '' : '<span class="badge badge-dim">faolsiz</span>'}</div>
        <div class="card-sub">login: ${escapeHtml(u.username)}</div>
        <div class="card-sub">${u.last_login_at ? `Oxirgi kirish: ${fmtDateTime(u.last_login_at)}${u.last_login_ip ? ' · ' + escapeHtml(u.last_login_ip) : ''}` : 'Hali hech kirmagan'}</div>
        <div class="card-actions" style="margin-top:8px;">
          <button class="btn small" data-edit="${u.id}">Tahrirlash</button>
          <button class="btn small" data-reset="${u.id}">Parolni tiklash</button>
          ${actionBtns}
        </div>
      </div>
    `;
    }).join('');
    box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openModal(Number(b.dataset.edit))));
    box.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => openResetModal(Number(b.dataset.reset))));
    box.querySelectorAll('[data-activate]').forEach((b) => b.addEventListener('click', () => activateUser(Number(b.dataset.activate))));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => delUser(Number(b.dataset.del), b.dataset.hard === 'true')));
  } catch (err) {
    box.innerHTML = `<p class="helper-text">${escapeHtml(err.message)}</p>`;
  }
}

function openModal(id) {
  editingId = id;
  const u = id ? users.find((x) => x.id === id) : null;
  document.getElementById('modalTitle').textContent = u ? 'Foydalanuvchini tahrirlash' : 'Yangi foydalanuvchi';
  document.getElementById('fUsername').value = u ? u.username : '';
  document.getElementById('fUsername').disabled = !!u;
  document.getElementById('fPassword').value = '';
  document.getElementById('passField').style.display = u ? 'none' : '';
  document.getElementById('fFullName').value = u ? (u.full_name || '') : '';
  document.getElementById('fRole').value = u ? u.role : 'waiter';
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); editingId = null; }

document.getElementById('addBtn').addEventListener('click', () => openModal(null));
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('saveBtn').addEventListener('click', async () => {
  const full_name = document.getElementById('fFullName').value.trim();
  const role = document.getElementById('fRole').value;
  try {
    if (editingId) {
      await api(`/admin/users/${editingId}`, { method: 'PUT', body: { full_name, role } });
    } else {
      const username = document.getElementById('fUsername').value.trim();
      const password = document.getElementById('fPassword').value;
      if (!username) return toast('Login kiriting', 'error');
      if (!password || password.length < 6) return toast('Parol kamida 6 belgi', 'error');
      await api('/admin/users', { method: 'POST', body: { username, password, role, full_name } });
    }
    closeModal();
    toast('Saqlandi');
    loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
});

function openResetModal(id) {
  resettingId = id;
  document.getElementById('rPassword').value = '';
  document.getElementById('resetModal').classList.remove('hidden');
}
document.getElementById('resetCancelBtn').addEventListener('click', () => document.getElementById('resetModal').classList.add('hidden'));
document.getElementById('resetSaveBtn').addEventListener('click', async () => {
  const password = document.getElementById('rPassword').value;
  if (!password || password.length < 6) return toast('Parol kamida 6 belgi', 'error');
  try {
    await api(`/admin/users/${resettingId}/reset-password`, { method: 'POST', body: { password } });
    document.getElementById('resetModal').classList.add('hidden');
    toast('Parol yangilandi');
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function delUser(id, hard) {
  const msg = hard
    ? "Bu xodimni butunlay o'chirasizmi? Bu amalni ortga qaytarib bo'lmaydi."
    : "Bu foydalanuvchini faolsizlantirasizmi? U endi tizimga kira olmaydi.";
  if (!confirm(msg)) return;
  try {
    const res = await api(`/admin/users/${id}`, { method: 'DELETE' });
    toast(res && res.hardDeleted ? "O'chirildi" : 'Faolsizlantirildi');
    loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function activateUser(id) {
  try {
    await api(`/admin/users/${id}`, { method: 'PUT', body: { is_active: true } });
    toast('Faollashtirildi');
    loadUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLayout('waiters');
  loadUsers();
});
