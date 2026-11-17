(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(c / 100);
  const when = (d) => new Date(String(d).replace(' ', 'T') + 'Z').toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
  const STATUSES = ['Pending', 'Paid', 'Processing', 'Ready for Collection', 'Out for Delivery', 'Completed', 'Cancelled'];
  const view = $('#view'), dlg = $('#dlg');
  let me, tab = 'orders';

  async function api(path, { method = 'GET', body, form } = {}) {
    const o = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') o.headers['X-CSRF-Token'] = me?.csrf || '';
    if (form) o.body = form; else if (method !== 'GET' && method !== 'DELETE') { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body || {}); }
    const r = await fetch('/api/admin' + path, o);
    if (r.status === 401) { location.href = '/admin/login'; throw new Error('Signed out'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  }
  const toast = (msg) => alert(msg);
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { if (e.message !== 'Signed out') toast(e.message); } };
  const closeDlg = () => dlg.close();
  const openDlg = (html) => { dlg.innerHTML = `<div class="dlg">${html}</div>`; dlg.showModal(); };
  const payPill = (s) => `<span class="pill ${s === 'paid' ? 'ok' : s === 'failed' || s === 'cancelled' ? 'bad' : 'warn'}">${esc(s === 'unpaid' || s === 'pending' ? 'Awaiting EFT' : s)}</span>`;

  /* ---------- Orders ---------- */
  async function orders() {
    const filter = orders.filter || '';
    const list = await api('/orders' + (filter ? `?status=${encodeURIComponent(filter)}` : ''));
    const todo = list.filter((o) => ['Paid', 'Processing'].includes(o.status)).length;
    view.innerHTML = `<div class="ad-head"><div><h1>Orders</h1><p class="hint">An order becomes Paid when you open it and click "Mark as paid" after the EFT reflects in your bank account.</p></div>
      <div class="field nomargin"><label for="f">Filter by status</label><select id="f"><option value="">All orders</option>${STATUSES.map((s) => `<option ${s === filter ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <div class="tiles"><div class="tile"><b>${list.length}</b>Orders shown</div><div class="tile"><b>${todo}</b>Need action (paid)</div><div class="tile"><b>${list.filter((o) => o.payment_status !== 'paid' && o.status !== 'Cancelled').length}</b>Awaiting payment</div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Type</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
      ${list.map((o) => `<tr data-open="${o.id}"><td><b>${esc(o.ref)}</b></td><td>${when(o.created_at)}</td><td>${esc(o.customer_name)}</td><td>${o.method === 'delivery' ? 'Delivery' : 'Collection'}</td><td>${money(o.total_cents)}</td><td>${payPill(o.payment_status)}</td><td>${esc(o.status)}</td></tr>`).join('') || '<tr><td colspan="7">No orders yet.</td></tr>'}</tbody></table></div>`;
    $('#f').onchange = (e) => { orders.filter = e.target.value; run(); };
  }
  async function orderDialog(id) {
    const o = await api('/orders/' + id);
    const addr = o.method === 'delivery' ? [o.street, o.suburb, o.city, o.province, o.postal_code].map(esc).join('<br>') : 'Collection from the shop';
    const map = o.lat != null ? `<a class="link" href="https://www.google.com/maps?q=${o.lat},${o.lng}" target="_blank" rel="noopener noreferrer">Open shared location in Maps</a>` : '';
    openDlg(`<h2>${esc(o.ref)}</h2>
      <dl class="contact-list"><div class="kv"><dt>Customer</dt><dd>${esc(o.customer_name)}</dd></div>
      <div class="kv"><dt>Contact</dt><dd><a class="link" href="mailto:${esc(o.email)}">${esc(o.email)}</a><br><a class="link" href="tel:${esc(o.phone.replace(/[^\d+]/g, ''))}">${esc(o.phone)}</a></dd></div>
      <div class="kv"><dt>${o.method === 'delivery' ? 'Deliver to' : 'Fulfilment'}</dt><dd>${addr}${o.instructions ? `<br><em>Instructions: ${esc(o.instructions)}</em>` : ''}${map ? `<br>${map}` : ''}</dd></div>
      <div class="kv"><dt>Placed</dt><dd>${when(o.created_at)}</dd></div><div class="kv"><dt>Payment</dt><dd>${payPill(o.payment_status)} ${o.payments.map((p) => `<span class="hint">${esc(p.provider)} ${esc(p.status)} ${esc(p.provider_ref)}</span>`).join(' ')}</dd></div></dl>
      <table><tbody>${o.items.map((i) => `<tr><td>${i.qty} &times; ${esc(i.name)}${i.size ? ` (${esc(i.size)})` : ''}</td><td>${money(i.qty * i.unit_price_cents)}</td></tr>`).join('')}
      <tr><td>Subtotal</td><td>${money(o.subtotal_cents)}</td></tr><tr><td>Delivery fee</td><td>${money(o.delivery_fee_cents)}</td></tr><tr><td><b>Total</b></td><td><b>${money(o.total_cents)}</b></td></tr></tbody></table>
      <div class="field"><label for="st">Order status</label><select id="st">${STATUSES.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <p class="hint">Customers are emailed when an order is Ready for Collection, Out for Delivery or Completed (if email is set up).</p>
      <div class="dlg-actions"><button class="btn btn-ghost" type="button" id="x">Close</button><button class="btn" type="button" id="save">Save status</button>${o.payment_status !== 'paid' && o.status !== 'Cancelled' && me.role === 'owner' ? '<button class="btn" type="button" id="paid">Mark as paid</button>' : ''}</div>`);
    $('#x').onclick = closeDlg;
    if ($('#paid')) $('#paid').onclick = guard(async () => { if (confirm(`Mark ${o.ref} as paid? Only do this after the ${money(o.total_cents)} EFT shows in your bank account.`)) { await api('/orders/' + id + '/mark-paid', { method: 'POST' }); closeDlg(); run(); } });
    $('#save').onclick = guard(async () => { await api('/orders/' + id, { method: 'PATCH', body: { status: $('#st').value } }); closeDlg(); run(); });
  }

  /* ---------- Products ---------- */
  async function products() {
    const list = await api('/products');
    view.innerHTML = `<div class="ad-head"><div><h1>Products</h1><p class="hint">Changes appear in the shop straight away.</p></div><button class="btn" type="button" id="add">Add product</button></div>
      <div class="tbl-wrap"><table><thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${p.image ? `<img class="pt" src="${esc(p.image)}" alt="">` : '<div class="pt-ph"></div>'}</td><td><b>${esc(p.name)}</b>${p.sizes ? `<br><span class="hint">Options: ${esc(p.sizes)}</span>` : ''}</td><td>${esc(p.category)}</td><td>${money(p.price_cents)}</td>
      <td>${p.stock === 0 ? '<span class="pill bad">0</span>' : p.stock}</td><td>${p.active ? '<span class="pill ok">Live</span>' : '<span class="pill">Hidden</span>'}${p.featured ? ' <span class="pill">Featured</span>' : ''}</td>
      <td><button class="btn btn-ghost sm" data-edit="${p.id}" type="button">Edit</button></td></tr>`).join('') || '<tr><td colspan="7">No products yet. Click "Add product" to create your first one.</td></tr>'}</tbody></table></div>`;
    $('#add').onclick = () => productDialog(null, list);
    view.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => productDialog(list.find((p) => p.id === Number(b.dataset.edit)), list)));
  }
  /** Shrink photos in the browser before upload so pages stay fast. */
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP image.');
    const bmp = await createImageBitmap(file), s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b), 'image/webp', 0.86));
  }
  async function upload(file) {
    const blob = await shrink(file), fd = new FormData();
    fd.append('image', blob, 'upload' + (blob.type === 'image/webp' ? '.webp' : '.png'));
    return (await api('/upload', { method: 'POST', form: fd })).url;
  }
  /** Image picker block shared by the product form and Settings. Returns a getter for the current URL. */
  function imageField(host, current, label) {
    let url = current || '';
    host.innerHTML = `<div class="img-edit">${url ? `<img class="pv" src="${esc(url)}" alt="">` : '<div class="pv"></div>'}<div><label class="btn btn-ghost sm" for="img-in">${esc(label)}</label><input id="img-in" type="file" accept="image/jpeg,image/png,image/webp" class="sr"> <button type="button" class="btn btn-ghost sm" id="img-rm" ${url ? '' : 'hidden'}>Remove</button><p class="hint" id="img-st">JPG, PNG or WebP. Photos are resized automatically.</p></div></div>`;
    $('#img-in').onchange = guard(async (e) => { const f = e.target.files[0]; if (!f) return; $('#img-st').textContent = 'Uploading...'; url = await upload(f); imageField(host, url, label); getUrl = () => url; });
    $('#img-rm').onclick = () => { url = ''; imageField(host, '', label); getUrl = () => ''; };
    let getUrl = () => url;
    host.getUrl = () => getUrl();
  }
  function productDialog(p, all) {
    const cats = [...new Set(all.map((x) => x.category).filter(Boolean))];
    openDlg(`<h2>${p ? 'Edit product' : 'Add product'}</h2><form id="pf" class="form2" novalidate>
      <div class="full" id="imgf"></div>
      <div class="field full"><label for="n">Name</label><input id="n" value="${esc(p?.name)}" required></div>
      <div class="field"><label for="c">Category</label><input id="c" list="cats" value="${esc(p?.category)}" placeholder="e.g. Vegetables"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label for="pr">Price (R)</label><input id="pr" inputmode="decimal" value="${p ? (p.price_cents / 100).toFixed(2) : ''}" required></div>
      <div class="field"><label for="s">Stock quantity</label><input id="s" inputmode="numeric" value="${p ? p.stock : 0}" required></div>
      <div class="field"><label for="sz">Options, e.g. weight (optional)</label><input id="sz" value="${esc(p?.sizes)}" placeholder="500g,1kg,2kg"><span class="hint">Separate with commas. Customers pick one. Leave empty if there is only one option.</span></div>
      <div class="field full"><label for="d">Description</label><textarea id="d" rows="4">${esc(p?.description)}</textarea></div>
      <label class="cb"><input type="checkbox" id="a" ${!p || p.active ? 'checked' : ''}> Show in the shop</label>
      <label class="cb"><input type="checkbox" id="f" ${p?.featured ? 'checked' : ''}> Show under "Featured products" on the home page</label>
      <div class="dlg-actions full">${p ? '<button class="btn danger btn-ghost" type="button" id="del">Delete</button>' : ''}<button class="btn btn-ghost" type="button" id="x">Cancel</button><button class="btn" type="submit">Save product</button></div></form>`);
    const host = $('#imgf'); imageField(host, p?.image, 'Choose photo');
    $('#x').onclick = closeDlg;
    $('#pf').onsubmit = guard(async (e) => {
      e.preventDefault();
      const body = { name: $('#n').value, category: $('#c').value, price: $('#pr').value, stock: $('#s').value, sizes: $('#sz').value, description: $('#d').value, image: host.getUrl(), active: $('#a').checked, featured: $('#f').checked };
      await api(p ? '/products/' + p.id : '/products', { method: p ? 'PUT' : 'POST', body }); closeDlg(); run();
    });
    if (p) $('#del').onclick = guard(async () => { if (confirm(`Delete "${p.name}"? This cannot be undone. Past orders keep their own record.`)) { await api('/products/' + p.id, { method: 'DELETE' }); closeDlg(); run(); } });
  }

  /* ---------- Messages ---------- */
  async function messages() {
    const list = await api('/messages');
    view.innerHTML = `<div class="ad-head"><h1>Messages</h1></div>${list.map((m) => `<div class="msg"><b>${esc(m.name)}</b> <span class="hint">${when(m.created_at)}</span><br><a class="link" href="mailto:${esc(m.email)}">${esc(m.email)}</a>${m.phone ? ` · ${esc(m.phone)}` : ''}<p>${esc(m.message)}</p><button class="btn btn-ghost sm" data-del="${m.id}" type="button">Delete</button></div>`).join('') || '<p class="hint">No messages yet.</p>'}`;
    view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = guard(async () => { if (confirm('Delete this message?')) { await api('/messages/' + b.dataset.del, { method: 'DELETE' }); run(); } })));
  }

  /* ---------- Pages ---------- */
  async function pages() {
    const list = await api('/pages'), order = ['about', 'privacy', 'terms', 'returns', 'delivery'];
    list.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
    view.innerHTML = `<div class="ad-head"><div><h1>Pages</h1><p class="hint">Start a section with <code>## Heading</code>. Leave a blank line between paragraphs. Start lines with <code>- </code> for a list. Anything in [square brackets] is shown highlighted as a to-do: replace it with your own information.</p></div></div>
      ${list.map((p) => `<div class="set-sec"><h2>${esc(p.title)}</h2><textarea class="big" data-slug="${p.slug}" aria-label="${esc(p.title)}">${esc(p.body)}</textarea><div class="dlg-actions"><a class="link" href="/${p.slug}" target="_blank" rel="noopener">View page</a><button class="btn sm" data-save="${p.slug}" type="button">Save ${esc(p.title)}</button></div></div>`).join('')}`;
    view.querySelectorAll('[data-save]').forEach((b) => (b.onclick = guard(async () => { await api('/pages/' + b.dataset.save, { method: 'PUT', body: { body: $(`[data-slug="${b.dataset.save}"]`).value } }); b.textContent = 'Saved'; setTimeout(run, 800); })));
  }

  /* ---------- Settings ---------- */
  async function settings() {
    const s = await api('/settings');
    const f = (k, l, extra = '') => `<div class="field"><label for="s-${k}">${l}</label><input id="s-${k}" data-k="${k}" value="${esc(s[k])}" ${extra}></div>`;
    const t = (k, l, h = '') => `<div class="field"><label for="s-${k}">${l}</label><textarea id="s-${k}" data-k="${k}" rows="3">${esc(s[k])}</textarea>${h ? `<span class="hint">${h}</span>` : ''}</div>`;
    view.innerHTML = `<div class="ad-head"><h1>Settings</h1></div><form id="sf" novalidate>
      <div class="set-sec"><h2>Home page</h2><div id="heroimg"></div>${f('shop_name', 'Shop name')}${f('hero_title', 'Home page headline')}${t('hero_text', 'Welcome message')}
        <div class="field"><label for="s-accent">Brand colour</label><input id="s-accent" data-k="accent" type="color" value="${esc(s.accent)}"><span class="hint">Used for buttons and highlights. Choose a colour dark enough for white text to stay readable.</span></div></div>
      <div class="set-sec"><h2>Contact details</h2>${f('phone', 'Business phone number')}${f('email', 'Email address')}${f('whatsapp', 'WhatsApp number (digits with country code, e.g. 27XXXXXXXXX)', 'inputmode="numeric"')}${t('address', 'Physical shop address')}${t('hours', 'Opening hours', 'One line per day or range.')}
        ${f('facebook', 'Facebook link (https://...)')}${f('instagram', 'Instagram link (https://...)')}${f('tiktok', 'TikTok link (https://...)')}</div>
      <div class="set-sec"><h2>Collection and delivery</h2>${t('collection_address', 'Collection address shown at checkout')}${f('delivery_fee', 'Delivery fee (R)', 'inputmode="decimal"')}${f('free_delivery_over', 'Free delivery on orders over (R). Use 0 to turn off.', 'inputmode="decimal"')}</div>
      <div class="set-sec"><h2>Bank details for EFT</h2><p class="hint">Customers see these after they place an order. They cannot order until the bank name, account holder and account number are filled in.</p>${f('bank_name', 'Bank name')}${f('bank_account_holder', 'Account holder')}${f('bank_account_number', 'Account number', 'inputmode="numeric"')}${f('bank_branch_code', 'Branch code')}${f('bank_account_type', 'Account type (e.g. Cheque or Savings)')}${t('eft_note', 'Extra payment instructions (optional)', 'Shown on the order page, for example: Send proof of payment on WhatsApp.')}</div>
      <button class="btn" type="submit">Save settings</button></form>`;
    const host = $('#heroimg'); imageField(host, s.hero_image, 'Choose shop photo');
    host.insertAdjacentHTML('afterbegin', '<p><b>Shop photo</b> (large picture on the home page)</p>');
    $('#sf').onsubmit = guard(async (e) => {
      e.preventDefault();
      const body = { hero_image: host.getUrl() };
      view.querySelectorAll('[data-k]').forEach((i) => (body[i.dataset.k] = i.value));
      await api('/settings', { method: 'PUT', body }); toast('Settings saved.'); run();
    });
  }

  const TABS = { orders: ['Orders', orders, 'staff'], products: ['Products', products], messages: ['Messages', messages, 'staff'], pages: ['Pages', pages], settings: ['Settings', settings] };
  function run() { return guard(TABS[tab][1])(); }
  async function boot() {
    try { me = await (await fetch('/api/admin/me', { credentials: 'same-origin' })).json(); } catch { /* handled below */ }
    if (!me?.csrf) return (location.href = '/admin/login');
    $('#who').textContent = `${me.email} (${me.role})`;
    const allowed = Object.entries(TABS).filter(([, v]) => me.role === 'owner' || v[2] === 'staff');
    if (!allowed.find(([k]) => k === tab)) tab = allowed[0][0];
    $('#tabs').innerHTML = allowed.map(([k, v]) => `<button type="button" data-tab="${k}">${v[0]}</button>`).join('');
    const mark = () => document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab));
    $('#tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; mark(); run(); } };
    view.addEventListener('click', (e) => { const r = e.target.closest('[data-open]'); if (r) guard(orderDialog)(r.dataset.open); });
    $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); location.href = '/admin/login'; };
    mark(); run();
  }
  boot();
})();
