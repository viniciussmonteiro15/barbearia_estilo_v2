require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "barbearia.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    services_json TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('pix', 'later')),
    payment_status TEXT NOT NULL DEFAULT 'pending',
    status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked', 'cancelled', 'completed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migra bancos criados por versões anteriores que usavam UNIQUE(date, time, status).
// A restrição antiga impede cancelar novamente um horário que já foi cancelado antes.
const appointmentSchema = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'appointments'"
).get()?.sql || "";

if (/UNIQUE\s*\(\s*date\s*,\s*time\s*,\s*status\s*\)/i.test(appointmentSchema)) {
  const migrateAppointments = db.transaction(() => {
    db.exec(`
      CREATE TABLE appointments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        services_json TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        payment_method TEXT NOT NULL CHECK(payment_method IN ('pix', 'later')),
        payment_status TEXT NOT NULL DEFAULT 'pending',
        status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked', 'cancelled', 'completed')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO appointments_new
        (id, name, phone, date, time, services_json, total_cents, payment_method, payment_status, status, created_at)
      SELECT id, name, phone, date, time, services_json, total_cents, payment_method, payment_status, status, created_at
      FROM appointments;

      DROP TABLE appointments;
      ALTER TABLE appointments_new RENAME TO appointments;
    `);
  });
  migrateAppointments();
}

// Impede dois agendamentos ativos que comecem exatamente no mesmo horário.
// O bloqueio de intervalos sobrepostos também é validado no servidor abaixo.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_booked_slot
  ON appointments(date, time)
  WHERE status = 'booked';
