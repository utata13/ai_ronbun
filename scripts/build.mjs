// papers/<id>/{meta.json,paper.pdf} から公開用の静的サイトを作る。
// 使い方: node scripts/build.mjs --data <リポジトリの場所> --out <出力先> [--config config.dev.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROVIDERS, modelChoices, MAX_AUTHOR, MAX_PDF_BYTES, MAX_MODEL_OTHER, MAX_PURPOSE, MAX_COMMENT,
  MAX_REPORT_REASON, MAX_REPORT_CONTACT, DAILY_LIMIT,
} from '../shared/fields.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const dataDir = path.resolve(args.data || 'dev_repo');
const outDir = path.resolve(args.out || 'site');
const config = JSON.parse(fs.readFileSync(path.resolve(root, args.config || 'config.json'), 'utf8'));
const turnstileHead = (base) => `<script src="${base}turnstile.js"></script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
const turnstileBox = () => `<div class="cf-turnstile" data-sitekey="${esc(config.turnstile_sitekey)}" data-callback="tsOk" data-error-callback="tsError" data-expired-callback="tsExpired" data-language="ja"></div>`;

export function build() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'p'), { recursive: true });

  const papers = readPapers();
  for (const m of papers) {
    const dst = path.join(outDir, 'papers', m.id);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(dataDir, 'papers', m.id, 'paper.pdf'), path.join(dst, 'paper.pdf'));
    fs.writeFileSync(path.join(outDir, 'p', `${m.id}.html`), paperPage(m));
  }
  fs.writeFileSync(path.join(outDir, 'index.html'), indexPage(papers));
  fs.writeFileSync(path.join(outDir, 'submit.html'), submitPage());
  fs.writeFileSync(path.join(outDir, 'about.html'), aboutPage());
  fs.writeFileSync(path.join(outDir, 'report.html'), reportPage());
  fs.writeFileSync(path.join(outDir, '404.html'), notFoundPage());
  fs.copyFileSync(path.join(root, 'site_src', 'style.css'), path.join(outDir, 'style.css'));
  for (const f of ['submit.js', 'likes.js', 'report.js', 'turnstile.js']) fs.copyFileSync(path.join(root, 'site_src', f), path.join(outDir, f));
  // 検索エンジンには載せない。Xのカード（共有した時の表示）だけは読ませる
  fs.writeFileSync(path.join(outDir, 'robots.txt'), 'User-agent: Twitterbot\nAllow: /\n\nUser-agent: *\nDisallow: /\n');
  return papers.length;
}

function readPapers() {
  const dir = path.join(dataDir, 'papers');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((id) => fs.existsSync(path.join(dir, id, 'meta.json')) && fs.existsSync(path.join(dir, id, 'paper.pdf')))
    .map((id) => JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => ([...s].length > n ? `${[...s].slice(0, n).join('')}…` : s);

function dateJST(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

// モデル名がAIの名前で始まる時（Gemini 4 Argon など）は、AIの名前を重ねない
const modelLabel = (m) => {
  if (!m.model) return `${m.provider}（モデルはわからない）`;
  const brand = m.provider.split('（')[0];
  return m.model.startsWith(brand) ? m.model : `${m.provider} ${m.model}`;
};

// Xなどで共有した時に出る題名と説明
function ogp({ title, description, pagePath }) {
  const url = config.site_url ? `<meta property="og:url" content="${esc(config.site_url + pagePath)}">\n` : '';
  return `<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(config.site_title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${url}<meta name="twitter:card" content="summary">`;
}

function layout({ title, base, body, extraHead = '', share }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
${ogp(share || { title, description: 'AIに書かせた論文を、誰でも投稿して置いておける場所です。', pagePath: '' })}
<link rel="stylesheet" href="${base}style.css">
${extraHead}
</head>
<body data-api="${esc(config.api_base)}">
<header class="top">
  <a class="brand" href="${base}index.html">${esc(config.site_title)}</a>
  <a class="btn" href="${base}submit.html">投稿する</a>
</header>
<p class="notice">ここにある論文は、すべてAIが書いたものです。</p>
<main>
${body}
</main>
<footer class="foot">
  <a href="${base}about.html">このサイトについて</a>
  <a href="${base}report.html">削除依頼</a>
</footer>
<script src="${base}likes.js"></script>
</body>
</html>
`;
}

