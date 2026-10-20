(() => {
  const en = document.documentElement.lang === 'en';
  const MSG = en ? {
    robot: 'Please tick "I am not a robot" (the robot check).',
    sending: 'Sending…',
    failed: (s) => `Could not send (${s})`,
    done: 'Received. We will check it and respond.',
  } : {
    robot: '「私はロボットではありません」にチェックを入れてください。',
    sending: '送っています…',
    failed: (s) => `送れませんでした（${s}）`,
    done: '受け付けました。確認して対応します。',
  };
  const form = document.getElementById('r');
  const status = document.getElementById('status');
  const button = form.querySelector('button[type=submit]');

  // 論文のページから来た時は、その論文のURLを入れておく
  const id = new URLSearchParams(location.search).get('id');
  if (id) form.elements.paper.value = new URL(`p/${id}.html`, location.href).href;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.tsToken()) {
      show(MSG.robot, true);
      return;
    }
    button.disabled = true;
    show(MSG.sending, false);
    try {
      const r = await fetch(form.dataset.endpoint, { method: 'POST', body: new FormData(form) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || MSG.failed(r.status));
      form.reset();
      show(MSG.done, false);
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
