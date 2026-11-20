'use strict';

// Sample salon data for sales demos: a believable salon with staff, a full
// service menu, regular customers and a few months of visits, so the
// dashboard, customer profiles and reports all have something to show.
//
// Everything goes through the app's own API (the same checks, tax maths,
// receipt numbers and audit log as real use). On later starts the data is
// topped up to today, so "Today" on the dashboard is never empty, however long
// ago the demo was first set up.

const { businessDate, addDays, localHour } = require('./time');

const HISTORY_DAYS = 120;

const SALON = {
  business_name: 'Bella Salon & Spa',
  business_address: '123 Main Street, Unit 4\nToronto, ON  M5V 2T6',
  business_phone: '(416) 555-0100',
  business_email: 'hello@example.com',
  business_website: 'www.example.com',
  business_social: '@bellasalon',
  receipt_footer: 'Thank you for choosing Bella Salon & Spa!\nBook your next visit: (416) 555-0100',
};

const STAFF = [
  { displayName: 'Sophia Martin', username: 'sophia' },
  { displayName: 'Priya Shah', username: 'priya' },
  { displayName: 'Maria Lopez', username: 'maria' },
];
const STAFF_PASSWORD = 'staff-demo-1';

// Added to the standard sample catalogue (Hair, Facial, Waxing, Nails).
const EXTRA_SERVICES = [
  ['Threading', [['Eyebrow Threading', 1200, 15], ['Upper Lip Threading', 800, 10], ['Full Face Threading', 3500, 30]]],
  ['Makeup', [['Party Makeup', 8000, 60], ['Bridal Makeup', 35000, 180], ['Saree Draping', 3000, 30]]],
  ["Men's Grooming", [["Men's Haircut", 3000, 30], ['Beard Trim', 1500, 15], ['Kids Haircut', 2000, 20]]],
];

const FIRST = ['Emma', 'Olivia', 'Ava', 'Sophie', 'Chloe', 'Mia', 'Isabella', 'Grace', 'Hannah', 'Zoe', 'Aisha', 'Fatima', 'Neha', 'Anjali',
  'Simran', 'Harpreet', 'Mei', 'Lin', 'Yuki', 'Sara', 'Leila', 'Nadia', 'Elena', 'Lucia', 'Camila', 'Gabriela', 'Chantal', 'Amélie',
  'Rachel', 'Jasmine', 'Tanya', 'Kayla', 'Megan', 'Lauren', 'Daniel', 'Arjun', 'Ryan', 'Omar', 'Marco'];
const LAST = ['Smith', 'Brown', 'Tremblay', 'Wilson', 'Patel', 'Singh', 'Chen', 'Wong', 'Kim', 'Nguyen', 'Khan', 'Ali', 'Sharma', 'Gill',
  'Rossi', 'Garcia', 'Martinez', 'Roy', 'Gagnon', 'Taylor', 'Campbell', 'Anderson', 'Lee', 'Thompson', 'Clarke', 'Murphy', 'Dhillon', 'Mehta'];
const REFERRALS = ['Walk-in', 'Instagram', 'Google', 'Friend or family', 'Facebook', 'Flyer'];
const NOTES = [
  'Prefers a quiet appointment. Sensitive skin: use the gentle wax.',
  'Allergic to some hair dyes: always do a patch test first.',
  'Likes Sophia for colour. Usually books every 6 weeks.',
  'Wedding on the 14th of next month: bridal trial booked.',
  'Prefers e-transfer. Remind about loyalty card.',
];

// Small deterministic random generator so every demo looks the same.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class LocalClient {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }
  async req(method, url, body) {
    const res = await fetch(this.base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Salon-Request': '1',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url} failed (${res.status}): ${data.error || 'unknown error'}`);
    return data;
  }
  get(u) {
    return this.req('GET', u);
  }
  post(u, b) {
    return this.req('POST', u, b ?? {});
  }
  put(u, b) {
    return this.req('PUT', u, b);
  }
}

// An instant on a salon-local calendar day at roughly hour:minute local time.
function instantOn(ymd, hour, minute, timeZone) {
  for (let offset = -14; offset <= 14; offset++) {
    const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), hour + offset, minute));
    if (businessDate(d, timeZone) === ymd && localHour(d, timeZone) === hour) return d;
  }
  return new Date(ymd + 'T17:00:00Z');
}

function pick(r, list) {
  return list[Math.floor(r() * list.length)];
}

// Visits per day: quieter early in the week, busy Friday and Saturday.
const DAY_VOLUME = [5, 0, 6, 7, 8, 11, 12]; // Sun..Sat (closed Monday)

function phoneFor(i) {
  const area = ['416', '647', '905', '437'][i % 4];
  return `(${area}) 555-${String(1000 + i * 37).slice(-4)}`;
}