function indexPage(papers) {
  const items = papers.length
    ? papers.map((m) => `  <li class="card">
    <a href="p/${esc(m.id)}.html">
      <span class="purpose">${esc(m.purpose)}</span>
      <span class="meta">${esc(modelLabel(m))} ・ ${dateJST(m.created_at)}${m.author ? ` ・ ${esc(m.author)}` : ''}<span class="likes" data-id="${esc(m.id)}" hidden> ・ ♥ <span class="n">0</span></span></span>
      ${m.comment ? `<span class="comment">${esc(m.comment)}</span>` : ''}
    </a>
  </li>`).join('\n')
    : '  <li class="empty">まだ投稿はありません。</li>';
  return layout({
    title: config.site_title,
    base: '',
    body: `<p class="count">${papers.length}本</p>
<ul class="list">
${items}
</ul>`,
  });
}

function paperPage(m) {
  const pdf = `../papers/${esc(m.id)}/paper.pdf`;
  return layout({
    title: `${cut(m.purpose, 40)} — ${config.site_title}`,
    base: '../',
    share: {
      title: cut(m.purpose, 60),
      description: `${modelLabel(m)}が書いた論文${m.comment ? `。${m.comment}` : ''}`,
      pagePath: `p/${m.id}.html`,
    },
    body: `<article class="paper">
<p class="label">何を調べようとしたか</p>
<h1>${esc(m.purpose)}</h1>
<dl class="facts">
  <dt>書いたAI</dt><dd>${esc(modelLabel(m))}</dd>
  <dt>投稿日</dt><dd>${dateJST(m.created_at)}</dd>
  ${m.author ? `<dt>投稿者</dt><dd>${esc(m.author)} <span class="self">（投稿者が自分で入力したもの）</span></dd>` : ''}
  ${m.comment ? `<dt>投稿者の一言</dt><dd>${esc(m.comment)}</dd>` : ''}
</dl>
<p class="actions"><a class="btn" href="${pdf}">PDFを開く</a>
<button type="button" class="btn like" data-id="${esc(m.id)}" aria-pressed="false" disabled><span class="heart">♡</span> いいね <span class="n"></span></button></p>
<iframe class="pdf" src="${pdf}" title="論文のPDF"></iframe>
<p class="small"><a href="../report.html?id=${esc(m.id)}">この論文の削除を依頼する</a></p>
</article>`,
  });
}

