(() => {
  const form = document.getElementById('r');
  const status = document.getElementById('status');
  const button = form.querySelector('button[type=submit]');

  // 論文のページから来た時は、その論文のURLを入れておく
  const id = new URLSearchParams(location.search).get('id');
  if (id) form.elements.paper.value = new URL(`p/${id}.html`, location.href).href;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    show('送っています…', false);
    try {
      const r = await fetch(form.dataset.endpoint, { method: 'POST', body: new FormData(form) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `送れませんでした（${r.status}）`);
      form.reset();
      show('受け付けました。確認して対応します。', false);
    } catch (err) {
      show(err.message, true);
    } finally {
      button.disabled = false;
      if (window.turnstile) window.turnstile.reset();
    }
  });

  function show(msg, isError) {
    status.textContent = msg;
    status.classList.toggle('error', isError);
  }
})();