`);

const defaultSettings = {
  openDays: JSON.stringify([1, 2, 3, 4, 5, 6]),
  openTime: "09:00",
  closeTime: "18:00",
  slotMinutes: "30",
  closedDates: JSON.stringify([])
};
const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value);

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const SERVICES = {
  degrade: { id: "degrade", name: "Corte degradê", priceCents: 4000, duration: 30 },
  barba: { id: "barba", name: "Barba", priceCents: 1500, duration: 30 },
  zero: { id: "zero", name: "Raspar na zero", priceCents: 2500, duration: 30 }
};

function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const result = {};
  for (const row of rows) {
    try { result[row.key] = JSON.parse(row.value); }
    catch { result[row.key] = row.value; }
  }
  return result;
}
function money(cents) { return (cents / 100).toFixed(2); }
function validDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}
function timeToMinutes(time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return -1;
  const [h, m] = time.split(":").map(Number);
  if (h > 23 || m > 59) return -1;
  return h * 60 + m;
}
function currentDateLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseServices(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3) return null;
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.some(id => !SERVICES[id])) return null;
  return uniqueIds.map(id => SERVICES[id]);
}
function getAppointmentDuration(servicesJson) {
  try {
    const savedServices = JSON.parse(servicesJson);
    if (Array.isArray(savedServices) && savedServices.length) {
      const duration = savedServices.reduce((sum, service) => {
        const knownService = SERVICES[service?.id];
        return sum + (Number(service?.duration) || knownService?.duration || 0);
      }, 0);
      if (duration > 0) return duration;
    }
  } catch {
    // Dados antigos ou inválidos usam a duração mínima segura.
  }
  return 30;
}
function hasOverlappingAppointment(date, time, duration, excludeId = null) {
  const start = timeToMinutes(time);
  if (start < 0) return true;

  const rows = db.prepare(
    "SELECT id, time, services_json FROM appointments WHERE date = ? AND status = 'booked' AND id != COALESCE(?, -1)"
  ).all(date, excludeId);

  return rows.some((row) => {
    const occupiedStart = timeToMinutes(row.time);
    if (occupiedStart < 0) return false;
    const occupiedEnd = occupiedStart + getAppointmentDuration(row.services_json);
    return start < occupiedEnd && start + duration > occupiedStart;
  });
}
function adminAuth(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || expected === "troque-esta-senha") {
    return res.status(503).json({ error: "Configure ADMIN_PASSWORD no arquivo .env antes de usar o painel administrativo." });
  }
  const provided = req.get("x-admin-password");
  if (!provided || provided !== expected) return res.status(401).json({ error: "Senha administrativa incorreta." });
  next();
}
function isOpenDate(date, settings) {
  const day = new Date(date + "T12:00:00").getDay();
  return settings.openDays.includes(day) && !settings.closedDates.includes(date);
}
function getAvailableSlots(date, serviceIds = []) {
  const settings = getSettings();
  if (!validDate(date) || date < currentDateLocal() || !isOpenDate(date, settings)) return [];
  const start = timeToMinutes(settings.openTime);
  const end = timeToMinutes(settings.closeTime);
  const slot = Number(settings.slotMinutes) || 30;
  if (start < 0 || end <= start || slot < 15 || slot > 120) return [];
  const requestedServices = serviceIds.length ? parseServices(serviceIds) : [SERVICES.degrade];
  if (!requestedServices) return [];
  const duration = requestedServices.reduce((sum, service) => sum + service.duration, 0);
  if (duration <= 0 || duration > end - start) return [];

  const booked = db.prepare(
    "SELECT time, services_json FROM appointments WHERE date = ? AND status = 'booked'"
  ).all(date).map((row) => {
    const bookedStart = timeToMinutes(row.time);
    return {
      start: bookedStart,
      end: bookedStart < 0 ? bookedStart : bookedStart + getAppointmentDuration(row.services_json)
    };
  });

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const slots = [];
  for (let minute = start; minute + duration <= end; minute += slot) {
    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const overlaps = booked.some((booking) =>
      booking.start >= 0 && minute < booking.end && minute + duration > booking.start
    );
    if (!overlaps && (date !== currentDateLocal() || minute > nowMinutes)) slots.push(time);
  }
  return slots;
}
function appointmentDto(row) {
  return {
    id: row.id, name: row.name, phone: row.phone, date: row.date, time: row.time,
    services: JSON.parse(row.services_json), total: Number(money(row.total_cents)),
    paymentMethod: row.payment_method, paymentStatus: row.payment_status,
    status: row.status, createdAt: row.created_at
  };
}

app.get("/api/services", (req, res) => {
  res.json(Object.values(SERVICES).map(s => ({ id: s.id, name: s.name, price: Number(money(s.priceCents)), duration: s.duration })));
});
app.get("/api/settings/public", (req, res) => {
  const s = getSettings();
  res.json({ openDays: s.openDays, openTime: s.openTime, closeTime: s.closeTime, slotMinutes: Number(s.slotMinutes), name: process.env.BARBERSHOP_NAME || "Barbearia Estilo", phone: String(process.env.BARBERSHOP_PHONE || "").replace(/\D/g, "") });
});
app.get("/api/slots", (req, res) => {
  const rawServiceIds = req.query.serviceIds;
  const serviceIds = rawServiceIds == null || rawServiceIds === ""
    ? []
    : (Array.isArray(rawServiceIds) ? rawServiceIds : [rawServiceIds])
      .flatMap((value) => String(value).split(","))
      .map((id) => id.trim())
      .filter(Boolean);
  if (serviceIds.length && !parseServices(serviceIds)) {
    return res.status(400).json({ error: "A seleção de serviços é inválida." });
  }
  const date = String(req.query.date || "");
  res.json({ date, slots: getAvailableSlots(date, serviceIds) });
});

app.post("/api/appointments", (req, res) => {
  const { name, phone, date, time, serviceIds, paymentMethod } = req.body || {};
  if (typeof name !== "string" || name.trim().split(/\s+/).length < 2 || name.trim().length > 100) {
    return res.status(400).json({ error: "Informe seu nome completo." });
  }
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return res.status(400).json({ error: "Informe um celular válido com DDD." });
  if (!validDate(date) || date < currentDateLocal()) return res.status(400).json({ error: "Escolha uma data válida, hoje ou no futuro." });
  if (timeToMinutes(time) < 0) return res.status(400).json({ error: "Escolha um horário válido." });
  if (!["pix", "later"].includes(paymentMethod)) return res.status(400).json({ error: "Escolha uma forma de pagamento." });
  const services = parseServices(serviceIds);
  if (!services) return res.status(400).json({ error: "Escolha pelo menos um serviço válido." });
  const slots = getAvailableSlots(date, services.map((service) => service.id));
  if (!slots.includes(time)) return res.status(409).json({ error: "Esse horário não está mais disponível. Escolha outro horário." });

  const totalCents = services.reduce((sum, service) => sum + service.priceCents, 0);
  try {
    const result = db.prepare(`
      INSERT INTO appointments (name, phone, date, time, services_json, total_cents, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name.trim(), digits, date, time, JSON.stringify(services.map(s => ({ id: s.id, name: s.name, price: Number(money(s.priceCents)), duration: s.duration }))), totalCents, paymentMethod);
    const row = db.prepare("SELECT * FROM appointments WHERE id = ?").get(result.lastInsertRowid);
    const pix = {
      mode: process.env.PIX_MODE || "demo",
      message: paymentMethod === "pix"
        ? "Pix ainda está em modo de demonstração. Nenhum pagamento foi cobrado."
        : "O pagamento será feito presencialmente na barbearia."
    };
    res.status(201).json({ appointment: appointmentDto(row), pix });
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "Alguém acabou de reservar esse horário. Escolha outro." });
    }
    console.error(error);
    res.status(500).json({ error: "Não foi possível registrar o agendamento." });
  }
});

