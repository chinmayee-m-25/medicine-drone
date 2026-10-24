require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mqtt = require("mqtt");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const PREFIX = "medicinedrone/chinmayee25";
const FILE = __dirname + "/store.db";
const UPLOADS = path.join(__dirname, "uploads");
const VERSION = 2;
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ---------- Email and SMS ----------
const mailer =
  process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      })
    : null;
const twilioOn = process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM;
const fastOn = (process.env.SMS_PROVIDER || "").toLowerCase() === "fast2sms" && process.env.FAST2SMS_KEY;

function fixPhone(p) {
  const d = String(p || "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return d;
  if (d.length === 10) return "+91" + d;
  return "+" + d;
}

// Turns any message into a short plain-text SMS
function smsText(text) {
  const clean = String(text).replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  return ("MediDrone: " + clean).slice(0, 300);
}

function sendSms(phone, text) {
  const to = fixPhone(phone);
  if (!to) return;
  const body = smsText(text);

  if (fastOn) {
    const number = to.replace(/\D/g, "").slice(-10);
    fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: { authorization: process.env.FAST2SMS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ route: "q", message: body, numbers: number, flash: 0 }),
    })
      .then(async (r) => {
        const d = await r.json();
        console.log(d.return ? "SMS sent to " + number : "SMS failed: " + d.message);
      })
      .catch((e) => console.log("SMS failed:", e.message));
  } else if (twilioOn) {
    fetch("https://api.twilio.com/2010-04-01/Accounts/" + process.env.TWILIO_SID + "/Messages.json", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(process.env.TWILIO_SID + ":" + process.env.TWILIO_TOKEN).toString("base64"),
      },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: body }),
    })
      .then(async (r) => {
        if (!r.ok) console.log("SMS failed:", (await r.json()).message);
        else console.log("SMS sent to " + to);
      })
      .catch((e) => console.log("SMS failed:", e.message));
  } else {
    console.log("[demo sms to " + to + "] " + body);
  }
}

function sendOut(email, phone, text) {
  if (email) {
    if (mailer) {
      mailer
        .sendMail({
          from: "MediDrone <" + process.env.EMAIL_USER + ">",
          to: email,
          subject: "MediDrone update",
          text,
        })
        .catch((e) => console.log("Email failed:", e.message));
    } else console.log("[demo email to " + email + "] " + text);
  }
  sendSms(phone, text);
}

// ---------- Data ----------
const M = (name, category, icon, desc, price, stock, rx) =>
  ({ name, category, icon, desc, price, stock, low: Math.ceil(stock / 5), rx });

