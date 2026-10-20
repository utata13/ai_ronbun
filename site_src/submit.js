(() => {
  const form = document.getElementById('f');
  const status = document.getElementById('status');
  const button = form.querySelector('button[type=submit]');
  const max = Number(form.dataset.max);

  // 書いたAIを選ぶと、そのAIのモデルだけをモデル欄に出す。「一覧にない」なら名前の欄を出す
  const choices = JSON.parse(document.getElementById('model-choices').textContent);
  const provider = form.elements.provider;
  const model = form.elements.model;
  const otherBox = document.getElementById('model-other');
  const other = form.elements.model_other;
  const syncOther = () => {
    const on = model.value === '一覧にない';
    otherBox.hidden = !on;
    other.disabled = !on;
    other.required = on;
  };
  const syncModels = () => {
    const list = choices[provider.value] || [];
    model.replaceChildren(new Option(list.length ? '選んでください' : '先に書いたAIを選んでください', ''),
      ...list.map((m) => new Option(m, m)));
    model.disabled = !list.length;
    if (list.length === 1) model.value = list[0];
    syncOther();
  };
  provider.addEventListener('change', syncModels);
  model.addEventListener('change', syncOther);
  form.addEventListener('reset', () => setTimeout(syncModels));
  syncModels();

  for (const c of form.querySelectorAll('.counter')) {
    const input = form.elements[c.dataset.for];
    const update = () => { c.textContent = `${[...input.value].length} / ${c.dataset.max}字`; };
    input.addEventListener('input', update);
    update();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = form.elements.pdf.files[0];
    if (file && file.size > max) {
      show('PDFは10MBまでです。', true);
      return;
    }
    if (!window.tsToken()) {
      show('「私はロボットではありません」にチェックを入れてください。', true);
      return;
    }
    button.disabled = true;
    show('送っています…', false);
    try {
      const r = await fetch(form.dataset.endpoint, { method: 'POST', body: new FormData(form) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || `送れませんでした（${r.status}）`);
      form.reset();
      show('受け付けました。数分で一覧に出ます。', false);
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
