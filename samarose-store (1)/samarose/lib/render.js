import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings } from './db.js';
import { PROD } from './env.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map();
const view = (n) => {
  if (PROD && cache.has(n)) return cache.get(n);
  const t = fs.readFileSync(path.join(ROOT, 'views', n + '.html'), 'utf8');
  if (PROD) cache.set(n, t);
  return t;
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (c) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(c / 100);

/* Missing business details show as a highlighted [Add ...] marker for the owner to fill in. */
const slot = (l) => `<span class="slot">[Add ${esc(l)}]</span>`;
const nl = (t) => esc(t).replace(/\n/g, '<br>');
const inline = (t) => esc(t).replace(/\[([^\]]+)\]/g, '<span class="slot">[$1]</span>');
export const waLink = (s) => (s.whatsapp ? `https://wa.me/${s.whatsapp.replace(/\D/g, '')}` : '');

/** Admin-editable text: "## Heading" starts a section, blank line = paragraph, "- " lines = list. */
export function sections(text) {
  const out = [{ h: '', blocks: [] }];
  for (const raw of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    const b = raw.trim();
    if (!b) continue;
    if (b.startsWith('## ')) {
      const [first, ...rest] = b.split('\n');
      out.push({ h: first.slice(3).trim(), blocks: rest.join('\n').trim() ? [rest.join('\n').trim()] : [] });
    } else out[out.length - 1].blocks.push(b);
  }
  const block = (b) => {
    const l = b.split('\n');
    return l.every((x) => x.startsWith('- ')) ? `<ul>${l.map((x) => `<li>${inline(x.slice(2))}</li>`).join('')}</ul>` : `<p>${l.map(inline).join('<br>')}</p>`;
  };
  return out.filter((x) => x.h || x.blocks.length).map((x) => ({ h: x.h, html: x.blocks.map(block).join('') }));
}

const ICON = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
};
export const HANGER = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 50C12 26 28 10 52 10c2 24-12 40-34 40M14 50C26 36 36 26 46 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function contactBlock(s) {
  const row = (l, h) => `<div class="kv"><dt>${l}</dt><dd>${h}</dd></div>`;
  return '<dl class="contact-list">'
    + row('Phone', s.phone ? `<a class="link" href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>` : slot('phone number'))
    + row('Email', s.email ? `<a class="link" href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : slot('email address'))
    + row('WhatsApp', s.whatsapp ? `<a class="link" href="${esc(waLink(s))}" rel="noopener">Chat on WhatsApp</a>` : slot('WhatsApp number'))
    + row('Shop address', s.address ? nl(s.address) : slot('shop address'))
    + row('Opening hours', s.hours ? nl(s.hours) : slot('opening hours'))
    + '</dl>';
}
export function socials(s) {
  const items = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']];
  return '<ul class="socials">' + items.map(([k, n]) => `<li>${s[k] ? `<a class="link" href="${esc(s[k])}" target="_blank" rel="noopener noreferrer">${n}</a>` : slot(n + ' link')}</li>`).join('') + '</ul>';
}

const NAV = [['/', 'Home'], ['/shop', 'Shop'], ['/about', 'About'], ['/contact', 'Contact']];
const header = (s, p) => {
  const links = (cls) => NAV.map(([h, l]) => `<a class="${cls}" href="${h}"${h === p ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  return `<a class="skip" href="#main">Skip to content</a>
<header class="site-header" id="top"><div class="wrap bar">
<div class="left"><button class="icon-btn menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="menu" data-menu>${ICON.menu}</button><nav class="nav" aria-label="Main">${links('link')}</nav></div>
<a class="brand" href="/">${esc(s.shop_name)}</a>
<div class="tools"><a class="icon-btn" href="/shop#search" aria-label="Search products">${ICON.search}</a><button class="icon-btn" type="button" aria-label="Open cart" data-cart-open>${ICON.bag}<span class="count" data-cart-count hidden>0</span></button></div>
</div><nav class="menu" id="menu" aria-label="Mobile">${links('menu-link')}</nav></header>`;
};
const footer = (s) => `<footer class="site-footer"><div class="wrap foot">
<div><p class="brand sm">${esc(s.shop_name)}</p><p class="muted">Fresh vegetables, beans, rice and more.</p>${socials(s)}</div>
<div><p class="foot-h">Shop</p><ul class="foot-links"><li><a class="link" href="/shop">Shop</a></li><li><a class="link" href="/about">About</a></li><li><a class="link" href="/contact">Contact</a></li></ul>
<p class="foot-h">Policies</p><ul class="foot-links"><li><a class="link" href="/privacy">Privacy Policy</a></li><li><a class="link" href="/terms">Terms and Conditions</a></li><li><a class="link" href="/returns">Returns and Refund Policy</a></li><li><a class="link" href="/delivery">Delivery Policy</a></li></ul></div>
<div><p class="foot-h">Contact</p>${contactBlock(s)}</div>
</div><div class="wrap legal"><span>&copy; ${new Date().getFullYear()} ${esc(s.shop_name)}. Prices in South African Rand (ZAR).</span><span>Website by Darealtech</span></div></footer>
<div class="scrim" data-cart-close></div>
<aside class="drawer" id="cart" aria-label="Shopping cart" aria-hidden="true"><div class="drawer-head"><p class="drawer-title">Your cart</p><button class="icon-btn" type="button" aria-label="Close cart" data-cart-close>${ICON.close}</button></div>
<div class="drawer-body" id="cart-body"></div><div class="drawer-foot" id="cart-foot"></div></aside>`;

/** Wrap a view in the shared layout. {{key}} = escaped value (setting or vars), {{!key}} = trusted HTML from `raw`. */
export function page({ title, desc = '', view: name, path: p = '', vars = {}, raw = {}, noindex = false, scripts = [] }) {
  const s = getSettings();
  const all = { ...s, ...vars };
  const body = view(name).replace(/\{\{(!?)(\w+)\}\}/g, (_, bang, k) => (bang ? raw[k] ?? '' : esc(all[k] ?? '')));
  const t = p === '/' ? `${s.shop_name} | Fresh groceries` : `${title} | ${s.shop_name}`;
  return `<!doctype html>
<html lang="en-ZA" data-type="place"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="page-type" content="place"><meta name="site-kind" content="other"><meta name="page-kind" content="place">
<title>${esc(t)}</title><meta name="description" content="${esc(desc || s.hero_text)}">${noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Roboto+Condensed:wght@300;400;500;700&display=swap">
<link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/theme.css"></head>
<body>${header(s, p)}<main id="main">${body}</main>${footer(s)}
<script src="/js/site.js" defer></script>${scripts.map((x) => `<script src="/js/${x}.js" defer></script>`).join('')}</body></html>`;
}