function fresh() {
  const list = [
    M("Paracetamol 500mg", "Fever and Pain", "💊", "Fever and mild pain relief", 30, 100, false),
    M("Ibuprofen 400mg", "Fever and Pain", "💊", "Pain and inflammation", 45, 80, false),
    M("Burn Relief Cream", "First Aid", "🧴", "Soothes minor burns", 95, 25, false),
    M("Antiseptic Liquid", "First Aid", "🧴", "Cleans cuts and wounds", 85, 30, false),
    M("Bandage Pack", "First Aid", "🩹", "Pack of 20 bandages", 60, 50, false),
    M("Cetirizine 10mg", "Allergy", "🤧", "Allergy and sneezing relief", 25, 60, false),
    M("Cough Syrup", "Cold and Cough", "🍯", "Dry and wet cough relief", 90, 40, false),
    M("Nasal Spray", "Cold and Cough", "🌬️", "Blocked nose relief", 70, 35, false),
    M("ORS Sachet", "Stomach", "🥤", "Rehydration salts", 20, 50, false),
    M("Antacid Tablets", "Stomach", "💊", "Acidity and gas relief", 35, 70, false),
    M("Vitamin C", "Vitamins", "🍊", "Immunity booster", 120, 60, false),
    M("Multivitamin", "Vitamins", "🌟", "Daily nutrition", 250, 40, false),
    M("Insulin", "Diabetes", "💉", "Blood sugar control", 450, 20, true),
    M("Metformin 500mg", "Diabetes", "💊", "Type 2 diabetes", 60, 60, true),
    M("Epinephrine Auto-injector", "Emergency", "💉", "Severe allergic reaction", 900, 15, true),
    M("Amlodipine 5mg", "Heart and BP", "❤️", "Blood pressure control", 55, 50, true),
    M("Isosorbide Dinitrate 5mg", "Heart and BP", "❤️", "Chest pain relief", 40, 30, true),
    M("Salbutamol Inhaler", "Asthma", "🫁", "Asthma attack relief", 150, 25, true),
    M("Amoxicillin 500mg", "Antibiotics", "💊", "Bacterial infections", 110, 40, true),
  ].map((m, i) => ({ id: i + 1, ...m }));
  return {
    v: VERSION, seq: 2, orders: [], notes: [], medicines: list,
    users: [{ id: 1, name: "Pharmacy Seller", email: "seller@pharmacy.com", phone: "",
      role: "seller", addresses: [], hash:bcrypt.hashSync(process.env.SELLER_PASSWORD || "Seller@123", 8)  }],
  };
}
let db;
try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); if (db.v !== VERSION) db = fresh(); }
catch { db = fresh(); }
db.orders.forEach((o) => {
  if (o.status === "Awaiting prescription approval") o.status = "Awaiting pharmacy acceptance";
  if (o.accepted === undefined) o.accepted = o.status !== "Awaiting pharmacy acceptance";
});
const save = () => fs.writeFileSync(FILE, JSON.stringify(db));
save();

const BASE = { lat: 17.385, lng: 78.4867 };
const drones = [
  { id: "D1", status: "available", battery: 95, lat: 17.385, lng: 78.4867 },
  { id: "D2", status: "available", battery: 80, lat: 17.4, lng: 78.5 },
];
let raining = false;
const FLIGHT_SECONDS = 30; // demo flight time shown on the tracking map
const DRONE_KMH = 40;      // real-life speed used for the delivery time estimate

