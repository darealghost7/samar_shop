document.getElementById('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err'), btn = e.target.querySelector('button'); err.hidden = true; btn.disabled = true;
  try {
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e.target.email.value, password: e.target.pw.value }) });
    const j = await r.json();
    if (r.ok) return (location.href = '/admin');
    err.textContent = j.error || 'Could not sign in.'; err.hidden = false;
  } catch { err.textContent = 'Could not reach the server.'; err.hidden = false; }
  btn.disabled = false;
});
