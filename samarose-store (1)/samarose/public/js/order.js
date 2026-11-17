(async () => {
  const { $, esc, money, config } = SR;
  const root = $('#order'); if (!root) return;
  const ref = decodeURIComponent(location.pathname.split('/').pop()), t = new URLSearchParams(location.search).get('t') || '';
  const cfg = await config().catch(() => ({}));
  const r = await fetch(`/api/orders/${encodeURIComponent(ref)}?t=${encodeURIComponent(t)}`).catch(() => null);
  if (!r || !r.ok) { root.innerHTML = '<p class="notice bad">We could not find that order. Check the link in your confirmation email.</p>'; return; }
  const o = await r.json(), b = o.bank || {};
  const paid = o.payment_status === 'paid', cancelled = o.status === 'Cancelled';
  const msg = paid ? ['Thank you, your payment was received.', ''] : cancelled ? ['This order was cancelled.', 'bad'] : ['Your order is placed. Please pay by EFT using the details below. We prepare it once your payment reflects in our account.', ''];
  const row = ([k, v]) => `<div class="kv"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  const addr = o.method === 'delivery' ? [o.street, o.suburb, o.city, o.province, o.postal_code].filter(Boolean).join(', ') : 'Collect from the shop';
  const when = new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-ZA');
  const bank = [['Bank', b.name], ['Account holder', b.holder], ['Account number', b.number], ['Branch code', b.branch], ['Account type', b.type], ['Amount to pay', money(o.total_cents)], ['Payment reference', o.ref]].filter(([, v]) => v);
  const proofLinks = [cfg.whatsapp ? `<a class="btn" href="https://wa.me/${esc(cfg.whatsapp)}?text=${encodeURIComponent('Hi, here is my proof of payment for order ' + o.ref)}" rel="noopener">Send proof on WhatsApp</a>` : '', b.email ? `<a class="btn btn-ghost" href="mailto:${esc(b.email)}?subject=${encodeURIComponent('Proof of payment ' + o.ref)}">Email proof of payment</a>` : ''].join('');
  root.innerHTML = `<p class="notice ${msg[1]}">${esc(msg[0])}</p>
    ${!paid && !cancelled ? `<div class="panel"><p class="kvl">Pay by EFT</p><dl class="contact-list">${bank.map(([k, v]) => row([k, esc(v)])).join('')}</dl>
      <p class="muted"><strong>Use ${esc(o.ref)} as your payment reference</strong> so we can match your payment.${b.note ? ' ' + esc(b.note) : ''}</p><div class="actions">${proofLinks}</div></div>` : ''}
    <div class="order-box"><dl class="contact-list">${[['Order number', esc(o.ref)], ['Placed', esc(when)], ['Order status', `<span class="badge">${esc(o.status)}</span>`], [o.method === 'delivery' ? 'Delivery to' : 'Collection', esc(addr)]].map(row).join('')}</dl>
    ${o.items.map((i) => `<div class="sline"><span>${i.qty} &times; ${esc(i.name)}${i.size ? `<small>${esc(i.size)}</small>` : ''}</span><span>${money(i.qty * i.unit_price_cents)}</span></div>`).join('')}
    <div class="tot"><span>Subtotal</span><span>${money(o.subtotal_cents)}</span></div>
    <div class="tot"><span>Delivery fee</span><span>${o.delivery_fee_cents ? money(o.delivery_fee_cents) : 'Free'}</span></div>
    <div class="tot big"><span>Total</span><span>${money(o.total_cents)}</span></div>
    <div class="actions"><a class="btn btn-ghost" href="/shop">Continue shopping</a></div></div>`;
})();
