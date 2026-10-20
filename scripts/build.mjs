// papers/<id>/{meta.json,paper.pdf} から公開用の静的サイトを作る。日本語版はルート、英語版は en/ に置く。
// 使い方: node scripts/build.mjs --data <リポジトリの場所> --out <出力先> [--config config.dev.json]
//
// 検索エンジンに出すのは「トップ・このサイトについて・投稿」だけ。論文の一覧と論文のページは
// noindex, nofollow にして、AIの論文が検索結果で本物の研究と並ばないようにする。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  PROVIDERS, modelChoices, labelOf, MAX_AUTHOR, MAX_PDF_BYTES, MAX_MODEL_OTHER, MAX_PURPOSE, MAX_COMMENT,
  MAX_REPORT_REASON, MAX_REPORT_CONTACT, DAILY_LIMIT, MAX_PAPER_TEXT,
} from '../shared/fields.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const dataDir = path.resolve(args.data || 'dev_repo');
const outDir = path.resolve(args.out || 'site');
const config = JSON.parse(fs.readFileSync(path.resolve(root, args.config || 'config.json'), 'utf8'));
// Xのカード用の画像は作るのに時間がかかるので、一度作ったものはここに取っておく（Actions ではキャッシュする）
const ogCache = path.resolve(args['og-cache'] || path.join(root, '.og-cache'));

const LANGS = ['ja', 'en'];
const dirOf = (lang) => (lang === 'en' ? 'en/' : '');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const cut = (s, n) => ([...s].length > n ? `${[...s].slice(0, n).join('')}…` : s);
const jstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000);

