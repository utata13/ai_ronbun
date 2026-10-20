(() => {
  const en = document.documentElement.lang === 'en';
  const MSG = en ? {
    pdfSize: 'The PDF must be 10 MB or smaller.',
    robot: 'Please tick "I am not a robot" (the robot check).',
    sending: 'Sending…',
    failed: (s) => `Could not send (${s})`,
    done: 'Received. It will appear in the list in a few minutes.',
    chars: ' chars',
  } : {
    pdfSize: 'PDFは10MBまでです。',
    robot: '「私はロボットではありません」にチェックを入れてください。',
    sending: '送っています…',
    failed: (s) => `送れませんでした（${s}）`,
    done: '受け付けました。数分で一覧に出ます。',
    chars: '字',
  };
  const form = document.getElementById('f');
  const status = document.getElementById('status');
  const button = form.querySelector('button[type=submit]');
  const max = Number(form.dataset.max);

  // 書いたAIを選ぶと、そのAIのモデルだけをモデル欄に出す。「一覧にない」なら名前の欄を出す
  // choices[AI] は [保存する値, 画面に出す名前] の並び
  const { choices, choose, chooseFirst } = JSON.parse(document.getElementById('model-choices').textContent);
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
    model.replaceChildren(new Option(list.length ? choose : chooseFirst, ''),
      ...list.map(([value, label]) => new Option(label, value)));
    model.disabled = !list.length;
    if (list.length === 1) model.value = list[0][0];
    syncOther();
  };
  provider.addEventListener('change', syncModels);
  model.addEventListener('change', syncOther);
  form.addEventListener('reset', () => setTimeout(syncModels));
  syncModels();

  for (const c of form.querySelectorAll('.counter')) {
    const input = form.elements[c.dataset.for];
    const update = () => { c.textContent = `${[...input.value].length} / ${c.dataset.max}${MSG.chars}`; };
    input.addEventListener('input', update);
    update();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = form.elements.pdf.files[0];
    if (file && file.size > max) {
      show(MSG.pdfSize, true);
      return;
    }
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