function km(a, b) {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Estimated delivery time in minutes: flight time plus 2 minutes for loading
function etaMinutes(from, to) {
  return Math.max(2, Math.round((km(from, to) / DRONE_KMH) * 60) + 2);
}
function clock(min) {
  return new Date(Date.now() + min * 60000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// Saves the message for the dashboard AND sends it by email and SMS
function notify(to, type, text) {
  db.notes.push({ id: db.seq++, ...to, type, text, time: new Date().toISOString() });
  db.notes = db.notes.slice(-300);
  save();
  if (to.userId) {
    const u = db.users.find((x) => x.id === to.userId);
    if (u) sendOut(u.email, u.phone, text);
  } else if (to.role === "seller") {
    sendOut(process.env.SELLER_ALERT_EMAIL, process.env.SELLER_ALERT_PHONE, "[Seller] " + text);
  }
}

// ---------- Dispatch ----------
const rank = { critical: 0, high: 1, normal: 2 };

function tryDispatch() {
  db.orders
    .filter((o) => o.status === "Waiting for drone")
    .sort((a, b) => rank[a.urgency] - rank[b.urgency] || a.id - b.id)
    .forEach((o) => {
      const d = drones.find((x) => x.status === "available" && x.battery > 30);
      if (!d) return;
      d.status = "in-flight";
      o.droneId = d.id;
      o.start = { lat: d.lat, lng: d.lng };
      o.etaMin = etaMinutes(d, o.address);
      o.status = "Drone assigned";
      mq.publish(`${PREFIX}/drone/${d.id}/command`,
        JSON.stringify({ orderId: o.id, lat: o.address.lat, lng: o.address.lng }));
      notify({ userId: o.customerId }, "flying",
        `Order #${o.id}: drone ${d.id} is assigned. Estimated delivery: about ${o.etaMin} min (around ${clock(o.etaMin)}).`);
      save();
    });
}

// The seller must accept first. Then payment, then a drone.
function advance(o) {
  if (!o.accepted) o.status = "Awaiting pharmacy acceptance";
  else if (o.payment.method === "online" && o.payment.status !== "paid") o.status = "Awaiting payment";
  else o.status = "Waiting for drone";
  save();
  tryDispatch();
  if (o.status === "Waiting for drone" && !o.queued) {
    o.queued = true;
    notify({ userId: o.customerId }, "delayed",
      `Order #${o.id}: all drones are busy or charging. Your order is queued and will leave soon.`);
  }
}

// ---------- MQTT ----------
const mq = mqtt.connect("mqtt://broker.hivemq.com:1883");
mq.on("connect", () => {
  console.log("Connected to MQTT broker");
  mq.subscribe(PREFIX + "/drone/+/telemetry");
  mq.publish(PREFIX + "/weather", JSON.stringify({ rain: raining }), { retain: true });
});

function markDelivered(o) {
  if (o.status === "Delivered") return;
  o.status = "Delivered";
  notify({ userId: o.customerId }, "delivered",
    `Order #${o.id}: your drone has reached your location. Please collect your medicine.` +
    (o.payment.method === "cod" ? " Please keep Rs " + o.total + " cash ready." : ""));
  notify({ role: "seller" }, "delivered", `Order #${o.id} was delivered.`);
}

mq.on("message", (topic, msg) => {
  try {
    const t = JSON.parse(msg.toString());
    const d = drones.find((x) => x.id === t.droneId);
    if (!d) return;
    Object.assign(d, { lat: t.lat, lng: t.lng, battery: t.battery });

    const o = db.orders.find((x) => x.id === t.orderId);
    if (o && o.status !== "Delivered" && o.status !== "Rejected") {
      const to = { userId: o.customerId };
      if (t.status === "delayed" && ["Drone assigned", "In Flight"].includes(o.status)) {
        o.status = "Delayed (rain)";
        notify(to, "delayed", `Order #${o.id}: delivery is delayed because of rain. Your drone is waiting safely. We will update the delivery time when it flies again.`);
        notify({ role: "seller" }, "delayed", `Order #${o.id} is delayed by rain.`);
      } else if (t.status === "flying" && ["Drone assigned", "Delayed (rain)"].includes(o.status)) {
        const resumed = o.status === "Delayed (rain)";
        o.status = "In Flight";
        o.etaMin = etaMinutes(d, o.address);
        notify(to, "flying", resumed
          ? `Order #${o.id}: weather cleared. Your drone is flying again. Estimated delivery: about ${o.etaMin} min (around ${clock(o.etaMin)}).`
          : `Order #${o.id}: your drone has taken off. Estimated delivery: about ${o.etaMin} min (around ${clock(o.etaMin)}).`);
      } else if (t.status === "delivered") {
        markDelivered(o);
      } else if (t.status === "returning" || t.status === "available") {
        // The drone is going home, so the parcel must already be delivered
        markDelivered(o);
      }
      save();
    }
    if (t.status === "available") { d.status = "available"; tryDispatch(); }
    else d.status = "in-flight";
  } catch (e) { console.log("Bad telemetry:", e.message); }
});

// ---------- Login ----------
const tokenFor = (u) => ({
  token: jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: "1d" }),
  role: u.role, name: u.name,
});
const auth = (role) => (req, res, next) => {
  try {
    const u = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), SECRET);
    if (!db.users.find((x) => x.id === u.id)) throw new Error("gone");
    if (role && u.role !== role) return res.status(403).json({ error: "Not allowed" });
    req.user = u;
    next();
  } catch { res.status(401).json({ error: "Please login again" }); }
};

app.post("/api/signup", async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || !phone)
    return res.status(400).json({ error: "Fill name, phone, email and password" });
  if (db.users.find((u) => u.email === email)) return res.status(400).json({ error: "Email already used" });
  const user = { id: db.seq++, name, email, phone, role: "customer", addresses: [],
    hash: await bcrypt.hash(password, 8) };
  db.users.push(user);
  save();
  sendOut(email, phone, "Welcome to MediDrone, " + name + "! You will get order updates here.");
  res.json(tokenFor(user));
});

