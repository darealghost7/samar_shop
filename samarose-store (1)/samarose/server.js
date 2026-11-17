import { PROD, PORT, SITE_URL } from './lib/env.js';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, tx, UPLOAD_DIR, getSettings, saveSettings, seedSamples, PAGE_SLUGS } from './lib/db.js';
import { hashPassword, verifyPassword, createSession, destroySession, sessionFrom, requireAuth, purgeSessions, COOKIE } from './lib/auth.js';
import { sendMail } from './lib/mail.js';
import { page, esc, money, sections, contactBlock, waLink, HANGER } from './lib/render.js';

const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.get('/healthz', (req, res) => res.send('ok'));
if (PROD) app.use((req, res, next) => (req.secure ? next() : res.redirect(308, `https://${req.headers.host}${req.originalUrl}`)));
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'],
    fontSrc: ['https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"],
    upgradeInsecureRequests: PROD ? [] : null,
  } },
}));

/* ---------- helpers ---------- */
const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanLong = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{9,18}$/;
const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'];
const STATUSES = ['Pending', 'Paid', 'Processing', 'Ready for Collection', 'Out for Delivery', 'Completed', 'Cancelled'];
const cents = (rand) => Math.round(parseFloat(rand) * 100) || 0;
const eftReady = (s) => Boolean(s.bank_name && s.bank_account_holder && s.bank_account_number);
const publicProduct = (p) => ({ id: p.id, name: p.name, description: p.description, category: p.category, price_cents: p.price_cents, stock: p.stock, image: p.image, featured: !!p.featured, sizes: p.sizes ? p.sizes.split(',').map((x) => x.trim()).filter(Boolean) : [] });
const send = (res, html) => res.type('html').send(html);
const limiter = (windowMs, limit, message) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: message } });

/* ---------- pages ---------- */
const DOCS = { about: 'About us', privacy: 'Privacy Policy', terms: 'Terms and Conditions', returns: 'Returns and Refund Policy', delivery: 'Delivery Policy' };
app.get('/theme.css', (req, res) => {
  const a = getSettings().accent;
  res.type('css').set('Cache-Control', 'no-cache').send(`:root{--accent:${/^#[0-9a-f]{6}$/i.test(a) ? a : '#0B7A5C'}}`);
});
app.get('/', (req, res) => {
  const s = getSettings();
  const hero = s.hero_image
    ? `<img src="${esc(s.hero_image)}" alt="The ${esc(s.shop_name)} shop" fetchpriority="high">`
    : `<div class="ph ph-hero">${HANGER}<span class="slot">[Add shop photo in Admin &gt; Settings]</span></div>`;
  send(res, page({ view: 'home', path: '/', title: 'Home', raw: { hero, contact: contactBlock(s), wa: s.whatsapp ? `<a class="btn" href="${esc(waLink(s))}" rel="noopener">Message us on WhatsApp</a>` : '' } }));
});
app.get('/shop', (req, res) => send(res, page({ view: 'shop', path: '/shop', title: 'Shop', desc: 'Browse the full collection and order online.', scripts: [] })));
app.get('/contact', (req, res) => { const s = getSettings(); send(res, page({ view: 'contact', path: '/contact', title: 'Contact', raw: { contact: contactBlock(s) }, scripts: ['contact'] })); });
app.get('/checkout', (req, res) => {
  const s = getSettings();
  send(res, page({ view: 'checkout', path: '/checkout', title: 'Checkout', noindex: true, scripts: ['checkout'], raw: { collection_addr: s.collection_address ? esc(s.collection_address).replace(/\n/g, '<br>') : '<span class="slot">[Add collection address in Admin &gt; Settings]</span>' } }));
});
app.get('/order/:ref', (req, res) => send(res, page({ view: 'order', path: '/order', title: 'Your order', noindex: true, scripts: ['order'] })));
for (const slug of Object.keys(DOCS)) {
  app.get('/' + slug, (req, res) => {
    const row = db.prepare('SELECT title, body FROM pages WHERE slug=?').get(slug);
    const secs = sections(row.body);
    if (slug === 'about') return send(res, page({ view: 'about', path: '/about', title: row.title, raw: { rows: secs.map((x) => `<div class="about-row"><h2>${esc(x.h)}</h2><div class="prose">${x.html}</div></div>`).join('') } }));
    send(res, page({ view: 'doc', path: '/' + slug, title: row.title, vars: { doc_title: row.title }, raw: { content: secs.map((x) => (x.h ? `<h2>${esc(x.h)}</h2>` : '') + x.html).join('') } }));
  });
}
app.get('/admin', (req, res) => res.sendFile(path.join(PUB, 'admin/index.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(PUB, 'admin/login.html')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
app.use(express.static(PUB, { index: false, maxAge: '10m' }));

/* ---------- public API ---------- */
const pub = express.Router();
pub.use(express.json({ limit: '50kb' }));
pub.get('/config', (req, res) => {
  const s = getSettings();
  res.json({ shop_name: s.shop_name, delivery_fee_cents: cents(s.delivery_fee), free_over_cents: cents(s.free_delivery_over), whatsapp: s.whatsapp, eft: eftReady(s) });
});
pub.get('/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products WHERE active=1 ORDER BY featured DESC, id DESC').all().map(publicProduct));
});