async function seedFull(c, ctx, r) {
  await c.put('/settings', SALON);

  const staffIds = [];
  for (const s of STAFF) {
    const { id } = await c.post('/users', { ...s, role: 'staff', password: STAFF_PASSWORD });
    staffIds.push(id);
  }

  for (const [cat, items] of EXTRA_SERVICES) {
    const { id } = await c.post('/service-categories', { name: cat });
    for (const [name, price, mins] of items) await c.post('/services', { categoryId: id, name, priceCents: price, durationMinutes: mins });
  }

  // Customers, each with the day they first came in. Earlier customers are
  // the salon's regulars and come back more often.
  const today = businessDate(new Date(), ctx.settings.timezone());
  const start = addDays(today, -HISTORY_DAYS);
  const used = new Set();
  const people = [];
  for (let i = 0; i < 64; i++) {
    let name;
    do name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    while (used.has(name));
    used.add(name);
    const joinOffset = i < 30 ? Math.floor(r() * 20) : Math.floor(r() * HISTORY_DAYS);
    people.push({ name, idx: i, join: addDays(start, joinOffset), weight: i < 30 ? 2 + r() * 2.5 : 0.8 + r() * 1.5, id: null });
  }
  return { staffIds, people, from: start };
}

// Services a visit usually combines.
function chooseItems(r, svc) {
  const roll = r();
  const groups = [
    ['Haircut', 'Blow Dry'], ['Haircut'], ['Hair Colour', 'Blow Dry'], ['Highlights'], ['Hair Styling'],
    ['Eyebrow Threading'], ['Eyebrow Threading', 'Upper Lip Threading'], ['Eyebrows', 'Upper Lip'], ['Full Face Threading'],
    ['Manicure', 'Pedicure'], ['Gel Nails'], ['Pedicure'], ['Basic Facial'], ['Hydrating Facial', 'Eyebrow Threading'],
    ['Deep Cleansing Facial'], ['Legs', 'Arms'], ["Men's Haircut", 'Beard Trim'], ["Men's Haircut"], ['Kids Haircut'], ['Party Makeup'],
  ];
  let names = pick(r, groups);
  if (roll > 0.985) names = ['Bridal Makeup', 'Saree Draping'];
  return names.filter((n) => svc[n]).map((n) => ({ serviceId: svc[n] }));
}

async function addVisits(c, ctx, r, { people, staffIds, from, to, now }) {
  const tz = ctx.settings.timezone();
  const cats = await c.get('/services');
  const svc = {};
  for (const cat of cats) for (const s of cat.services) svc[s.name] = s.id;
  const staff = staffIds.length ? staffIds : (await c.get('/staff')).map((s) => s.id);
  let count = 0;

  for (let day = from; day <= to; day = addDays(day, 1)) {
    const dow = new Date(day + 'T12:00:00Z').getUTCDay();
    let n = DAY_VOLUME[dow];
    if (!n) continue;
    n = Math.max(1, Math.round(n * (0.75 + r() * 0.5)));
    const pool = people.filter((p) => p.join <= day);
    if (!pool.length) continue;
    const total = pool.reduce((a, p) => a + p.weight, 0);
    const times = Array.from({ length: n }, () => 10 * 60 + Math.floor(r() * 9 * 60)).sort((a, b) => a - b);
    for (const mins of times) {
      const at = instantOn(day, Math.floor(mins / 60), mins % 60, tz);
      if (at.getTime() > now.getTime() - 10 * 60 * 1000) break;
      // Weighted pick of who walks in.
      let x = r() * total;
      let person = pool[0];
      for (const p of pool) if ((x -= p.weight) <= 0) { person = p; break; }
      if (!person.id) {
        const created = await c.post('/customers', {
          fullName: person.name,
          phone: phoneFor(person.idx),
          email: r() < 0.7 ? person.name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(' ', '.') + '@example.com' : '',
          referralSource: pick(r, REFERRALS),
          firstVisitDate: day,
          notes: person.idx < NOTES.length ? NOTES[person.idx] : '',
        });
        person.id = created.id;
      }
      const items = chooseItems(r, svc);
      if (!items.length) continue;
      const staffUserId = pick(r, staff);
      const discount = r() < 0.08 ? { type: 'percent', percent: pick(r, [10, 15, 20]) } : null;
      const quote = await c.post('/visits/quote', { items, discount });
      const owing = r() < 0.03 && day >= addDays(to, -20);
      const method = pick(r, ['credit', 'credit', 'debit', 'debit', 'debit', 'cash', 'cash', 'etransfer']);
      const paid = owing ? Math.round(quote.totalCents / 2) : quote.totalCents;
      await c.post('/visits', {
        customerId: person.id,
        items: items.map((it) => ({ ...it, staffUserId })),
        staffUserId,
        discount,
        payments: [{ method, amountCents: paid }],
        allowBalance: owing,
        offlineAt: at.toISOString(),
      });
      count++;
    }
  }
  return count;
}