app.post("/api/login", async (req, res) => {
  const u = db.users.find((x) => x.email === req.body.email);
  if (!u || !(await bcrypt.compare(req.body.password || "", u.hash)))
    return res.status(400).json({ error: "Wrong email or password" });
  res.json(tokenFor(u));
});

// ---------- Profile and addresses ----------
const me = (req) => db.users.find((x) => x.id === req.user.id);
app.get("/api/me", auth(), (req, res) => {
  const u = me(req);
  res.json({ name: u.name, phone: u.phone, email: u.email, addresses: u.addresses || [] });
});
app.post("/api/addresses", auth("customer"), (req, res) => {
  const { label, text, lat, lng } = req.body;
  if (!label || !text) return res.status(400).json({ error: "Enter a name and the address" });
  if (typeof lat !== "number" || typeof lng !== "number")
    return res.status(400).json({ error: "Click on the map to set the location" });
  me(req).addresses.push({ id: db.seq++, label, text, lat, lng });
  save();
  res.json({ ok: true });
});
app.delete("/api/addresses/:id", auth("customer"), (req, res) => {
  const u = me(req);
  u.addresses = u.addresses.filter((a) => a.id !== Number(req.params.id));
  save();
  res.json({ ok: true });
});

// ---------- Medicines: list, add, edit, remove, restock ----------
app.get("/api/medicines", auth(), (req, res) => {
  const live = db.medicines.filter((m) => !m.deleted);
  if (req.user.role === "seller") return res.json(live);
  // customers never see stock numbers
  res.json(live.map(({ stock, low, ...m }) => ({ ...m, available: stock > 0 })));
});

app.post("/api/medicines", auth("seller"), (req, res) => {
  const { name, category, price, stock, rx, desc, icon } = req.body;
  if (!name || !(price > 0) || !(stock >= 0)) return res.status(400).json({ error: "Enter name, price and stock" });
  const m = { id: db.seq++, name, category: category || "Other", icon: icon || "💊",
    desc: desc || "Added by pharmacy", price, stock: Math.floor(stock),
    low: Math.max(1, Math.ceil(stock / 5)), rx: !!rx };
  db.medicines.push(m);
  save();
  res.json(m);
});

// Works for any medicine, including out-of-stock ones. Old orders keep its name.
app.delete("/api/medicines/:id", auth("seller"), (req, res) => {
  const m = db.medicines.find((x) => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: "Medicine not found" });
  m.deleted = true;
  save();
  res.json({ ok: true });
});

app.put("/api/medicines/:id", auth("seller"), (req, res) => {
  const m = db.medicines.find((x) => x.id === Number(req.params.id) && !x.deleted);
  if (!m) return res.status(404).json({ error: "Medicine not found" });
  const { price, stock } = req.body;
  if (!(price > 0) || !(stock >= 0)) return res.status(400).json({ error: "Enter a valid price and stock" });
  m.price = price;
  m.stock = Math.floor(stock);
  m.low = Math.max(1, Math.ceil(m.stock / 5));
  save();
  res.json(m);
});

app.post("/api/medicines/:id/restock", auth("seller"), (req, res) => {
  const m = db.medicines.find((x) => x.id === Number(req.params.id) && !x.deleted);
  if (!m) return res.status(404).json({ error: "Not found" });
  m.stock += 20;
  save();
  res.json(m);
});

// ---------- Drones, weather, messages ----------
app.get("/api/drones", auth("seller"), (req, res) => res.json(drones));
app.get("/api/weather", auth(), (req, res) => res.json({ rain: raining }));
app.post("/api/weather", auth("seller"), (req, res) => {
  const want = !!req.body.rain;
  if (want === raining) return res.json({ rain: raining }); // nothing changed: no duplicate alerts
  raining = want;
  mq.publish(PREFIX + "/weather", JSON.stringify({ rain: raining }), { retain: true });
  notify({ role: "seller" }, "alert", raining ? "Rain mode ON: flights will pause." : "Rain cleared: flights resume.");
  if (raining) {
    db.orders
      .filter((o) => ["Waiting for drone", "Awaiting payment", "Awaiting pharmacy acceptance"].includes(o.status) && !o.rainWarned)
      .forEach((o) => {
        o.rainWarned = true;
        notify({ userId: o.customerId }, "delayed",
          `Rain alert: order #${o.id} may be delayed because of bad weather.`);
      });
  } else {
    db.orders.forEach((o) => { o.rainWarned = false; });
    save();
  }
  res.json({ rain: raining });
});