function submitPage() {
  const opts = PROVIDERS.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const choices = Object.fromEntries(PROVIDERS.map((p) => [p, modelChoices(p)]));
  return layout({
    title: `投稿する — ${config.site_title}`,
    base: '',
    extraHead: turnstileHead(''),
    body: `<h1 class="h">投稿する</h1>
<p class="lead">AIに書かせた論文のPDFを投稿できます。投稿すると、誰でも読めるように公開されます。投稿する前に<a href="about.html">このサイトについて</a>を読んでください。</p>
<script type="application/json" id="model-choices">${JSON.stringify(choices).replace(/</g, '\\u003c')}</script>
<form id="f" class="form" data-endpoint="${esc(config.api_base)}/submit" data-max="${MAX_PDF_BYTES}">
  <label><span class="ttl">論文のPDF<span class="req">必須・10MBまで</span></span>
    <input type="file" name="pdf" accept="application/pdf,.pdf" required>
  </label>
  <label><span class="ttl">書いたAI<span class="req">必須</span></span>
    <select name="provider" required><option value="">選んでください</option>${opts}</select>
  </label>
  <label><span class="ttl">モデル<span class="req">必須</span></span>
    <select name="model" required disabled><option value="">先に書いたAIを選んでください</option></select>
  </label>
  <label id="model-other" hidden><span class="ttl">一覧にないモデルの名前<span class="req">必須</span></span>
    <input type="text" name="model_other" maxlength="${MAX_MODEL_OTHER}" disabled>
  </label>
  <label><span class="ttl">何を調べようとしたか<span class="req">必須</span></span>
    <textarea name="purpose" rows="4" maxlength="${MAX_PURPOSE}" required></textarea>
    <span class="counter" data-for="purpose" data-max="${MAX_PURPOSE}"></span>
  </label>
  <label><span class="ttl">一言<span class="opt">任意</span></span>
    <input type="text" name="comment" maxlength="${MAX_COMMENT}">
    <span class="counter" data-for="comment" data-max="${MAX_COMMENT}"></span>
  </label>
  <label><span class="ttl">投稿者<span class="opt">任意</span></span>
    <input type="text" name="author" maxlength="${MAX_AUTHOR}">
  </label>
  ${turnstileBox()}
  <button type="submit" class="btn primary">投稿する</button>
  <p id="status" class="status" role="status"></p>
</form>
<script src="submit.js"></script>`,
  });
}

function aboutPage() {
  return layout({
    title: `このサイトについて — ${config.site_title}`,
    base: '',
    body: `<article class="prose">
<h1 class="h">このサイトについて</h1>
<p>${esc(config.site_title)}は、AIに書かせた論文を誰でも投稿できる場所です。</p>
<p>気になっていたことをAIに調べさせて、論文の形で書かせたら、ここに置いてください。調べさせることは何でもかまいません。誰が書かせてもかまいません。</p>
<p>投稿に必要なのは、論文のPDF、書いたAIとモデル、何を調べようとしたか、の3つです。一言と投稿者は書いても書かなくてもかまいません。アカウント登録はいりません。</p>
<p>すぐに誰かに読まれなくてもかまいません。いつか誰かの役に立つかもしれません。</p>
<p>ここにある論文は、すべてAIが書いたものです。</p>

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
  <li>このサイトは、検索エンジンに載らない設定にしています。</li>
</ul>
</article>`,
  });
}

function reportPage() {
  return layout({
    title: `削除依頼 — ${config.site_title}`,
    base: '',
    extraHead: turnstileHead(''),
    body: `<h1 class="h">削除依頼</h1>
<p class="lead">消してほしい論文と、その理由を書いてください。書いた内容は公開されません。</p>
<form id="r" class="form" data-endpoint="${esc(config.api_base)}/report">
  <label><span class="ttl">論文のURL<span class="req">必須</span></span>
    <input type="text" name="paper" required placeholder="論文のページのURL">
  </label>
  <label><span class="ttl">理由<span class="req">必須</span></span>
    <textarea name="reason" rows="5" maxlength="${MAX_REPORT_REASON}" required></textarea>
  </label>
  <label><span class="ttl">連絡先<span class="opt">任意・返事が要るときだけ</span></span>
    <input type="text" name="contact" maxlength="${MAX_REPORT_CONTACT}">
  </label>
  ${turnstileBox()}
  <button type="submit" class="btn primary">送る</button>
  <p id="status" class="status" role="status"></p>
</form>
<script src="report.js"></script>`,
  });
}

function notFoundPage() {
  const base = config.base_path || '/';
  return layout({
    title: `ページが見つかりません — ${config.site_title}`,
    base,
    body: `<h1 class="h">ページが見つかりません</h1>
<p class="lead">消された論文か、URLが違っている可能性があります。</p>
<p><a class="btn" href="${base}index.html">一覧に戻る</a></p>`,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = build();
  console.log(`built ${n} papers -> ${outDir}`);
}
