(() => {
  const en = document.documentElement.lang === 'en';
  const MSG = en ? {
    pdfSize: 'The PDF must be 10 MB or smaller.',
    robot: 'Please tick "I am not a robot" (the robot check).',
    sending: 'Sending…',
    failed: (s) => `Could not send (${s})`,
    done: 'Received. It will appear in the list in a few minutes.',
    chars: ' chars',
    making: 'Turning the text into a PDF…',
    makeFailed: 'Could not turn the text into a PDF. Please reload the page and try again.',
  } : {
    pdfSize: 'PDFは10MBまでです。',
    robot: '「私はロボットではありません」にチェックを入れてください。',
    sending: '送っています…',
    failed: (s) => `送れませんでした（${s}）`,
    done: '受け付けました。数分で一覧に出ます。',
    chars: '字',
    making: '文章をPDFにしています…',
    makeFailed: '文章をPDFにできませんでした。ページを読み込み直して、もう一度試してください。',
  };
  const form = document.getElementById('f');
  const status = document.getElementById('status');
  const button = form.querySelector('button[type=submit]');
  const max = Number(form.dataset.max);

  // 書いたAIを選ぶと、そのAIのモデルだけをモデル欄に出す。「一覧にない」なら名前の欄を出す
  // choices[AI] は [保存する値, 画面に出す名前] の並び
  const { choices, choose, chooseFirst, creator } = JSON.parse(document.getElementById('model-choices').textContent);
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

  // 「PDFを添付する」と「文章を貼り付ける」の切り替え。送るのはどちらもPDF
  const pdfBox = document.getElementById('pdf-box');
  const textBox = document.getElementById('text-box');
  const pdfInput = form.elements.pdf;
  const textInput = form.elements.paper_text;
  const textMode = () => form.elements.mode.value === 'text';
  const syncMode = () => {
    const t = textMode();
    pdfBox.hidden = t;
    pdfInput.disabled = t;
    pdfInput.required = !t;
    textBox.hidden = !t;
    textInput.disabled = !t;
    textInput.required = t;
    if (t && window.prepareTextToPdf) window.prepareTextToPdf().catch(() => {}); // 先に読み込み始めておく
  };
  for (const r of form.elements.mode) r.addEventListener('change', syncMode);
  form.addEventListener('reset', () => setTimeout(syncMode));
  syncMode();

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
    try {
      const body = new FormData(form);
      body.delete('mode');
      body.delete('paper_text');
      if (textMode()) {
        show(MSG.making, false);
        let bytes;
        try {
          bytes = await window.textToPdf(textInput.value, { title: form.elements.purpose.value, creator });
        } catch {
          throw new Error(MSG.makeFailed);
        }
        if (bytes.length > max) throw new Error(MSG.pdfSize);
        body.set('pdf', new File([bytes], 'paper.pdf', { type: 'application/pdf' }));
        body.set('made_from_text', '1');
      }
      show(MSG.sending, false);
      const r = await fetch(form.dataset.endpoint, { method: 'POST', body });
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