app.get("/api/notifications", auth(), (req, res) =>
  res.json(db.notes.filter((n) => n.userId === req.user.id || n.role === req.user.role).slice(-30)));

// ---------- Orders ----------
app.post("/api/orders", auth("customer"), (req, res) => {
  const { items, urgency, payment, doctor, rxPhoto, address } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "Your cart is empty" });
  if (!address || typeof address.lat !== "number" || typeof address.lng !== "number")
    return res.status(400).json({ error: "Choose a delivery address" });

  const lines = [];
  let total = 0, needRx = false;
  for (const it of items) {
    const m = db.medicines.find((x) => x.id === it.medicineId);
    const q = Math.floor(it.qty);
    if (!m || m.deleted || !(q > 0) || q > 10) return res.status(400).json({ error: "Invalid item in cart" });
    if (m.stock < q) return res.status(400).json({ error: m.name + " is out of stock" });
    if (m.rx) needRx = true;
    total += m.price * q;
    lines.push({ medicineId: m.id, name: m.name, qty: q, price: m.price });
  }

  // Prescription photo is compulsory for prescription medicines
  let photoBuf = null, photoExt = "jpg";
  if (needRx) {
    const match = /^data:image\/(jpeg|png);base64,(.+)$/.exec(rxPhoto || "");
    if (!match) return res.status(400).json({ error: "Upload a photo of your prescription" });
    photoBuf = Buffer.from(match[2], "base64");
    photoExt = match[1] === "png" ? "png" : "jpg";
    if (photoBuf.length > 3 * 1024 * 1024) return res.status(400).json({ error: "Photo is too big" });
  }

  const id = db.orders.length + 1;
  let photoFile = null;
  if (photoBuf) {
    photoFile = "order-" + id + "." + photoExt;
    fs.writeFileSync(path.join(UPLOADS, photoFile), photoBuf);
  }

  lines.forEach((l) => {
    const m = db.medicines.find((x) => x.id === l.medicineId);
    m.stock -= l.qty;
    if (m.stock === 0) notify({ role: "seller" }, "alert", `${m.name} is OUT OF STOCK.`);
    else if (m.stock <= m.low) notify({ role: "seller" }, "alert", `${m.name} is low (${m.stock} left). Reorder.`);
  });

  const u = me(req);
  const o = {
    id,
    customerId: u.id, customerName: u.name, phone: u.phone,
    address: { label: address.label, text: address.text, lat: address.lat, lng: address.lng },
    items: lines, total,
    urgency: rank[urgency] !== undefined ? urgency : "normal",
    payment: { method: payment === "online" ? "online" : "cod", status: "pending" },
    rx: needRx ? { doctor: doctor || "", photo: photoFile, status: "pending" } : null,
    accepted: false,
    etaMin: etaMinutes(BASE, address),
    droneId: null, status: "", createdAt: new Date().toISOString(),
  };
  db.orders.push(o);
  const summary = lines.map((l) => `${l.name} x${l.qty}`).join(", ");
  notify({ userId: u.id }, "placed",
    `Order #${o.id} placed: ${summary}. Total Rs ${total}. Estimated delivery: about ${o.etaMin} min after the pharmacy accepts.`);
  notify({ role: "seller" }, o.urgency === "critical" ? "alert" : "placed",
    `New ${o.urgency.toUpperCase()} order #${o.id} from ${u.name}: ${summary}.`);
  advance(o);
  res.status(201).json(o);
});