pub.post('/contact', limiter(60 * 60 * 1000, 8, 'Too many messages. Please try again later.'), async (req, res) => {
  const b = req.body || {};
  if (clean(b.website)) return res.json({ ok: true }); // honeypot: bots fill this in
  const name = clean(b.name, 100), email = clean(b.email, 120).toLowerCase(), phone = clean(b.phone, 25), message = cleanLong(b.message, 2000);
  const errors = {};
  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!EMAIL.test(email)) errors.email = 'Please enter a valid email address.';
  if (phone && !PHONE.test(phone)) errors.phone = 'Please enter a valid phone number.';
  if (message.length < 5) errors.message = 'Please write a message.';
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  db.prepare('INSERT INTO messages(name,email,phone,message) VALUES(?,?,?,?)').run(name, email, phone, message);
  sendMail({ to: process.env.OWNER_EMAIL, replyTo: email, subject: `New message from ${name}`, text: `${name}\n${email}\n${phone}\n\n${message}` });
  res.json({ ok: true });
});

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => {
  const d = new Date();
  const ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  return `SR-${ymd}-${Array.from(crypto.randomBytes(5), (x) => REF_CHARS[x % REF_CHARS.length]).join('')}`;
};

pub.post('/checkout', limiter(15 * 60 * 1000, 20, 'Too many attempts. Please try again shortly.'), (req, res) => {
  if (!eftReady(getSettings())) return res.status(503).json({ errors: { form: 'Ordering is not open yet: the shop has not added its bank details. Please contact the shop.' } });
  const b = req.body || {}, errors = {};
  const name = clean(b.name, 100), email = clean(b.email, 120).toLowerCase(), phone = clean(b.phone, 25);
  if (name.length < 2) errors.name = 'Please enter your full name.';
  if (!EMAIL.test(email)) errors.email = 'Please enter a valid email address.';
  if (!PHONE.test(phone)) errors.phone = 'Please enter a valid contact number.';
  const method = b.method;
  if (!['collection', 'delivery'].includes(method)) errors.method = 'Choose collection or delivery.';
  const a = { street: '', suburb: '', city: '', province: '', postal_code: '', instructions: '', lat: null, lng: null };
  if (method === 'delivery') {
    const src = b.address || {};
    a.street = clean(src.street, 150); a.suburb = clean(src.suburb, 80); a.city = clean(src.city, 80);
    a.province = clean(src.province, 40); a.postal_code = clean(src.postal_code, 4); a.instructions = cleanLong(src.instructions, 300);
    if (a.street.length < 3) errors.street = 'Enter your street address.';
    if (a.suburb.length < 2) errors.suburb = 'Enter your suburb.';
    if (a.city.length < 2) errors.city = 'Enter your city or town.';
    if (!PROVINCES.includes(a.province)) errors.province = 'Choose your province.';
    if (!/^\d{4}$/.test(a.postal_code)) errors.postal_code = 'Enter a 4-digit postal code.';
    const lat = Number(src.lat), lng = Number(src.lng);
    if (src.lat != null && src.lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { a.lat = Math.round(lat * 1e5) / 1e5; a.lng = Math.round(lng * 1e5) / 1e5; }
  }
  if (b.consent !== true) errors.consent = 'Please tick the box to continue.';

  // Re-price everything on the server. Prices and stock sent by the browser are never trusted.
  const wanted = new Map();
  for (const it of Array.isArray(b.items) ? b.items.slice(0, 50) : []) {
    const id = Number(it.id), qty = Number(it.qty), size = clean(it.size, 20);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) continue;
    const k = `${id}|${size}`;
    wanted.set(k, { id, size, qty: Math.min((wanted.get(k)?.qty || 0) + qty, 20) });
  }
  if (!wanted.size) errors.items = 'Your cart is empty.';
  const lines = [], used = new Map();
  for (const it of wanted.values()) {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(it.id);
    const sizes = p?.sizes ? p.sizes.split(',').map((x) => x.trim()) : [];
    if (!p || p.price_cents <= 0 || (sizes.length ? !sizes.includes(it.size) : it.size)) { errors.items = 'An item in your cart is no longer available. Please review your cart.'; break; }
    used.set(p.id, (used.get(p.id) || 0) + it.qty);
    if (used.get(p.id) > p.stock) { errors.items = `Only ${p.stock} of "${p.name}" in stock. Please update your cart.`; break; }
    lines.push({ p, ...it });
  }
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const s = getSettings();
  const subtotal = lines.reduce((t, l) => t + l.p.price_cents * l.qty, 0);
  const free = cents(s.free_delivery_over);
  const fee = method === 'delivery' ? (free > 0 && subtotal >= free ? 0 : cents(s.delivery_fee)) : 0;
  const total = subtotal + fee;
  if (total <= 0) return res.status(400).json({ errors: { form: 'Your order total is not valid.' } });

  let order;
  for (let tries = 0; tries < 5 && !order; tries++) {
    try {
      order = tx(() => {
        const ref = newRef(), token = crypto.randomBytes(24).toString('base64url');
        const r = db.prepare(`INSERT INTO orders(ref,token,customer_name,email,phone,method,street,suburb,city,province,postal_code,instructions,lat,lng,subtotal_cents,delivery_fee_cents,total_cents,payment_status,consent_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'unpaid',?)`)
          .run(ref, token, name, email, phone, method, a.street, a.suburb, a.city, a.province, a.postal_code, a.instructions, a.lat, a.lng, subtotal, fee, total, new Date().toISOString());
        const ins = db.prepare('INSERT INTO order_items(order_id,product_id,name,size,unit_price_cents,qty) VALUES(?,?,?,?,?,?)');
        for (const l of lines) ins.run(r.lastInsertRowid, l.p.id, l.p.name, l.size, l.p.price_cents, l.qty);
        return db.prepare('SELECT * FROM orders WHERE id=?').get(r.lastInsertRowid);
      });
    } catch (e) { if (!/UNIQUE/.test(e.message)) throw e; }
  }
  if (!order) return res.status(500).json({ errors: { form: 'Could not create your order. Please try again.' } });
  sendPlacedEmails(order, lines.map((l) => ({ name: l.p.name, size: l.size, unit_price_cents: l.p.price_cents, qty: l.qty })));
  res.json({ ref: order.ref, token: order.token });
});