const T = {
  ja: {
    title: config.site_title,
    notice: 'ここにある論文は、すべてAIが書いたものです。',
    description: 'AIに書かせた論文を、誰でも投稿して置いておける場所です。',
    switchTo: 'English',
    papers: '論文を見る',
    submit: '投稿する',
    about: 'このサイトについて',
    report: '削除依頼',
    count: (n) => `${n}本`,
    paren: (s) => `（${s}）`,
    empty: 'まだ投稿はありません。',
    intro: [
      `${config.site_title}は、AIに書かせた論文を誰でも投稿できる場所です。`,
      '気になっていたことをAIに調べさせて、論文の形で書かせたら、ここに置いてください。調べさせることは何でもかまいません。誰が書かせてもかまいません。',
      '投稿に必要なのは、論文のPDF、書いたAIとモデル、何を調べようとしたか、の3つです。一言と投稿者は書いても書かなくてもかまいません。アカウント登録はいりません。',
      'すぐに誰かに読まれなくてもかまいません。いつか誰かの役に立つかもしれません。',
      'ここにある論文は、すべてAIが書いたものです。',
    ],
    date: (iso) => {
      const d = jstDate(iso);
      return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
    },
    modelUnknown: (p) => `${p}（モデルはわからない）`,
    paper: {
      purpose: '何を調べようとしたか',
      writer: '書いたAI',
      posted: '投稿日',
      author: '投稿者',
      self: '（投稿者が自分で入力したもの）',
      comment: '投稿者の一言',
      open: 'PDFを開く',
      like: 'いいね',
      pdf: '論文のPDF',
      remove: 'この論文の削除を依頼する',
      share: (label, comment) => `${label}が書いた論文${comment ? `。${comment}` : ''}`,
      fromText: '形式', fromTextValue: '貼り付けた文章からPDFにしたもの',
    },
    form: {
      lead: 'AIに書かせた論文のPDFを投稿できます。投稿すると、誰でも読めるように公開されます。投稿する前に<a href="about.html">このサイトについて</a>を読んでください。',
      pdf: '論文のPDF', pdfNote: '必須・10MBまで',
      provider: '書いたAI', model: 'モデル', modelOther: '一覧にないモデルの名前',
      purpose: '何を調べようとしたか', comment: '一言', author: '投稿者',
      required: '必須', optional: '任意',
      choose: '選んでください', chooseFirst: '先に書いたAIを選んでください',
      send: '投稿する',
      paper: '論文', modePdf: 'PDFを添付する', modeText: '文章を貼り付ける',
      text: '論文の文章', textNote: '必須・送る前にPDFにします。図や表は入りません',
    },
    reportForm: {
      lead: '消してほしい論文と、その理由を書いてください。書いた内容は公開されません。',
      paper: '論文のURL', paperPlaceholder: '論文のページのURL',
      reason: '理由', contact: '連絡先', contactNote: '任意・返事が要るときだけ',
      required: '必須', send: '送る',
    },
    notFound: { title: 'ページが見つかりません', lead: '消された論文か、URLが違っている可能性があります。', back: 'トップに戻る' },
    aboutBody: `<p>${esc(config.site_title)}は、AIに書かせた論文を、誰でも投稿して置いておける場所です。アカウント登録はいりません。</p>

<h2>投稿について</h2>
<ul>
  <li>投稿したPDFと、入力した項目（書いたAIとモデル・何を調べようとしたか・一言・投稿者）は、誰でも読めるように公開されます。投稿した日付も表示されます。</li>
  <li>投稿したあとで、自分で消すことはできません。消したいときは<a href="report.html">削除依頼</a>から知らせてください。</li>
  <li>投稿できるのは、1日に${DAILY_LIMIT}本までです。</li>
</ul>

<h2>投稿してはいけないもの</h2>
<ul>
  <li>他人の個人情報が書かれたもの</li>
  <li>他人を傷つける内容</li>
  <li>他人が書いた文章や論文を写したもの</li>
  <li>法律に反するもの</li>
</ul>
<p>見つけたものは、予告なく消します。</p>

<h2>保存するもの</h2>
<ul>
  <li>投稿されたPDFと、入力された項目。これらは公開されます。</li>
  <li>送信元のIPアドレスは、そのままの形では保存しません。元に戻せない値に変換して、1日の投稿数の制限（2日で消えます）と、いいねを同じ回線から1回までにすることだけに使います。</li>
  <li>削除依頼で書かれた内容は公開しません。</li>
</ul>

<h2>そのほか</h2>
<ul>
  <li>ロボットによる大量の投稿を防ぐために、Cloudflare Turnstile を使っています。</li>
  <li>論文の一覧と論文のページは、検索エンジンに載らない設定にしています。</li>
</ul>`,
  },
  en: {
    title: config.site_title_en,
    notice: 'Every paper here was written by AI.',
    description: 'A place where anyone can post papers written by AI.',
    switchTo: '日本語',
    papers: 'Browse papers',
    submit: 'Post a paper',
    about: 'About',
    report: 'Removal request',
    count: (n) => `${n} ${n === 1 ? 'paper' : 'papers'}`,
    paren: (s) => ` (${s})`,
    empty: 'No papers yet.',
    intro: [
      `${config.site_title_en} is a place where anyone can post papers written by AI.`,
      'If you had an AI look into something you were curious about and write it up as a paper, please put it here. It can be about anything. It does not matter who had the AI write it.',
      'To post, you need three things: the PDF of the paper, the AI and model that wrote it, and what you wanted to find out. A comment and a poster name are optional. No account is needed.',
      'It is fine if no one reads it right away. Someday it may be useful to someone.',
      'Every paper here was written by AI.',
    ],
    date: (iso) => {
      const d = jstDate(iso);
      const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
      return `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
    },
    modelUnknown: (p) => `${p} (model unknown)`,
    paper: {
      purpose: 'What the poster wanted to find out',
      writer: 'Written by',
      posted: 'Posted',
      author: 'Poster',
      self: '(as entered by the poster)',
      comment: "Poster's comment",
      open: 'Open PDF',
      like: 'Like',
      pdf: 'PDF of the paper',
      remove: 'Request removal of this paper',
      share: (label, comment) => `A paper written by ${label}${comment ? `. ${comment}` : ''}`,
      fromText: 'Format', fromTextValue: 'Made into a PDF from pasted text',
    },
    form: {
      lead: 'You can post the PDF of a paper written by AI. Once posted, it is published for anyone to read. Please read <a href="about.html">About</a> before posting.',
      pdf: 'PDF of the paper', pdfNote: 'Required, up to 10 MB',
      provider: 'AI that wrote it', model: 'Model', modelOther: 'Name of the model',
      purpose: 'What you wanted to find out', comment: 'Comment', author: 'Poster',
      required: 'Required', optional: 'Optional',
      choose: 'Choose one', chooseFirst: 'Choose the AI first',
      send: 'Post',
      paper: 'Paper', modePdf: 'Attach a PDF', modeText: 'Paste the text',
      text: 'Text of the paper', textNote: 'Required. It is turned into a PDF before sending. Figures and tables are not included',
    },
    reportForm: {
      lead: 'Tell us which paper you want removed and why. What you write here is not published.',
      paper: 'URL of the paper', paperPlaceholder: "URL of the paper's page",
      reason: 'Reason', contact: 'Contact', contactNote: 'Optional, only if you need a reply',
      required: 'Required', send: 'Send',
    },
    notFound: { title: 'Page not found', lead: 'The paper may have been removed, or the URL may be wrong.', back: 'Back to top' },
    aboutBody: `<p>${esc(config.site_title_en)} is a place where anyone can post and keep papers written by AI. No account is needed.</p>

<h2>Posting</h2>
<ul>
  <li>The PDF you post and the fields you fill in (the AI and model, what you wanted to find out, comment, poster) are published for anyone to read. The date of posting is also shown.</li>
  <li>You cannot delete a paper yourself after posting it. If you want it removed, let us know through the <a href="report.html">removal request</a> form.</li>
  <li>You can post up to ${DAILY_LIMIT} papers a day.</li>
</ul>

<h2>Do not post</h2>
<ul>
  <li>Anything containing someone else's personal information</li>
  <li>Anything that hurts others</li>
  <li>Copies of text or papers written by someone else</li>
  <li>Anything illegal</li>
</ul>
<p>We remove such posts without notice.</p>

<h2>What we store</h2>
<ul>
  <li>The posted PDF and the fields entered. These are published.</li>
  <li>We do not store your IP address as it is. We convert it into a value that cannot be turned back, and use it only to limit posts per day (deleted after 2 days) and to allow one like per network connection.</li>
  <li>Removal requests are not published.</li>
</ul>

<h2>Other</h2>
<ul>
  <li>We use Cloudflare Turnstile to prevent mass posting by robots.</li>
  <li>The list of papers and the paper pages are set not to appear in search engines.</li>
</ul>`,
  },
};

export function build() {
  fs.rmSync(outDir, { recursive: true, force: true });
  const papers = readPapers();

  for (const m of papers) {
    const dst = path.join(outDir, 'papers', m.id);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(dataDir, 'papers', m.id, 'paper.pdf'), path.join(dst, 'paper.pdf'));
    m.og = ogImage(m);
  }
  for (const lang of LANGS) {
    const write = (rel, html) => {
      const file = path.join(outDir, dirOf(lang), rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, html);
    };
    for (const m of papers) write(`p/${m.id}.html`, paperPage(lang, m));
    write('index.html', topPage(lang, papers.length));
    write('list.html', listPage(lang, papers));
    write('submit.html', submitPage(lang));
    write('about.html', aboutPage(lang));
    write('report.html', reportPage(lang));
  }
  fs.writeFileSync(path.join(outDir, '404.html'), notFoundPage());
  fs.copyFileSync(path.join(root, 'site_src', 'style.css'), path.join(outDir, 'style.css'));
  for (const f of ['submit.js', 'likes.js', 'report.js', 'turnstile.js', 'paste-pdf.js']) fs.copyFileSync(path.join(root, 'site_src', f), path.join(outDir, f));
  for (const d of ['vendor', 'fonts']) fs.cpSync(path.join(root, 'site_src', d), path.join(outDir, d), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  return papers.length;
}

// 論文の1ページ目を、横1200で上から630の高さに切り抜いた画像にする（Xの大きいカードの比率）。
// 作れなかった時は画像なしのカードにする
function ogImage(m) {
  const cached = path.join(ogCache, `${m.id}.png`);
  try {
    if (!fs.existsSync(cached)) {
      fs.mkdirSync(ogCache, { recursive: true });
      execFileSync('pdftoppm', [
        '-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to-x', '1200', '-scale-to-y', '-1',
        '-x', '0', '-y', '0', '-W', '1200', '-H', '630',
        path.join(dataDir, 'papers', m.id, 'paper.pdf'), cached.replace(/\.png$/, ''),
      ], { timeout: 30000, stdio: 'ignore' });
    }
    fs.mkdirSync(path.join(outDir, 'og'), { recursive: true });
    fs.copyFileSync(cached, path.join(outDir, 'og', `${m.id}.png`));
    return true;
  } catch {
    return false;
  }
}

function readPapers() {
  const dir = path.join(dataDir, 'papers');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((id) => fs.existsSync(path.join(dir, id, 'meta.json')) && fs.existsSync(path.join(dir, id, 'paper.pdf')))
    .map((id) => JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// モデル名がAIの名前で始まる時（Gemini 4 Argon など）は、AIの名前を重ねない
function modelLabel(m, lang) {
  const provider = labelOf(m.provider, lang);
  if (!m.model) return T[lang].modelUnknown(provider);
  const brand = m.provider.split('（')[0];
  return m.model.startsWith(brand) ? m.model : `${provider} ${m.model}`;
}

// rel は言語の中でのページの場所（例: p/xxx.html）
function layout({ lang, rel, title, body, indexable = false, share, extraHead = '', notice = true }) {
  const t = T[lang];
  const up = '../'.repeat(rel.split('/').length - 1); // 言語のルートまで
  const base = up + (lang === 'en' ? '../' : '');     // サイトのルートまで
  const other = lang === 'en' ? 'ja' : 'en';
  const pageUrl = (l) => config.site_url + dirOf(l) + rel.replace(/index\.html$/, '');
  const head = [
    indexable ? '' : '<meta name="robots" content="noindex, nofollow">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc((share || {}).description || t.description)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${esc(t.title)}">`,
    `<meta property="og:title" content="${esc((share || {}).title || title)}">`,
    `<meta property="og:description" content="${esc((share || {}).description || t.description)}">`,
    config.site_url ? `<meta property="og:url" content="${esc(pageUrl(lang))}">` : '',
    (share || {}).image && config.site_url ? `<meta property="og:image" content="${esc(config.site_url + share.image)}">` : '',
    `<meta name="twitter:card" content="${(share || {}).image && config.site_url ? 'summary_large_image' : 'summary'}">`,
    ...(indexable && config.site_url ? LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(pageUrl(l))}">`) : []),
    `<link rel="stylesheet" href="${base}style.css">`,
    extraHead,
  ].filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
</head>
<body data-api="${esc(config.api_base)}">
<header class="top">
  <a class="brand" href="${up}index.html">${esc(t.title)}</a>
  <nav class="nav">
    <a href="${up}list.html">${t.papers}</a>
    <a class="btn" href="${up}submit.html">${t.submit}</a>
    <a class="lang" href="${base}${dirOf(other)}${rel}" hreflang="${other}" lang="${other}">${t.switchTo}</a>
  </nav>
</header>
${notice ? `<p class="notice">${t.notice}</p>\n` : ''}<main>
${body}
</main>
<footer class="foot">
  <a href="${up}about.html">${t.about}</a>
  <a href="${up}report.html">${t.report}</a>
</footer>
<script src="${base}likes.js"></script>
</body>
</html>
`;
}

function topPage(lang, n) {
  const t = T[lang];
  return layout({
    lang,
    rel: 'index.html',
    title: t.title,
    indexable: true,
    notice: false,
    body: `<section class="hero">
<h1 class="h">${esc(t.title)}</h1>
${t.intro.map((p) => `<p>${esc(p)}</p>`).join('\n')}
<p class="actions"><a class="btn primary" href="list.html">${t.papers}${t.paren(t.count(n))}</a>
<a class="btn" href="submit.html">${t.submit}</a></p>
</section>`,
  });
}

function listPage(lang, papers) {
  const t = T[lang];
  const items = papers.length
    ? papers.map((m) => `  <li class="card">
    <a href="p/${esc(m.id)}.html">
      <span class="purpose">${esc(m.purpose)}</span>
      <span class="meta">${esc(modelLabel(m, lang))} ・ ${t.date(m.created_at)}${m.author ? ` ・ ${esc(m.author)}` : ''}<span class="likes" data-id="${esc(m.id)}" hidden> ・ ♥ <span class="n">0</span></span></span>
      ${m.comment ? `<span class="comment">${esc(m.comment)}</span>` : ''}
    </a>
  </li>`).join('\n')
    : `  <li class="empty">${t.empty}</li>`;
  return layout({
    lang,
    rel: 'list.html',
    title: `${t.papers} — ${t.title}`,
    body: `<p class="count">${t.count(papers.length)}</p>
<ul class="list">
${items}
</ul>`,
  });
}

function paperPage(lang, m) {
  const t = T[lang];
  const p = t.paper;
  const pdf = `${lang === 'en' ? '../../' : '../'}papers/${esc(m.id)}/paper.pdf`;
  const label = modelLabel(m, lang);
  return layout({
    lang,
    rel: `p/${m.id}.html`,
    title: `${cut(m.purpose, 40)} — ${t.title}`,
    share: { title: cut(m.purpose, 60), description: p.share(label, m.comment), image: m.og ? `og/${m.id}.png` : '' },
    body: `<article class="paper">
<p class="label">${p.purpose}</p>
<h1>${esc(m.purpose)}</h1>
<dl class="facts">
  <dt>${p.writer}</dt><dd>${esc(label)}</dd>
  <dt>${p.posted}</dt><dd>${t.date(m.created_at)}</dd>
  ${m.author ? `<dt>${p.author}</dt><dd>${esc(m.author)} <span class="self">${p.self}</span></dd>` : ''}
  ${m.comment ? `<dt>${p.comment}</dt><dd>${esc(m.comment)}</dd>` : ''}
  ${m.made_from_text ? `<dt>${p.fromText}</dt><dd>${p.fromTextValue}</dd>` : ''}
</dl>
<p class="actions"><a class="btn" href="${pdf}">${p.open}</a>
<button type="button" class="btn like" data-id="${esc(m.id)}" aria-pressed="false" disabled><span class="heart">♡</span> ${p.like} <span class="n"></span></button></p>
<iframe class="pdf" src="${pdf}" title="${p.pdf}"></iframe>
<p class="small"><a href="../report.html?id=${esc(m.id)}">${p.remove}</a></p>
</article>`,
  });
}

const assetBase = (lang) => (lang === 'en' ? '../' : '');
const turnstileHead = (lang) => `<script src="${assetBase(lang)}turnstile.js"></script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
const turnstileBox = (lang) => `<div class="cf-turnstile" data-sitekey="${esc(config.turnstile_sitekey)}" data-callback="tsOk" data-error-callback="tsError" data-expired-callback="tsExpired" data-language="${lang}"></div>`;
const endpoint = (lang, name) => `${config.api_base}/${name}${lang === 'en' ? '?lang=en' : ''}`;
const ttl = (text, note, cls) => `<span class="ttl">${text}<span class="${cls}">${note}</span></span>`;

function submitPage(lang) {
  const t = T[lang];
  const f = t.form;
  const opts = PROVIDERS.map((p) => `<option value="${esc(p)}">${esc(labelOf(p, lang))}</option>`).join('');
  const choices = Object.fromEntries(PROVIDERS.map((p) => [p, modelChoices(p).map((m) => [m, labelOf(m, lang)])]));
  const data = JSON.stringify({ choices, choose: f.choose, chooseFirst: f.chooseFirst, creator: t.title }).replace(/</g, '\\u003c');
  return layout({
    lang,
    rel: 'submit.html',
    title: `${t.submit} — ${t.title}`,
    indexable: true,
    extraHead: turnstileHead(lang),
    body: `<h1 class="h">${t.submit}</h1>
<p class="lead">${f.lead}</p>
<script type="application/json" id="model-choices">${data}</script>
<form id="f" class="form" data-endpoint="${esc(endpoint(lang, 'submit'))}" data-max="${MAX_PDF_BYTES}">
  <fieldset class="mode">
    <legend>${f.paper}</legend>
    <label class="radio"><input type="radio" name="mode" value="pdf" checked> ${f.modePdf}</label>
    <label class="radio"><input type="radio" name="mode" value="text"> ${f.modeText}</label>
  </fieldset>
  <label id="pdf-box">${ttl(f.pdf, f.pdfNote, 'req')}
    <input type="file" name="pdf" accept="application/pdf,.pdf" required>
  </label>
  <label id="text-box" hidden>${ttl(f.text, f.textNote, 'req')}
    <textarea name="paper_text" rows="14" maxlength="${MAX_PAPER_TEXT}" disabled></textarea>
    <span class="counter" data-for="paper_text" data-max="${MAX_PAPER_TEXT}"></span>
  </label>
  <label>${ttl(f.provider, f.required, 'req')}
    <select name="provider" required><option value="">${f.choose}</option>${opts}</select>
  </label>
  <label>${ttl(f.model, f.required, 'req')}
    <select name="model" required disabled><option value="">${f.chooseFirst}</option></select>
  </label>
  <label id="model-other" hidden>${ttl(f.modelOther, f.required, 'req')}
    <input type="text" name="model_other" maxlength="${MAX_MODEL_OTHER}" disabled>
  </label>
  <label>${ttl(f.purpose, f.required, 'req')}
    <textarea name="purpose" rows="4" maxlength="${MAX_PURPOSE}" required></textarea>
    <span class="counter" data-for="purpose" data-max="${MAX_PURPOSE}"></span>
  </label>
  <label>${ttl(f.comment, f.optional, 'opt')}
    <input type="text" name="comment" maxlength="${MAX_COMMENT}">
    <span class="counter" data-for="comment" data-max="${MAX_COMMENT}"></span>
  </label>
  <label>${ttl(f.author, f.optional, 'opt')}
    <input type="text" name="author" maxlength="${MAX_AUTHOR}">
  </label>
  ${turnstileBox(lang)}
  <button type="submit" class="btn primary">${f.send}</button>
  <p id="status" class="status" role="status"></p>
</form>
<script src="${assetBase(lang)}paste-pdf.js"></script>
<script src="${assetBase(lang)}submit.js"></script>`,
  });
}

function aboutPage(lang) {
  const t = T[lang];
  return layout({
    lang,
    rel: 'about.html',
    title: `${t.about} — ${t.title}`,
    indexable: true,
    body: `<article class="prose">
<h1 class="h">${t.about}</h1>
${t.aboutBody}
</article>`,
  });
}

function reportPage(lang) {
  const t = T[lang];
  const r = t.reportForm;
  return layout({
    lang,
    rel: 'report.html',
    title: `${t.report} — ${t.title}`,
    extraHead: turnstileHead(lang),
    body: `<h1 class="h">${t.report}</h1>
<p class="lead">${r.lead}</p>
<form id="r" class="form" data-endpoint="${esc(endpoint(lang, 'report'))}">
  <label>${ttl(r.paper, r.required, 'req')}
    <input type="text" name="paper" required placeholder="${r.paperPlaceholder}">
  </label>
  <label>${ttl(r.reason, r.required, 'req')}
    <textarea name="reason" rows="5" maxlength="${MAX_REPORT_REASON}" required></textarea>
  </label>
  <label>${ttl(r.contact, r.contactNote, 'opt')}
    <input type="text" name="contact" maxlength="${MAX_REPORT_CONTACT}">
  </label>
  ${turnstileBox(lang)}
  <button type="submit" class="btn primary">${r.send}</button>
  <p id="status" class="status" role="status"></p>
</form>
<script src="${assetBase(lang)}report.js"></script>`,
  });
}

// 404 はサイトに1枚だけなので、両方の言語で書く
function notFoundPage() {
  const b = config.base_path || '/';
  const ja = T.ja.notFound;
  const en = T.en.notFound;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${ja.title} / ${en.title}</title>
<link rel="stylesheet" href="${b}style.css">
</head>
<body>
<header class="top"><a class="brand" href="${b}index.html">${esc(T.ja.title)}</a></header>
<main>
<h1 class="h">${ja.title}</h1>
<p class="lead">${ja.lead}</p>
<p><a class="btn" href="${b}index.html">${ja.back}</a></p>
<h1 class="h" lang="en">${en.title}</h1>
<p class="lead" lang="en">${en.lead}</p>
<p lang="en"><a class="btn" href="${b}en/index.html">${en.back}</a></p>
</main>
</body>
</html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = build();
  console.log(`built ${n} papers -> ${outDir}`);
}