app.get("/api/orders", auth(), (req, res) =>
  res.json(req.user.role === "seller" ? db.orders : db.orders.filter((o) => o.customerId === req.user.id)));

// Prescription photo (the token is passed in the address because <img> cannot send headers)
app.get("/api/orders/:id/photo", (req, res) => {
  try {
    const u = jwt.verify(String(req.query.token || ""), SECRET);
    const o = db.orders.find((x) => x.id === Number(req.params.id));
    if (!o || !o.rx || !o.rx.photo) return res.status(404).send("No photo");
    if (u.role !== "seller" && o.customerId !== u.id) return res.status(403).send("Not allowed");
    res.sendFile(path.join(UPLOADS, path.basename(o.rx.photo)));
  } catch { res.status(401).send("Please login again"); }
});

app.get("/api/orders/:id/track", auth(), (req, res) => {
  const o = db.orders.find((x) => x.id === Number(req.params.id) &&
    (req.user.role === "seller" || x.customerId === req.user.id));
  if (!o) return res.status(404).json({ error: "Order not found" });
  const d = o.droneId && drones.find((x) => x.id === o.droneId);
  let dist = null, eta = null;
  if (d) {
    dist = km(d, o.address);
    const whole = o.start ? km(o.start, o.address) : dist;
    eta = whole > 0 ? Math.round(FLIGHT_SECONDS * Math.min(1, dist / whole)) : 0;
  }
  res.json({ order: o,
    drone: d ? { id: d.id, lat: d.lat, lng: d.lng, battery: d.battery } : null,
    distKm: dist == null ? null : +dist.toFixed(2), etaSec: eta });
});

app.post("/api/orders/:id/pay", auth("customer"), (req, res) => {
  const o = db.orders.find((x) => x.id === Number(req.params.id) && x.customerId === req.user.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  o.payment.status = "paid";
  notify({ userId: o.customerId }, "placed", `Payment received for order #${o.id}.`);
  if (o.status === "Awaiting payment") advance(o); else save();
  res.json(o);
});

// Seller accepts an order (this also approves the prescription)
app.post("/api/orders/:id/accept", auth("seller"), (req, res) => {
  const o = db.orders.find((x) => x.id === Number(req.params.id));
  if (!o || o.status !== "Awaiting pharmacy acceptance")
    return res.status(400).json({ error: "This order is not waiting for acceptance" });
  o.accepted = true;
  if (o.rx) o.rx.status = "approved";
  notify({ userId: o.customerId }, "placed",
    `Order #${o.id}: the pharmacy accepted your order` + (o.rx ? " and approved your prescription." : ".") +
    ` Estimated delivery: about ${o.etaMin} min (around ${clock(o.etaMin)}).`);
  advance(o);
  res.json(o);
});

app.post("/api/orders/:id/reject", auth("seller"), (req, res) => {
  const o = db.orders.find((x) => x.id === Number(req.params.id));
  if (!o || o.status !== "Awaiting pharmacy acceptance")
    return res.status(400).json({ error: "This order is not waiting for acceptance" });
  o.status = "Rejected";
  if (o.rx) o.rx.status = "rejected";
  o.items.forEach((l) => {
    const m = db.medicines.find((x) => x.id === l.medicineId);
    if (m) m.stock += l.qty;
  });
  const why = req.body.reason ? " Reason: " + req.body.reason : "";
  notify({ userId: o.customerId }, "delayed", `Order #${o.id}: the pharmacy could not accept your order.${why}`);
  save();
  res.json(o);
});

app.post("/api/orders/:id/cash", auth("seller"), (req, res) => {
  const o = db.orders.find((x) => x.id === Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Order not found" });
  o.payment.status = "paid";
  save();
  res.json(o);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, (error) => {
  if (error) return console.log("Could not start server:", error.message);
  console.log("Server running on http://localhost:" + PORT);
  console.log("Email: " + (mailer ? "ON" : "demo mode") + " | SMS: " +
    (fastOn ? "Fast2SMS ON" : twilioOn ? "Twilio ON" : "demo mode (printed here)"));
});