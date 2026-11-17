import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import './env.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'samarose.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK(role IN ('owner','staff')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents>=0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), sizes TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE NOT NULL, token TEXT NOT NULL,
  customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('collection','delivery')),
  street TEXT NOT NULL DEFAULT '', suburb TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
  lat REAL, lng REAL,
  subtotal_cents INTEGER NOT NULL, delivery_fee_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending', payment_status TEXT NOT NULL DEFAULT 'unpaid',
  consent_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL, size TEXT NOT NULL DEFAULT '', unit_price_cents INTEGER NOT NULL, qty INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_ref TEXT, amount_cents INTEGER, status TEXT NOT NULL, raw TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pages(slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);

/** Run fn inside a transaction (all node:sqlite calls are synchronous). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------- Settings (editable in Admin > Settings) ---------- */
export const SETTINGS = {
  shop_name:          { type: 'text',   def: 'SamaRose' },
  hero_title:         { type: 'text',   def: 'Fresh produce, beans and rice from SamaRose' },
  hero_text:          { type: 'long',   def: 'Order your groceries online, pay by EFT, then collect from the shop or have them delivered.' },
  hero_image:         { type: 'image',  def: '' },
  accent:             { type: 'hex',    def: '#0B7A5C' },
  phone:              { type: 'text',   def: '' },
  email:              { type: 'text',   def: '' },
  whatsapp:           { type: 'digits', def: '' },
  address:            { type: 'long',   def: '' },
  collection_address: { type: 'long',   def: '' },
  hours:              { type: 'long',   def: '' },
  facebook:           { type: 'url',    def: '' },
  instagram:          { type: 'url',    def: '' },
  tiktok:             { type: 'url',    def: '' },
  delivery_fee:       { type: 'money',  def: '0.00' },
  free_delivery_over: { type: 'money',  def: '0.00' },
  bank_name:           { type: 'text', def: '' },
  bank_account_holder: { type: 'text', def: '' },
  bank_account_number: { type: 'text', def: '' },
  bank_branch_code:    { type: 'text', def: '' },
  bank_account_type:   { type: 'text', def: '' },
  eft_note:            { type: 'long', def: '' },
};
export function getSettings() {
  const s = Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.def]));
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (r.key in s) s[r.key] = r.value;
  return s;
}
const clean = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
function sanitize(type, v) {
  switch (type) {
    case 'text': return clean(v, 150).replace(/\n/g, ' ');
    case 'long': return clean(v, 800);
    case 'url': { const u = clean(v, 300); return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
    case 'hex': { const h = clean(v, 7); return /^#[0-9a-f]{6}$/i.test(h) ? h : SETTINGS.accent.def; }
    case 'money': { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < 100000 ? n.toFixed(2) : '0.00'; }
    case 'digits': return clean(v, 20).replace(/\D/g, '');
    case 'image': { const u = clean(v, 120); return /^\/uploads\/[\w.-]+$/.test(u) ? u : ''; }
  }
  return '';
}
export function saveSettings(input) {
  const st = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(() => { for (const [k, d] of Object.entries(SETTINGS)) if (k in input) st.run(k, sanitize(d.type, input[k])); });
}

/* ---------- Editable pages (placeholders: the owner completes these) ---------- */
const P = '[Add business information here]';
const SEED_PAGES = {
  about: ['About us', `## Our Story\n${P}\n\n## Who We Are\n${P}\n\n## Our Mission\n${P}\n\n## Our Vision\n${P}\n\n## Our Values\n${P}`],
  privacy: ['Privacy Policy', `## Who we are
[Add the business's registered name, physical address, email address and Information Officer details here]

## What information we collect
When you place an order we collect your name, email address and phone number. For delivery we also collect your delivery address and any delivery instructions. If you choose "Share my location", we also receive your device's coordinates for that order; this is optional and a typed address is always enough. If you use the contact form we collect your name, email address, phone number and message. We do not collect card numbers or banking logins: you pay by EFT from your own bank, and we only see the payment arrive in our bank account.

## Why we collect it
- To prepare, deliver or hand over your order
- To confirm your order and contact you about it
- To reply to your enquiries
- To keep transaction records as required by law

## Consent
We ask for your consent at checkout before we process your order details.

## Who we share it with
[Add any service providers here, for example delivery couriers, email provider and hosting provider]

## How long we keep it
[Add retention period here]

## How we protect it
Order and delivery details are only visible to authorised staff after they sign in. This website is served over HTTPS and does not store card details.

## Your rights
Under the Protection of Personal Information Act (POPIA) you may ask to see, correct or delete your personal information. Contact us at [Add Information Officer contact here]. You may also complain to the Information Regulator.

## Cookies and local storage
This website only uses what it needs to work: your shopping cart is saved in your browser's local storage, and signed-in staff receive a session cookie. We do not use advertising or tracking cookies. [Update this section if you add analytics or marketing tools]`],
  terms: ['Terms and Conditions', `## Business details\n[Add full legal name, legal status, registration number, VAT number (if registered), physical address, email address and phone number here]\n\n## Prices and payment\nAll prices are in South African Rand (ZAR). Payment is made by EFT (bank transfer) using your order number as the reference. Orders are prepared once the payment reflects in our account. [Add whether prices include VAT]\n\n## Orders\n[Add how orders are accepted, how stock shortages are handled and when an order is confirmed]\n\n## Collection and delivery\nSee the Delivery Policy. [Add any further collection or delivery terms]\n\n## Returns and refunds\nSee the Returns and Refund Policy.\n\n## Governing law and complaints\n[Add governing law, complaints process and contact details here]`],
  returns: ['Returns and Refund Policy', `## Returns\n[Add your returns policy here: which items can be returned, the time allowed, the condition required and how to start a return]\n\n## Refunds\n[Add your refund policy here: how refunds are paid and how long they take]\n\n## Faulty or incorrect items\n[Add how customers report faulty or incorrect items]`],
  delivery: ['Delivery Policy', `## Delivery areas\n[Add the areas you deliver to here]\n\n## Delivery fees\nThe delivery fee is shown at checkout before you pay. [Add details such as free delivery thresholds if they apply]\n\n## Delivery times\n[Add estimated delivery times here]\n\n## Collection\n[Add collection details and how long orders are held here]`],
};
export const PAGE_SLUGS = Object.keys(SEED_PAGES);
const ins = db.prepare('INSERT OR IGNORE INTO pages(slug,title,body) VALUES(?,?,?)');
for (const [slug, [title, body]] of Object.entries(SEED_PAGES)) ins.run(slug, title, body);

/* ---------- Optional demo products (node server.js --demo). Delete them in Admin before launch. ---------- */
export function seedSamples() {
  if (db.prepare('SELECT COUNT(*) n FROM products').get().n) return;
  const cats = ['Vegetables', 'Beans and rice', 'Fruit', 'Pantry'];
  const st = db.prepare('INSERT INTO products(name,description,category,price_cents,stock,sizes,featured) VALUES(?,?,?,?,?,?,?)');
  for (let i = 1; i <= 8; i++) st.run(`Sample product ${i}`, '[Add product description]', cats[(i - 1) % 4], 2900 + i * 500, i === 4 ? 0 : 3 + i, i <= 6 ? '500g,1kg,2kg' : '', i <= 4 ? 1 : 0);
}
