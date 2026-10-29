const crypto = require('crypto');
const { WebSocketServer } = require('ws');

// Oshxona printer agenti (WebSocket push). 2026-10-24 tuzatishlari:
//  1. PRINT_TOKEN bo'lmasa server endi YIQILMAYDI — printer o'chirilgan
//     rejimda ishlaydi (cheklar navbatga yoziladi, token qo'yilib server qayta
//     ishga tushgach agent ulanganda chiqadi). Ilgari `throw` server
//     `listen()`dan KEYIN otilib, butun jarayonni yiqitardi.
//  2. Navbatdagi cheklarning muddati bor (PRINT_JOB_MAX_AGE_MIN, standart
//     120 daqiqa). Agent uzoq oflayn bo'lib qayta ulanganda bir necha
//     kunlik eski cheklar birdan chiqib ketmaydi — ular `printed = 2`
//     (muddati o'tgan) deb belgilanadi va qayta yuborilmaydi.
//  3. Takroriy chop etishdan himoya: har bir chek yuborilganda `sent_count`
//     oshadi. Qayta yuborishda `retry: true` va `attempt` maydoni qo'shiladi —
//     agent chek `id`si bo'yicha takrorni tanib olishi mumkin. MAX_ATTEMPTS'dan
//     oshgan chek boshqa yuborilmaydi (cheksiz qayta chiqmaydi).
//  4. Token `timingSafeEqual` bilan taqqoslanadi.
const MAX_AGE_MIN = Math.max(1, Number(process.env.PRINT_JOB_MAX_AGE_MIN) || 120);
const MAX_ATTEMPTS = 3;

function safeTokenEqual(header, token) {
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS print_jobs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    payload    TEXT    NOT NULL,
    printed    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
  // printed: 0 = kutilmoqda, 1 = chop etildi, 2 = muddati o'tdi / urinishlar tugadi
  const cols = db.prepare('PRAGMA table_info(print_jobs)').all().map((c) => c.name);
  if (!cols.includes('sent_count')) {
    db.exec('ALTER TABLE print_jobs ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('last_sent_at')) {
    db.exec('ALTER TABLE print_jobs ADD COLUMN last_sent_at TEXT');
  }
}

function setupKitchenPrinter(server, db, token) {
  ensureSchema(db);

  const insertJob = db.prepare('INSERT INTO print_jobs (payload) VALUES (?)');
  const expireOld = db.prepare(
    `UPDATE print_jobs SET printed = 2
      WHERE printed = 0
        AND (created_at < datetime('now', ?) OR sent_count >= ?)`
  );
  const pendingJobs = db.prepare(
    'SELECT id, payload, sent_count FROM print_jobs WHERE printed = 0 ORDER BY id'
  );
  const markSent = db.prepare(
    "UPDATE print_jobs SET sent_count = sent_count + 1, last_sent_at = datetime('now') WHERE id = ?"
  );
  const markPrinted = db.prepare('UPDATE print_jobs SET printed = 1 WHERE id = ? AND printed = 0');

  function expire() {
    const r = expireOld.run(`-${MAX_AGE_MIN} minutes`, MAX_ATTEMPTS);
    if (r.changes > 0) {
      console.log(`Oshxona printeri: ${r.changes} ta eski/yuborilmagan chek muddati o'tgan deb belgilandi.`);
    }
  }

  if (!token) {
    console.warn(
      "OGOHLANTIRISH: PRINT_TOKEN berilmagan — oshxona printer agenti O'CHIRILGAN. " +
      "Cheklar navbatga yoziladi, lekin chop etilmaydi. .env'ga PRINT_TOKEN qo'shib serverni qayta ishga tushiring."
    );
    return {
      printOrder(order) {
        const { lastInsertRowid } = insertJob.run(JSON.stringify(order));
        return Number(lastInsertRowid);
      },
      isAgentOnline: () => false,
      enabled: false,
    };
  }

  const wss = new WebSocketServer({ server, path: '/print-agent' });
  let agent = null;

  function sendJob(ws, id, order, sentCount) {
    const msg = { type: 'job', id, order };
    if (sentCount > 0) {
      msg.retry = true;
      msg.attempt = sentCount + 1;
    }
    ws.send(JSON.stringify(msg));
    markSent.run(id);
  }

  function flushPending(ws) {
    expire();
    for (const job of pendingJobs.all()) {
      let order;
      try {
        order = JSON.parse(job.payload);
      } catch {
        db.prepare('UPDATE print_jobs SET printed = 2 WHERE id = ?').run(job.id);
        continue;
      }
      sendJob(ws, job.id, order, job.sent_count);
    }
  }

  wss.on('connection', (ws, req) => {
    if (!safeTokenEqual(req.headers.authorization, token)) {
      return ws.close(1008, "Ruxsat yo'q");
    }
    if (agent) agent.terminate();
    agent = ws;
    ws.isAlive = true;
    console.log('Oshxona agenti ulandi');

    flushPending(ws);

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'printed' && Number.isInteger(Number(msg.id))) {
          markPrinted.run(Number(msg.id));
        }
      } catch {}
    });
    ws.on('close', () => {
      if (agent === ws) agent = null;
      console.log('Oshxona agenti uzildi');
    });
  });

  const timer = setInterval(() => {
    if (!agent) return;
    if (!agent.isAlive) return agent.terminate();
    agent.isAlive = false;
    agent.ping();
  }, 20000);
  // Agent ulanmagan paytda ham eski cheklar vaqtida "muddati o'tdi" bo'lsin.
  const expireTimer = setInterval(expire, 10 * 60 * 1000);
  wss.on('close', () => { clearInterval(timer); clearInterval(expireTimer); });

  function printOrder(order) {
    const { lastInsertRowid } = insertJob.run(JSON.stringify(order));
    const id = Number(lastInsertRowid);
    if (agent && agent.readyState === agent.OPEN) sendJob(agent, id, order, 0);
    return id;
  }

  return { printOrder, isAgentOnline: () => agent !== null, enabled: true };
}

module.exports = { setupKitchenPrinter };
