// Avtomatik kunlik baza zaxirasi (2026-09-16, savdo-hisob/tolov-bot'dagi bilan
// bir xil sabab bilan qo'shildi — ilgari polat.db'ning umuman avtomatik
// zaxirasi yo'q edi, faqat bitta qo'lda olingan eski nusxa bor edi). Ishga
// tushganda va har BACKUP_INTERVAL_HOURS soatda better-sqlite3'ning
// `db.backup()` metodi (WAL-xavfsiz, jarayon ishlab turgan holda ham izchil
// nusxa oladi) bilan `data/backups/`ga yozadi, so'ng BACKUP_KEEP sonidan
// ortiq eski nusxalarni o'chiradi.
const path = require('path');
const fs = require('fs');
const { db, DB_PATH } = require('./db');

const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 14);
const BACKUP_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS || 24);

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function cleanupOldBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('polat-') && f.endsWith('.db'))
    .sort();
  while (files.length > BACKUP_KEEP) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, oldest));
    console.log(`Backup: eski nusxa o'chirildi (${oldest}).`);
  }
}

async function runBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `polat-${stamp}.db`);
  try {
    await db.backup(dest);
    console.log(`Backup: '${dest}' yaratildi.`);
    cleanupOldBackups();
  } catch (err) {
    console.error('Backup xatosi:', err);
  }
}

// `notifications` jadvali hech qachon tozalanmasdi — har "taom tayyor"/"yangi
// yetkazib berish" voqeasi doimiy qator qoldirib, jadval cheksiz o'sardi
// (2026-10-10, "Real-time va ishonchlilik" auditi). Faqat ALLAQACHON
// tasdiqlangan (acknowledged_at bor) va 30 kundan oqqan yozuvlar o'chiriladi —
// hali tasdiqlanmagan (joriy) bildirishnomalarga tegilmaydi.
function cleanupOldNotifications() {
  const result = db
    .prepare("DELETE FROM notifications WHERE acknowledged_at IS NOT NULL AND acknowledged_at < datetime('now', '-30 days')")
    .run();
  if (result.changes > 0) {
    console.log(`Tozalash: ${result.changes} ta eski bildirishnoma o'chirildi.`);
  }
}

function startBackupSchedule() {
  runBackup();
  cleanupOldNotifications();
  setInterval(runBackup, BACKUP_INTERVAL_HOURS * 60 * 60 * 1000);
  setInterval(cleanupOldNotifications, 24 * 60 * 60 * 1000);
}

module.exports = { runBackup, startBackupSchedule, cleanupOldNotifications };
