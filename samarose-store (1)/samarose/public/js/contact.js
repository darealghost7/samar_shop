(() => {
  const form = document.getElementById('contact-form'), status = document.getElementById('contact-status');
  const show = (msg, bad) => { status.textContent = msg; status.className = 'notice' + (bad ? ' bad' : ''); status.hidden = false; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('.err').forEach((x) => (x.textContent = ''));
    form.querySelectorAll('[aria-invalid]').forEach((x) => x.removeAttribute('aria-invalid'));
    const d = Object.fromEntries(new FormData(form)), errs = {};
    if (d.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) errs.email = 'Please enter a valid email address.';
    if (d.phone.trim() && !/^\+?[0-9 ()-]{9,18}$/.test(d.phone.trim())) errs.phone = 'Please enter a valid phone number.';
    if (d.message.trim().length < 5) errs.message = 'Please write a message.';
    const fail = (er) => { for (const [k, m] of Object.entries(er)) { const s = form.querySelector(`[data-err="${k}"]`); if (s) s.textContent = m; form.elements[k]?.setAttribute('aria-invalid', 'true'); } form.querySelector('[aria-invalid]')?.focus(); show('Please fix the highlighted fields.', true); };
    if (Object.keys(errs).length) return fail(errs);
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const r = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      const j = await r.json();
      if (r.ok) { form.reset(); show('Thank you. Your message has been sent and we will reply soon.'); }
      else if (j.errors) fail(j.errors); else show(j.error || 'Something went wrong. Please try again.', true);
    } catch { show('Could not send your message. Check your connection and try again.', true); }
    btn.disabled = false;
  });
})();
