// Markazlashgan audit jurnali — "Audit izi" auditi (2026-10-10). Bu modul
// FAQAT yozadi (`logAudit`) va o'qiydi (`listAuditLog`) — hech qanday
// UPDATE/DELETE funksiyasi yo'q, ataylab: `audit_log` jadvali ilova
// darajasida "faqat qo'shiladigan" bo'lishi shu bilan ta'minlanadi.
const { db, nowIso } = require('../db');

function logAudit(action, entityType, entityId, oldValue, newValue, userId) {
  db.prepare(
    `INSERT INTO audit_log (action, entity_type, entity_id, old_value, new_value, performed_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    action,
    entityType,
    entityId,
    oldValue === undefined || oldValue === null ? null : JSON.stringify(oldValue),
    JSON.stringify(newValue),
    userId || null,
    nowIso()
  );
}

function listAuditLog({ limit = 200 } = {}) {
  const lim = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 500) : 200;
  return db
    .prepare(
      `SELECT al.*, COALESCE(u.full_name, u.username) AS performed_by_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.performed_by
       ORDER BY al.id DESC
       LIMIT ?`
    )
    .all(lim);
}

module.exports = { logAudit, listAuditLog };