// Upcoming bookings for the Appointments screen: the rest of today and the
// next two weeks, about half of them already confirmed by the customer.
async function addAppointments(c, ctx, r, { customerIds, staffIds, from, days, now }) {
  const tz = ctx.settings.timezone();
  const cats = await c.get('/services');
  const svc = {};
  for (const cat of cats) for (const s of cat.services) svc[s.name] = s.id;
  let count = 0;
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    const dow = new Date(day + 'T12:00:00Z').getUTCDay();
    if (!DAY_VOLUME[dow]) continue;
    const n = Math.max(2, Math.round(DAY_VOLUME[dow] * (0.4 + r() * 0.3)));
    const slots = new Set();
    while (slots.size < n) slots.add(10 * 2 + Math.floor(r() * 16)); // half-hours from 10:00 to 17:30
    for (const slot of [...slots].sort((a, b) => a - b)) {
      const hour = Math.floor(slot / 2);
      const minute = slot % 2 ? 30 : 0;
      if (instantOn(day, hour, minute, tz).getTime() < now.getTime() + 30 * 60000) continue;
      const items = chooseItems(r, svc);
      const appt = await c.post('/appointments', {
        customerId: pick(r, customerIds),
        date: day,
        time: `${String(hour).padStart(2, '0')}:${minute ? '30' : '00'}`,
        serviceIds: items.map((it) => it.serviceId),
        staffUserId: staffIds.length ? pick(r, staffIds) : undefined,
        confirmOverlap: true,
      });
      const id = appt.id ?? appt.appointment?.id;
      if (id && r() < 0.5) await c.post(`/appointments/${id}/status`, { status: 'confirmed' }).catch(() => {});
      count++;
    }
  }
  return count;
}

// Fills an empty database with the demo salon, or tops existing demo data up
// to today. Safe to call on every start.
async function ensureDemoData(app, { log = console.log } = {}) {
  const ctx = app.locals.ctx;
  const db = ctx.db();
  const tz = ctx.settings.timezone();
  const now = new Date();
  const today = businessDate(now, tz);
  const customers = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
  const last = db.prepare("SELECT MAX(business_date) d FROM visits WHERE status = 'completed'").get().d;
  const lastAppt = db.prepare('SELECT MAX(start_at) m FROM appointments').get().m;
  const lastApptDay = lastAppt ? businessDate(new Date(lastAppt), tz) : null;
  const needAppts = !lastApptDay || lastApptDay < addDays(today, 7);
  if (customers > 0 && last && last >= today && !needAppts) return;

  const prevMax = ctx.maxOfflineAgeMs;
  ctx.maxOfflineAgeMs = (HISTORY_DAYS + 2) * 86400000;
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const c = new LocalClient(`http://127.0.0.1:${server.address().port}/api`);
    await c.post('/auth/login', { username: 'manager', password: 'manager' });
    if (customers === 0) {
      log('  Preparing the demo salon (sample customers, visits and sales)…');
      const r = rng(20261120);
      const plan = await seedFull(c, ctx, r);
      const n = await addVisits(c, ctx, r, { ...plan, to: today, now });
      const customerIds = plan.people.filter((p) => p.id).map((p) => p.id);
      const a = await addAppointments(c, ctx, r, { customerIds, staffIds: plan.staffIds, from: today, days: 14, now });
      log(`  Demo salon ready: ${customerIds.length} customers, ${n} visits, ${a} upcoming appointments.`);
    } else {
      // Top up from the day after the last visit, using existing customers.
      const from = !last || last < addDays(today, -HISTORY_DAYS) ? addDays(today, -HISTORY_DAYS) : addDays(last, 1);
      const rows = db.prepare("SELECT id, full_name FROM customers WHERE status = 'active' ORDER BY id").all();
      const r = rng(Number(today.replace(/-/g, '')));
      const people = rows.map((row, i) => ({ id: row.id, name: row.full_name, idx: i, join: '0000-00-00', weight: i < 30 ? 4 : 1 }));
      const staffIds = db.prepare("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 AND r.code = 'staff'").all().map((s) => s.id);
      const n = await addVisits(c, ctx, r, { people, staffIds, from, to: today, now });
      // Keep about two weeks of bookings ahead.
      const apptFrom = !lastApptDay || lastApptDay < today ? today : addDays(lastApptDay, 1);
      const days = Math.round((Date.parse(addDays(today, 14)) - Date.parse(apptFrom)) / 86400000);
      const a = days > 0 ? await addAppointments(c, ctx, r, { customerIds: rows.map((x) => x.id), staffIds, from: apptFrom, days, now }) : 0;
      if (n || a) log(`  Demo data brought up to date: ${n} new visits since ${last}, ${a} new appointments.`);
    }
  } finally {
    ctx.maxOfflineAgeMs = prevMax;
    await new Promise((res) => server.close(res));
  }
}

module.exports = { ensureDemoData, SALON, STAFF, STAFF_PASSWORD };
