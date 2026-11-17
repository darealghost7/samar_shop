(async () => {
  const { $, $$, esc, money, config, lines, Cart } = SR;
  const co = $('#co'); if (!co) return;
  const form = $('#details'), review = $('#review');
  const [cfg, L] = await Promise.all([config(), lines()]);
  if (!cfg.eft) $('#nopay').hidden = false;
  if (!L.length) { $('#empty').hidden = false; return; }
  co.hidden = false;
  const sub = L.reduce((t, l) => t + l.qty * l.p.price_cents, 0);
  const method = () => form.elements.fulfilment.value;
  const fee = () => (method() !== 'delivery' ? 0 : cfg.free_over_cents > 0 && sub >= cfg.free_over_cents ? 0 : cfg.delivery_fee_cents);
  $('#fee-note').textContent = cfg.delivery_fee_cents ? `Fee ${money(cfg.delivery_fee_cents)}${cfg.free_over_cents ? `, free over ${money(cfg.free_over_cents)}` : ''}.` : 'Delivered to your address.';

  function summary() {
    $('#summary').innerHTML = `<h2>Order summary</h2>${L.map((l) => `<div class="sline"><span>${l.qty} &times; ${esc(l.p.name)}${l.size ? `<small>${esc(l.size)}</small>` : ''}</span><span>${money(l.qty * l.p.price_cents)}</span></div>`).join('')}
    <div class="tot"><span>Subtotal</span><span>${money(sub)}</span></div>
    <div class="tot"><span>${method() === 'delivery' ? 'Delivery fee' : 'Collection'}</span><span>${fee() ? money(fee()) : 'Free'}</span></div>
    <div class="tot big"><span>Total</span><span>${money(sub + fee())}</span></div>`;
  }
  const syncMethod = () => { const d = method() === 'delivery'; $('#delivery').hidden = !d; $('#collection').hidden = d; summary(); };
  form.addEventListener('change', (e) => { if (e.target.name === 'fulfilment') syncMethod(); });
  syncMethod();

  /* Optional GPS: only on click, only after the browser's own permission prompt. */
  let geo = null;
  $('#geo').addEventListener('click', () => {
    const st = $('#geo-status'), btn = $('#geo');
    if (geo) { geo = null; btn.textContent = 'Share my location'; st.textContent = 'Location removed.'; return; }
    if (!navigator.geolocation) { st.textContent = 'Location is not available on this device. Please type your address.'; return; }
    st.textContent = 'Waiting for your permission...';
    navigator.geolocation.getCurrentPosition(
      (p) => { geo = { lat: p.coords.latitude, lng: p.coords.longitude }; btn.textContent = 'Remove my location'; st.textContent = 'Location added to this order. Please still check your address above.'; },
      () => { st.textContent = 'Location not shared. That is fine, just type your address.'; },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });

  const clearErr = () => { $$('.err', form).forEach((x) => (x.textContent = '')); $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid')); $('#form-err').hidden = true; };
  function showErrors(errs) {
    for (const [k, m] of Object.entries(errs)) {
      const s = form.querySelector(`[data-err="${k}"]`);
      if (s) { s.textContent = m; form.elements[k]?.setAttribute('aria-invalid', 'true'); }
      else { const f = $('#form-err'); f.textContent = m; f.hidden = false; }
    }
    review.hidden = true; form.hidden = false;
    (form.querySelector('[aria-invalid]') || $('#form-err')).focus?.();
  }
  const payload = () => {
    const d = Object.fromEntries(new FormData(form)), del = d.fulfilment === 'delivery';
    return { name: d.name.trim(), email: d.email.trim(), phone: d.phone.trim(), method: d.fulfilment, consent: !!d.consent,
      items: L.map((l) => ({ id: l.id, size: l.size, qty: l.qty })),
      address: del ? { street: d.street, suburb: d.suburb, city: d.city, province: d.province, postal_code: d.postal_code, instructions: d.instructions, lat: geo?.lat, lng: geo?.lng } : undefined };
  };
  function validate(p) {
    const e = {};
    if (p.name.length < 2) e.name = 'Please enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(p.email)) e.email = 'Please enter a valid email address.';
    if (!/^\+?[0-9 ()-]{9,18}$/.test(p.phone)) e.phone = 'Please enter a valid contact number.';
    if (p.method === 'delivery') {
      const a = p.address;
      if (a.street.trim().length < 3) e.street = 'Enter your street address.';
      if (a.suburb.trim().length < 2) e.suburb = 'Enter your suburb.';
      if (a.city.trim().length < 2) e.city = 'Enter your city or town.';
      if (!a.province) e.province = 'Choose your province.';
      if (!/^\d{4}$/.test(a.postal_code.trim())) e.postal_code = 'Enter a 4-digit postal code.';
    }
    if (!p.consent) e.consent = 'Please tick the box to continue.';
    return e;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault(); clearErr();
    const p = payload(), errs = validate(p);
    if (Object.keys(errs).length) return showErrors(errs);
    const rows = [['Name', p.name], ['Email', p.email], ['Phone', p.phone],
      p.method === 'delivery' ? ['Delivery to', [p.address.street, p.address.suburb, p.address.city, p.address.province, p.address.postal_code].join(', ')] : ['Collection from', $('#collection p:nth-child(2)').textContent.trim()]];
    if (p.method === 'delivery' && p.address.instructions.trim()) rows.push(['Instructions', p.address.instructions]);
    if (geo) rows.push(['Location', 'Shared with this order']);
    $('#review-body').innerHTML = `<dl class="contact-list">${rows.map(([k, v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><p class="muted">Total to pay: <strong>${money(sub + fee())}</strong> (subtotal ${money(sub)} + ${fee() ? 'delivery ' + money(fee()) : 'no delivery fee'}).</p>`;
    form.hidden = true; review.hidden = false; $('#pay-err').hidden = true; $('#review h2').scrollIntoView({ block: 'start' });
  });
  $('#edit').addEventListener('click', () => { review.hidden = true; form.hidden = false; });

  /* Create the order on our server (it re-prices everything), then show the customer the EFT details on the order page. */
  $('#pay').addEventListener('click', async () => {
    const btn = $('#pay'), err = $('#pay-err'); btn.disabled = true; err.hidden = true;
    try {
      const r = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
      const j = await r.json();
      if (!r.ok) { btn.disabled = false; return showErrors(j.errors || { form: j.error || 'Something went wrong.' }); }
      Cart.clear(); location.href = `/order/${encodeURIComponent(j.ref)}?t=${encodeURIComponent(j.token)}`;
    } catch { btn.disabled = false; err.textContent = 'Could not reach the server. Check your connection and try again.'; err.hidden = false; }
  });
})();
