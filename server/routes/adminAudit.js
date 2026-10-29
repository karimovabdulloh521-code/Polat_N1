// Admin "Audit" sahifasi uchun — faqat o'qish. "Audit izi" auditi
// (2026-10-10): shubhali harakatlar hisoboti (kim ko'p bekor qilgan/qo'lda
// chek yozgan) + markazlashgan audit jurnali (narx/rol o'zgarishi) +
// muvaffaqiyatsiz login urinishlari.
const express = require('express');
const { db } = require('../db');
const { asyncRoute } = require('../routeUtils');
const { listAuditLog } = require('../services/auditLog');

const router = express.Router();

router.get('/summary', asyncRoute((req, res) => {
  const cancellations = db
    .prepare(
      `SELECT oi.cancelled_by AS user_id, COALESCE(u.full_name, u.username) AS employee_name,
              COUNT(*) AS cancelled_count, COALESCE(SUM(oi.subtotal), 0) AS cancelled_amount
       FROM order_items oi
       LEFT JOIN users u ON u.id = oi.cancelled_by
       WHERE oi.status = 'cancelled' AND oi.cancelled_at >= datetime('now', '-30 days')
       GROUP BY oi.cancelled_by
       ORDER BY cancelled_count DESC`
    )
    .all();

  const manualBills = db
    .prepare(
      `SELECT mb.created_by AS user_id, COALESCE(u.full_name, u.username) AS employee_name,
              COUNT(*) AS bill_count, COALESCE(SUM(mb.total_amount), 0) AS bill_amount
       FROM manual_bills mb
       JOIN users u ON u.id = mb.created_by
       WHERE mb.created_at >= datetime('now', '-30 days')
       GROUP BY mb.created_by
       ORDER BY bill_amount DESC`
    )
    .all();

  const failedLogins = db
    .prepare(
      `SELECT username, COUNT(*) AS attempt_count, MAX(created_at) AS last_attempt
       FROM login_attempts
       WHERE success = 0 AND created_at >= datetime('now', '-30 days')
       GROUP BY username
       ORDER BY attempt_count DESC
       LIMIT 50`
    )
    .all();

  res.json({
    cancellations,
    manualBills,
    failedLogins,
    auditLog: listAuditLog({ limit: 100 }),
  });
}));

module.exports = router;
