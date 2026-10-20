// いいね。一覧では数だけ、論文のページでは押す・取り消すボタン
(() => {
  const api = document.body.dataset.api;

  const cards = document.querySelectorAll('.likes[data-id]');
  if (cards.length) {
    fetch(`${api}/likes`).then((r) => r.json()).then((counts) => {
      for (const el of cards) {
        const n = counts[el.dataset.id];
        if (n) {
          el.querySelector('.n').textContent = n;
          el.hidden = false;
        }
      }
    }).catch(() => {});
  }

  const btn = document.querySelector('button.like');
  if (!btn) return;
  const id = btn.dataset.id;
  const render = ({ count, liked }) => {
    btn.querySelector('.n').textContent = count;
    btn.querySelector('.heart').textContent = liked ? '♥' : '♡';
    btn.setAttribute('aria-pressed', String(liked));
    btn.disabled = false;
  };
  fetch(`${api}/likes?id=${encodeURIComponent(id)}`).then((r) => r.json()).then(render).catch(() => {});
  btn.addEventListener('click', async () => {
    const liked = btn.getAttribute('aria-pressed') !== 'true';
    btn.disabled = true;
    try {
      const r = await fetch(`${api}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, liked }),
      });
      if (!r.ok) throw new Error();
      render(await r.json());
    } catch {
      btn.disabled = false;
    }
  });
})();
