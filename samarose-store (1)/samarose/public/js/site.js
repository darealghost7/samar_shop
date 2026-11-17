/* Shared storefront code: cart (browser storage), cart drawer, product cards, home + shop grids. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
  const money = (c) => fmt.format(c / 100);
  const getJSON = (u) => fetch(u, { headers: { Accept: 'application/json' } }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  let _p, _c;
  const products = () => _p || (_p = getJSON('/api/products'));
  const config = () => _c || (_c = getJSON('/api/config'));
  const HANGER = '<div class="ph"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 50C12 26 28 10 52 10c2 24-12 40-34 40M14 50C26 36 36 26 46 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';

  /* Cart = [{id, size, qty}] in localStorage. Prices always come from the server, never from storage. */
  const KEY = 'samarose.cart.v1';
  const Cart = {
    get() { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } },
    save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } document.dispatchEvent(new Event('cart')); },
    add(id, size, max) { const c = this.get(), i = c.find((x) => x.id === id && x.size === size); if (i) i.qty = Math.min(i.qty + 1, max); else c.push({ id, size, qty: 1 }); this.save(c); },
    set(id, size, qty, max) { this.save(this.get().map((x) => (x.id === id && x.size === size ? { ...x, qty: Math.min(qty, max) } : x)).filter((x) => x.qty > 0)); },
    remove(id, size) { this.save(this.get().filter((x) => !(x.id === id && x.size === size))); },
    clear() { this.save([]); },
  };
  /** Cart lines joined with live product data; unavailable products are dropped. */
  async function lines() {
    const map = new Map((await products()).map((p) => [p.id, p]));
    return Cart.get().map((l) => ({ ...l, p: map.get(l.id) }))
      .filter((l) => l.p && l.p.stock > 0 && (l.p.sizes.length ? l.p.sizes.includes(l.size) : !l.size))
      .map((l) => ({ ...l, qty: Math.min(l.qty, l.p.stock) }));
  }
  window.SR = { $, $$, esc, money, getJSON, products, config, Cart, lines, HANGER };

  /* ---- header menu ---- */
  const hdr = $('.site-header'), mbtn = $('[data-menu]');
  const setMenu = (open) => { hdr.classList.toggle('menu-open', open); document.body.classList.toggle('lock', open); mbtn.setAttribute('aria-expanded', open); mbtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); };
  mbtn.addEventListener('click', () => setMenu(!hdr.classList.contains('menu-open')));
  $$('.menu-link').forEach((a) => a.addEventListener('click', () => setMenu(false)));

  /* ---- cart drawer ---- */
  const drawer = $('#cart'), body = $('#cart-body'), foot = $('#cart-foot');
  let lastFocus;
  const setCart = (open) => {
    document.body.classList.toggle('cart-open', open); document.body.classList.toggle('lock', open); drawer.setAttribute('aria-hidden', !open);
    if (open) { lastFocus = document.activeElement; $('.drawer-head .icon-btn').focus(); } else lastFocus?.focus?.();
  };
  async function renderCart() {
    let L = [];
    try { L = await lines(); } catch { body.innerHTML = '<p class="muted">The cart could not load. Please refresh.</p>'; return; }
    const n = L.reduce((t, l) => t + l.qty, 0), sub = L.reduce((t, l) => t + l.qty * l.p.price_cents, 0);
    $$('[data-cart-count]').forEach((b) => { b.textContent = n; b.hidden = !n; });
    body.innerHTML = L.length ? L.map((l) => `<div class="line" data-id="${l.id}" data-size="${esc(l.size)}" data-max="${l.p.stock}">
      <div class="thumb">${l.p.image ? `<img src="${esc(l.p.image)}" alt="">` : HANGER}</div>
      <div><h3>${esc(l.p.name)}</h3><p class="meta">${l.size ? `${esc(l.size)} · ` : ''}${money(l.p.price_cents)}</p>
      <div><span class="qty"><button type="button" data-act="dec" aria-label="Decrease quantity of ${esc(l.p.name)}">&minus;</button><span aria-live="polite">${l.qty}</span><button type="button" data-act="inc" aria-label="Increase quantity of ${esc(l.p.name)}" ${l.qty >= l.p.stock ? 'disabled' : ''}>+</button></span><button type="button" class="rm" data-act="rm">Remove</button></div></div></div>`).join('')
      : '<p class="muted empty-cart">Your cart is empty.</p>';
    foot.innerHTML = L.length
      ? `<div class="tot"><span>Subtotal</span><span>${money(sub)}</span></div><div class="tot big"><span>Total</span><span>${money(sub)}</span></div><p class="muted">Delivery, if chosen, is added at checkout.</p><a class="btn btn-block" href="/checkout">Go to checkout</a>`
      : '<a class="btn btn-block" href="/shop" data-cart-close>Browse the shop</a>';
  }
  document.addEventListener('cart', renderCart);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-cart-open]')) return setCart(true);
    if (e.target.closest('[data-cart-close]')) return setCart(false);
    const act = e.target.closest('[data-act]');
    if (act) {
      const row = act.closest('.line'), id = Number(row.dataset.id), size = row.dataset.size, max = Number(row.dataset.max);
      const cur = Cart.get().find((x) => x.id === id && x.size === size)?.qty || 1;
      if (act.dataset.act === 'rm') Cart.remove(id, size); else Cart.set(id, size, cur + (act.dataset.act === 'inc' ? 1 : -1), max);
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setCart(false); setMenu(false); } });

  /* ---- product cards ---- */
  function card(p) {
    const out = p.stock <= 0, low = !out && p.stock <= 5;
    const sizes = p.sizes.length ? `<label class="size"><span class="sr">Option for ${esc(p.name)}</span><select data-size>${p.sizes.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>` : '';
    return `<article class="card" data-id="${p.id}"><div class="frame">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" width="600" height="750" loading="lazy">` : HANGER}</div>
    <div class="card-body"><h3>${esc(p.name)}</h3><p class="price">${money(p.price_cents)}</p>
    <p class="stock ${out ? 'out' : low ? 'low' : 'in'}">${out ? 'Out of stock' : low ? `Only ${p.stock} left` : 'In stock'}</p>
    <p class="desc">${esc(p.description)}</p>${sizes}<button class="btn" type="button" data-add ${out ? 'disabled' : ''}>${out ? 'Out of stock' : 'Add to cart'}</button></div></article>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const el = b.closest('.card'), p = (await products()).find((x) => x.id === Number(el.dataset.id));
    if (!p || p.stock <= 0) return;
    Cart.add(p.id, $('[data-size]', el)?.value || '', p.stock);
    setCart(true);
  });

  /* ---- home: featured ---- */
  const feat = $('[data-products="featured"]');
  if (feat) products().then((l) => { feat.innerHTML = l.length ? l.slice(0, 4).map(card).join('') : '<p class="empty">Products will appear here once they have been added.</p>'; })
    .catch(() => { feat.innerHTML = '<p class="empty">Products could not load. Please refresh.</p>'; });

  /* ---- shop: search, category, sort ---- */
  const grid = $('#grid');
  if (grid) {
    const q = $('#search'), sort = $('#sort'), chips = $('#chips'), count = $('#count');
    const params = new URLSearchParams(location.search);
    const st = { q: params.get('q') || '', cat: params.get('cat') || '', sort: 'new' };
    q.value = st.q;
    products().then((all) => {
      const cats = [...new Set(all.map((p) => p.category).filter(Boolean))].sort();
      if (!cats.includes(st.cat)) st.cat = '';
      const draw = () => {
        const t = st.q.toLowerCase();
        let l = all.filter((p) => (!st.cat || p.category === st.cat) && (!t || (p.name + ' ' + p.description).toLowerCase().includes(t)));
        const by = { low: (a, b) => a.price_cents - b.price_cents, high: (a, b) => b.price_cents - a.price_cents, name: (a, b) => a.name.localeCompare(b.name) }[st.sort];
        if (by) l = [...l].sort(by);
        chips.innerHTML = cats.length ? ['', ...cats].map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${st.cat === c}">${c ? esc(c) : 'All'}</button>`).join('') : '';
        grid.innerHTML = l.length ? l.map(card).join('') : `<p class="empty">${all.length ? 'No products match your search.' : 'Products will appear here once they have been added.'}</p>`;
        count.textContent = all.length ? `${l.length} ${l.length === 1 ? 'product' : 'products'}` : '';
        const u = new URLSearchParams(); if (st.q) u.set('q', st.q); if (st.cat) u.set('cat', st.cat);
        history.replaceState(null, '', location.pathname + (u.size ? '?' + u : '') + location.hash);
      };
      q.addEventListener('input', () => { st.q = q.value.trim(); draw(); });
      sort.addEventListener('change', () => { st.sort = sort.value; draw(); });
      chips.addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (b) { st.cat = b.dataset.cat; draw(); } });
      draw();
      if (location.hash === '#search') q.focus();
    }).catch(() => { grid.innerHTML = '<p class="empty">Products could not load. Please refresh.</p>'; });
  }
  renderCart();
})();