const orderFor = (req) => {
  const o = db.prepare('SELECT * FROM orders WHERE ref=?').get(String(req.params.ref));
  const t = Buffer.from(String(req.query.t || req.body?.token || '')), k = Buffer.from(o?.token || '-');
  return o && t.length === k.length && crypto.timingSafeEqual(t, k) ? o : null;
};
pub.get('/orders/:ref', (req, res) => {
  const o = orderFor(req);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const items = db.prepare('SELECT name,size,unit_price_cents,qty FROM order_items WHERE order_id=?').all(o.id);
  const { token, id, consent_at, ...safe } = o;
  const s = getSettings();
  res.json({ ...safe, items, bank: { name: s.bank_name, holder: s.bank_account_holder, number: s.bank_account_number, branch: s.bank_branch_code, type: s.bank_account_type, note: s.eft_note, email: s.email, phone: s.phone } });
});
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('json') && req.path !== '/admin/upload') return res.status(415).json({ error: 'JSON required.' });
  next();
});

/* ---------- Order emails and payment confirmation (the owner clicks "Mark as paid" once the EFT reflects) ---------- */
function sendOrderEmails(o) {
  const items = db.prepare('SELECT name,size,unit_price_cents,qty FROM order_items WHERE order_id=?').all(o.id);
  const list = items.map((i) => `- ${i.qty} x ${i.name}${i.size ? ` (${i.size})` : ''}  ${money(i.unit_price_cents * i.qty)}`).join('\n');
  const where = o.method === 'delivery' ? `Delivery to: ${o.street}, ${o.suburb}, ${o.city}, ${o.province}, ${o.postal_code}` : 'Collection from the shop';
  const s = getSettings();
  sendMail({ to: o.email, subject: `Order ${o.ref} confirmed`, text: `Hi ${o.customer_name},\n\nThank you for your order. We have received your payment.\n\nOrder number: ${o.ref}\n${list}\n\nSubtotal: ${money(o.subtotal_cents)}\nDelivery: ${money(o.delivery_fee_cents)}\nTotal paid: ${money(o.total_cents)}\n\n${where}\n\nTrack your order: ${SITE_URL}/order/${o.ref}?t=${o.token}\n${s.whatsapp ? `WhatsApp us: ${waLink(s)}\n` : ''}\n${s.shop_name}` });
  sendMail({ to: process.env.OWNER_EMAIL, subject: `New paid order ${o.ref} (${money(o.total_cents)})`, text: `${o.customer_name}\n${o.email}\n${o.phone}\n${where}\n\n${list}\n\nOpen the admin: ${SITE_URL}/admin` });
}
function sendPlacedEmails(o, items) {
  const s = getSettings();
  const list = items.map((i) => `- ${i.qty} x ${i.name}${i.size ? ` (${i.size})` : ''}  ${money(i.unit_price_cents * i.qty)}`).join('\n');
  const bank = `Bank: ${s.bank_name}\nAccount holder: ${s.bank_account_holder}\nAccount number: ${s.bank_account_number}\n${s.bank_branch_code ? `Branch code: ${s.bank_branch_code}\n` : ''}${s.bank_account_type ? `Account type: ${s.bank_account_type}\n` : ''}`;
  sendMail({ to: o.email, subject: `Order ${o.ref}: please pay by EFT`, text: `Hi ${o.customer_name},\n\nThank you for your order. Please pay ${money(o.total_cents)} by EFT:\n\n${bank}Payment reference: ${o.ref}\n\n${list}\n\n${s.eft_note ? s.eft_note + '\n\n' : ''}We will confirm your order once your payment reflects in our account.\nYour order page: ${SITE_URL}/order/${o.ref}?t=${o.token}\n\n${s.shop_name}` });
  sendMail({ to: process.env.OWNER_EMAIL, subject: `New order ${o.ref} awaiting EFT (${money(o.total_cents)})`, text: `${o.customer_name}\n${o.email}\n${o.phone}\n\n${list}\n\nOpen the admin: ${SITE_URL}/admin` });
}
function markPaid(o) {
  const changed = tx(() => {
    const cur = db.prepare('SELECT payment_status FROM orders WHERE id=?').get(o.id);
    if (cur.payment_status === 'paid') return false; // already processed
    db.prepare("UPDATE orders SET payment_status='paid', status=CASE WHEN status='Pending' THEN 'Paid' ELSE status END, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);
    const dec = db.prepare('UPDATE products SET stock=MAX(stock-?,0) WHERE id=?');
    for (const i of db.prepare('SELECT product_id,qty FROM order_items WHERE order_id=? AND product_id IS NOT NULL').all(o.id)) dec.run(i.qty, i.product_id);
    return true;
  });
  if (changed) sendOrderEmails(o);
}
/* ---------- admin API ---------- */
const adm = express.Router();
adm.use(express.json({ limit: '100kb' }));
const BOTH = requireAuth(['owner', 'staff']), OWNER = requireAuth(['owner']);
const DUMMY = await hashPassword('not-a-real-password');

adm.post('/login', limiter(15 * 60 * 1000, 10, 'Too many sign-in attempts. Try again in 15 minutes.'), async (req, res) => {
  const email = clean(req.body?.email, 120).toLowerCase(), pw = String(req.body?.password || '').slice(0, 200);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = u ? await verifyPassword(pw, u.password_hash) : (await verifyPassword(pw, DUMMY), false);
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
  const s = createSession(u.id);
  res.cookie(COOKIE, s.token, { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: s.maxAge, path: '/' });
  res.json({ email: u.email, role: u.role });
});
adm.post('/logout', (req, res) => { destroySession(req); res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });
adm.get('/me', (req, res) => { const s = sessionFrom(req); s ? res.json({ email: s.email, role: s.role, csrf: s.csrf }) : res.status(401).json({ error: 'Please sign in.' }); });

adm.get('/orders', BOTH, (req, res) => {
  const st = String(req.query.status || '');
  const q = 'SELECT o.id,o.ref,o.customer_name,o.method,o.total_cents,o.status,o.payment_status,o.created_at,(SELECT COUNT(*) FROM order_items WHERE order_id=o.id) item_count FROM orders o';
  res.json(STATUSES.includes(st) ? db.prepare(q + ' WHERE status=? ORDER BY id DESC LIMIT 300').all(st) : db.prepare(q + ' ORDER BY id DESC LIMIT 300').all());
});
adm.get('/orders/:id', BOTH, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const { token, ...safe } = o;
  res.json({ ...safe, items: db.prepare('SELECT name,size,unit_price_cents,qty FROM order_items WHERE order_id=?').all(o.id), payments: db.prepare('SELECT provider,provider_ref,amount_cents,status,created_at FROM payments WHERE order_id=? ORDER BY id').all(o.id) });
});
adm.patch('/orders/:id', BOTH, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  const status = req.body?.status;
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  if (o.payment_status !== 'paid' && !['Pending', 'Cancelled'].includes(status)) return res.status(400).json({ error: 'This order has not been paid yet. Use "Mark as paid" once the EFT reflects in your bank account.' });
  if (o.payment_status === 'paid' && status === 'Pending') return res.status(400).json({ error: 'A paid order cannot go back to Pending.' });
  db.prepare('UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, o.id);
  const note = { 'Ready for Collection': 'is ready for collection.', 'Out for Delivery': 'is out for delivery.', Completed: 'is complete. Thank you for shopping with us!' }[status];
  if (note && o.status !== status) sendMail({ to: o.email, subject: `Order ${o.ref}: ${status}`, text: `Hi ${o.customer_name},\n\nYour order ${o.ref} ${note}\n\n${getSettings().shop_name}` });
  res.json({ ok: true });
});

