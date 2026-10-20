// 貼り付けた文章を、ブラウザの中でPDFにする。保存する形式をPDFだけにそろえるため。
// 部品とフォント（合わせて約6MB）は、この機能を使った時にだけ読み込む。
(() => {
  const here = document.currentScript.src.replace(/[^/]*$/, '');
  let ready;

  function load(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`load failed: ${src}`));
      document.head.append(s);
    });
  }

  const bytesOf = (url) => fetch(url).then((r) => {
    if (!r.ok) throw new Error(`load failed: ${url}`);
    return r.arrayBuffer();
  });

  function prepare() {
    ready ||= Promise.all([
      load(`${here}vendor/pdf-lib.min.js`),
      load(`${here}vendor/fontkit.umd.min.js`),
      bytesOf(`${here}fonts/BIZUDGothic-Regular.ttf`),
      bytesOf(`${here}vendor/harfbuzz-subset.wasm`).then((w) => WebAssembly.instantiate(w)),
    ]).then(([, , font, { instance }]) => ({ font: new Uint8Array(font), hb: instance.exports }));
    return ready;
  }

  // フォントから、文章で使う字だけを取り出す（HarfBuzz）。
  // pdf-lib の subset: true はこのフォントで字形が欠けたので使わない
  function subsetFont(hb, font, text) {
    const mem = () => new Uint8Array(hb.memory.buffer);
    const ptr = hb.malloc(font.byteLength);
    mem().set(font, ptr);
    const blob = hb.hb_blob_create(ptr, font.byteLength, 2, 0, 0);
    const face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    const input = hb.hb_subset_input_create_or_fail();
    const set = hb.hb_subset_input_unicode_set(input);
    for (const ch of new Set(text)) hb.hb_set_add(set, ch.codePointAt(0));
    const sub = hb.hb_subset_or_fail(face, input);
    hb.hb_subset_input_destroy(input);
    if (!sub) {
      hb.hb_face_destroy(face);
      hb.free(ptr);
      throw new Error('subset failed');
    }
    const res = hb.hb_face_reference_blob(sub);
    const off = hb.hb_blob_get_data(res, 0);
    const out = mem().slice(off, off + hb.hb_blob_get_length(res));
    hb.hb_blob_destroy(res);
    hb.hb_face_destroy(sub);
    hb.hb_face_destroy(face);
    hb.free(ptr);
    return out;
  }

  // 英数字の並びは単語のまま、それ以外は1字ずつ折り返す
  function tokens(line) {
    return line.match(/[\x21-\x7E]+|\s|./gu) || [];
  }

  function wrap(line, font, size, width) {
    const out = [];
    let cur = '';
    let w = 0;
    for (const tok of tokens(line)) {
      const tw = font.widthOfTextAtSize(tok, size);
      if (w + tw <= width) {
        cur += tok;
        w += tw;
        continue;
      }
      if (cur.trim()) out.push(cur);
      cur = '';
      w = 0;
      if (tw <= width) {
        if (!/^\s$/.test(tok)) { cur = tok; w = tw; }
        continue;
      }
      for (const ch of tok) { // 1行に収まらない長い単語は字で切る
        const cw = font.widthOfTextAtSize(ch, size);
        if (w + cw > width) { out.push(cur); cur = ''; w = 0; }
        cur += ch;
        w += cw;
      }
    }
    out.push(cur);
    return out;
  }

  // 見出し（# で始まる行）は大きく、**太字** の記号は外す。それ以外の文はそのまま
  function parse(text) {
    return text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n').map((raw) => {
      const m = raw.match(/^(#{1,6})\s+(.*)$/);
      const body = (m ? m[2] : raw).replace(/\*\*(.+?)\*\*/g, '$1');
      return { text: body, size: m ? Math.max(12, 18 - m[1].length * 2) : 10.5 };
    });
  }

  window.textToPdf = async function textToPdf(text, meta) {
    const { font: fontBytes, hb } = await prepare();
    const blocks = parse(text);
    const used = blocks.map((b) => b.text).join('') + ' ';
    const { PDFDocument } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(window.fontkit);
    const font = await doc.embedFont(subsetFont(hb, fontBytes, used), { subset: false });
    doc.setTitle(meta.title || '');
    doc.setCreator(meta.creator || '');
    doc.setProducer(meta.creator || '');

    const W = 595.28;
    const H = 841.89;
    const M = 64;
    const width = W - M * 2;
    let page = doc.addPage([W, H]);
    let y = H - M;

    for (const block of blocks) {
      const lh = block.size * 1.7;
      const lines = block.text.trim() === '' ? [''] : wrap(block.text, font, block.size, width);
      for (const line of lines) {
        if (y - lh < M) {
          page = doc.addPage([W, H]);
          y = H - M;
        }
        y -= lh;
        if (line) page.drawText(line, { x: M, y, size: block.size, font });
      }
    }
    return doc.save();
  };

  window.prepareTextToPdf = prepare;
})();