app.get("/api/admin/appointments", adminAuth, (req, res) => {
  const date = String(req.query.date || "");
  let rows;
  if (date && validDate(date)) {
    rows = db.prepare("SELECT * FROM appointments WHERE date = ? ORDER BY time").all(date);
  } else {
    rows = db.prepare("SELECT * FROM appointments ORDER BY date DESC, time DESC LIMIT 300").all();
  }
  res.json({ appointments: rows.map(appointmentDto) });
});
app.patch("/api/admin/appointments/:id", adminAuth, (req, res) => {
  const id = Number(req.params.id);
  const { status, paymentStatus } = req.body || {};
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Agendamento inválido." });
  if (status !== undefined && !["booked", "cancelled", "completed"].includes(status)) return res.status(400).json({ error: "Status inválido." });
  if (paymentStatus !== undefined && !["pending", "paid"].includes(paymentStatus)) return res.status(400).json({ error: "Status de pagamento inválido." });
  const existing = db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Agendamento não encontrado." });

  if (status === "booked" && existing.status !== "booked") {
    const duration = getAppointmentDuration(existing.services_json);
    if (hasOverlappingAppointment(existing.date, existing.time, duration, id)) {
      return res.status(409).json({ error: "Não é possível reativar este agendamento: o horário conflita com outro atendimento." });
    }
  }

  try {
    const updateAppointment = db.transaction(() => {
      if (status !== undefined) db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, id);
      if (paymentStatus !== undefined) db.prepare("UPDATE appointments SET payment_status = ? WHERE id = ?").run(paymentStatus, id);
    });
    updateAppointment();
    res.json({ appointment: appointmentDto(db.prepare("SELECT * FROM appointments WHERE id = ?").get(id)) });
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "Este horário já está ocupado por outro agendamento." });
    }
    console.error(error);
    res.status(500).json({ error: "Não foi possível atualizar o agendamento." });
  }
});
app.get("/api/admin/settings", adminAuth, (req, res) => res.json(getSettings()));
app.put("/api/admin/settings", adminAuth, (req, res) => {
  const { openDays, openTime, closeTime, slotMinutes, closedDates } = req.body || {};
  const start = timeToMinutes(openTime), end = timeToMinutes(closeTime), slot = Number(slotMinutes);
  if (!Array.isArray(openDays) || openDays.some(d => !Number.isInteger(d) || d < 0 || d > 6) ||
      start < 0 || end <= start || !Number.isInteger(slot) || slot < 15 || slot > 120 ||
      !Array.isArray(closedDates) || closedDates.some(d => !validDate(d))) {
    return res.status(400).json({ error: "Confira os dias, horários, duração dos intervalos e datas fechadas." });
  }
  const values = { openDays: JSON.stringify([...new Set(openDays)]), openTime, closeTime, slotMinutes: String(slot), closedDates: JSON.stringify([...new Set(closedDates)]) };
  const update = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const transaction = db.transaction(() => Object.entries(values).forEach(([k,v]) => update.run(k,v)));
  transaction();
  res.json({ ok: true, settings: getSettings() });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Barbearia Estilo rodando em http://localhost:${PORT}`));