adm.post('/orders/:id/mark-paid', OWNER, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (o.status === 'Cancelled') return res.status(400).json({ error: 'This order was cancelled.' });
  if (o.payment_status === 'paid') return res.status(400).json({ error: 'This order is already marked as paid.' });
  db.prepare('INSERT INTO payments(order_id,provider,provider_ref,amount_cents,status,raw) VALUES(?,?,?,?,?,?)').run(o.id, 'eft', req.user.email, o.total_cents, 'COMPLETE', JSON.stringify({ marked_paid_by: req.user.email }));
  markPaid(o);
  res.json({ ok: true });
});

const productInput = (b) => {
  const price = Math.round(parseFloat(String(b.price).replace(',', '.')) * 100), stock = Number(b.stock);
  const sizes = [...new Set(String(b.sizes || '').split(',').map((x) => clean(x, 10)).filter(Boolean))].slice(0, 12).join(',');
  const image = clean(b.image, 120);
  if (clean(b.name, 120).length < 2) return { error: 'Enter a product name.' };
  if (!Number.isFinite(price) || price <= 0 || price > 10000000) return { error: 'Enter a price greater than R0.' };
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) return { error: 'Stock must be a whole number, 0 or more.' };
  if (image && !/^\/uploads\/[\w.-]+$/.test(image)) return { error: 'Invalid image.' };
  return { v: [clean(b.name, 120), cleanLong(b.description, 1000), clean(b.category, 40), price, stock, sizes, image, b.active ? 1 : 0, b.featured ? 1 : 0] };
};
adm.get('/products', OWNER, (req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
adm.post('/products', OWNER, (req, res) => {
  const { v, error } = productInput(req.body || {});
  if (error) return res.status(400).json({ error });
  const r = db.prepare('INSERT INTO products(name,description,category,price_cents,stock,sizes,image,active,featured) VALUES(?,?,?,?,?,?,?,?,?)').run(...v);
  res.json({ id: Number(r.lastInsertRowid) });
});
adm.put('/products/:id', OWNER, (req, res) => {
  const { v, error } = productInput(req.body || {});
  if (error) return res.status(400).json({ error });
  const r = db.prepare('UPDATE products SET name=?,description=?,category=?,price_cents=?,stock=?,sizes=?,image=?,active=?,featured=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...v, Number(req.params.id));
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Product not found.' });
});
adm.delete('/products/:id', OWNER, (req, res) => {
  const p = db.prepare('SELECT image FROM products WHERE id=?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Product not found.' });
  db.prepare('DELETE FROM products WHERE id=?').run(Number(req.params.id)); // past orders keep their own copy of name and price
  if (p.image && !db.prepare('SELECT 1 FROM products WHERE image=?').get(p.image) && getSettings().hero_image !== p.image) fs.rm(path.join(UPLOAD_DIR, path.basename(p.image)), { force: true }, () => {});
  res.json({ ok: true });
});

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAGIC = { '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8, '.png': (b) => b.toString('latin1', 1, 4) === 'PNG', '.webp': (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' };
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (req, f, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXT[f.mimetype]) }),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 }, fileFilter: (req, f, cb) => cb(null, Boolean(EXT[f.mimetype])),
});
app.post('/api/admin/upload', OWNER, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image under 6 MB.' });
  const fd = fs.openSync(req.file.path, 'r'), head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
  if (!MAGIC[path.extname(req.file.filename)](head)) { fs.rmSync(req.file.path, { force: true }); return res.status(400).json({ error: 'That file is not a valid image.' }); }
  res.json({ url: `/uploads/${req.file.filename}` });
});

adm.get('/settings', OWNER, (req, res) => res.json(getSettings()));
adm.put('/settings', OWNER, (req, res) => { saveSettings(req.body || {}); res.json({ ok: true }); });
adm.get('/pages', OWNER, (req, res) => res.json(db.prepare('SELECT slug,title,body FROM pages').all()));
adm.put('/pages/:slug', OWNER, (req, res) => {
  if (!PAGE_SLUGS.includes(req.params.slug)) return res.status(404).json({ error: 'Unknown page.' });
  db.prepare('UPDATE pages SET body=? WHERE slug=?').run(cleanLong(req.body?.body, 20000), req.params.slug);
  res.json({ ok: true });
});
adm.get('/messages', BOTH, (req, res) => res.json(db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 200').all()));
adm.delete('/messages/:id', BOTH, (req, res) => { db.prepare('DELETE FROM messages WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); });

app.use('/api/admin', adm);
app.use('/api', pub);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((req, res) => res.status(404).type('html').send(page({ view: '404', title: 'Page not found', noindex: true })));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Upload failed: ' + err.message });
  console.error(err);
  res.status(500).json(req.path.startsWith('/api') ? { error: 'Something went wrong.' } : { error: 'Server error' });
});

/* ---------- startup ---------- */
if (process.argv.includes('--demo')) seedSamples();
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const { ADMIN_EMAIL: e, ADMIN_PASSWORD: p } = process.env;
  if (e && p && p.length >= 10) { db.prepare("INSERT INTO users(email,password_hash,role) VALUES(?,?,'owner')").run(e.toLowerCase(), await hashPassword(p)); console.log(`Created owner account ${e}. Remove ADMIN_PASSWORD from the environment now.`); }
  else console.log('No admin yet. Run: npm run create-admin -- you@example.com "a long password"   (or set ADMIN_EMAIL and ADMIN_PASSWORD)');
}
purgeSessions(); setInterval(purgeSessions, 60 * 60 * 1000).unref();
if (!eftReady(getSettings())) console.warn('No bank details yet: customers cannot place orders until you add them in Admin > Settings.');
app.listen(PORT, () => console.log(`SamaRose running at ${SITE_URL}`));
