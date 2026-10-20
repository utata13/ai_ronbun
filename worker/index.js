// 受付窓口。
// /api/submit: フォームから来たPDFと項目を確かめて、GitHubのリポジトリに書き込む。
//   サイトの公開はリポジトリ側（GitHub Actions → Pages）が行うので、ここでは書き込みまで。
// /api/report: 削除依頼。公開しないので、非公開の別リポジトリ（REPORT_REPO）に Issue として届ける。
//   GitHub の通知で運営者に知らせが行く。
// /api/likes, /api/like: いいねの数を D1 に記録する。アカウントがないので、同じ回線（IP）から1論文に1回まで。
import { Buffer } from 'node:buffer';
import {
  PROVIDERS, MODEL_NOT_LISTED, MODEL_UNKNOWN, modelChoices,
  MAX_PDF_BYTES, MAX_MODEL_OTHER, MAX_PURPOSE, MAX_COMMENT, DAILY_LIMIT, MAX_AUTHOR,
  MAX_REPORT_REASON, MAX_REPORT_CONTACT,
} from '../shared/fields.js';

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.SITE_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ja';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'POST' && req.headers.get('Origin') !== env.SITE_ORIGIN) {
      return fail(lang, 'origin', 403, cors);
    }
    try {
      if (route === 'POST /api/submit') return await submit(req, env, cors, lang);
      if (route === 'POST /api/report') return await report(req, env, cors, lang);
      if (route === 'GET /api/likes') return await getLikes(req, env, cors, url);
      if (route === 'POST /api/like') return await setLike(req, env, cors, lang);
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      console.error(e);
      return fail(lang, 'server', 500, cors);
    }
  },
};

// 画面に返す文言。英語版のページは ?lang=en を付けて呼ぶ
const MSG = {
  origin: { ja: 'このページからは送れません。', en: 'Requests are only accepted from the site itself.' },
  server: { ja: 'サーバーでエラーが起きました。時間をおいてもう一度試してください。', en: 'Something went wrong on the server. Please try again later.' },
  turnstile: { ja: '確認（ロボットでないことのチェック）が通りませんでした。もう一度試してください。', en: 'The robot check did not pass. Please try again.' },
  reportLimit: { ja: '1日に送れるのは{n}件までです。', en: 'You can send up to {n} requests a day.' },
  reportPaper: { ja: '論文のページのURLを書いてください。', en: "Please enter the URL of the paper's page." },
  reportReason: { ja: '理由を書いてください。', en: 'Please enter a reason.' },
  reportReasonLong: { ja: '理由は{n}字までです。', en: 'The reason must be {n} characters or fewer.' },
  reportContactLong: { ja: '連絡先は{n}字までです。', en: 'Contact details must be {n} characters or fewer.' },
  likeMissing: { ja: 'その論文は見つかりません。', en: 'That paper was not found.' },
  pdfSize: { ja: 'PDFは10MBまでです。', en: 'The PDF must be 10 MB or smaller.' },
  submitLimit: { ja: '1日に投稿できるのは{n}本までです。', en: 'You can post up to {n} papers a day.' },
  provider: { ja: '書いたAIを選んでください。', en: 'Please choose the AI that wrote it.' },
  model: { ja: 'モデルを選んでください。', en: 'Please choose the model.' },
  modelOther: { ja: '一覧にないモデルの名前を書いてください。', en: 'Please enter the name of the model.' },
  modelOtherLong: { ja: 'モデルの名前は{n}字までです。', en: 'The model name must be {n} characters or fewer.' },
  purpose: { ja: '何を調べようとしたかを書いてください。', en: 'Please enter what you wanted to find out.' },
  purposeLong: { ja: '何を調べようとしたかは{n}字までです。', en: 'This must be {n} characters or fewer.' },
  commentLong: { ja: '一言は{n}字までです。', en: 'The comment must be {n} characters or fewer.' },
  authorLong: { ja: '投稿者は{n}字までです。', en: 'The poster field must be {n} characters or fewer.' },
  pdfMissing: { ja: 'PDFを添付してください。', en: 'Please attach a PDF.' },
  notPdf: { ja: 'PDFではないファイルです。', en: 'That file is not a PDF.' },
};

function fail(lang, key, status, cors, n) {
  return json({ error: MSG[key][lang].replace('{n}', n) }, status, cors);
}

const PAPER_ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const REPORT_DAILY_LIMIT = 10;

async function report(req, env, cors, lang) {
  const form = await req.formData();
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (!(await verifyTurnstile(form.get('cf-turnstile-response'), ip, env))) {
    return fail(lang, 'turnstile', 400, cors);
  }
  const rateKey = `rr:${await sha256hex(env.IP_SALT + ip)}:${jst(new Date()).slice(0, 10)}`;
  const used = Number((await env.RATE.get(rateKey)) || 0);
  if (used >= REPORT_DAILY_LIMIT) return fail(lang, 'reportLimit', 429, cors, REPORT_DAILY_LIMIT);

  const paper = str(form.get('paper'));
  const reason = str(form.get('reason'));
  const contact = str(form.get('contact'));
  const id = (paper.match(/\d{8}-\d{6}-[0-9a-f]{4}/) || [])[0];
  if (!id) return fail(lang, 'reportPaper', 400, cors);
  if (!reason) return fail(lang, 'reportReason', 400, cors);
  if ([...reason].length > MAX_REPORT_REASON) return fail(lang, 'reportReasonLong', 400, cors, MAX_REPORT_REASON);
  if ([...contact].length > MAX_REPORT_CONTACT) return fail(lang, 'reportContactLong', 400, cors, MAX_REPORT_CONTACT);

  const body = [
    `論文: ${env.SITE_ORIGIN}${env.SITE_BASE_PATH || '/'}p/${id}.html`,
    `消す場所: papers/${id}/`,
    `受付: ${jst(new Date()).replace('T', ' ')}（日本時間）`,
    `送った画面: ${lang === 'en' ? '英語版' : '日本語版'}`,
    '', '## 理由', reason, '', '## 連絡先', contact || '（なし）',
  ].join('\n');
  const r = await fetch(`${env.GITHUB_API}/repos/${env.REPORT_REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-ronbun-submit',
    },
    body: JSON.stringify({ title: `削除依頼 ${id}`, body }),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  await env.RATE.put(rateKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return json({ ok: true }, 200, cors);
}

async function voterOf(req, env) {
  return sha256hex(env.IP_SALT + (req.headers.get('CF-Connecting-IP') || 'local'));
}

// ?id= があればその論文の数と自分が押したか、なければ全論文の数
async function getLikes(req, env, cors, url) {
  const id = url.searchParams.get('id');
  if (!id) {
    const { results } = await env.DB.prepare('SELECT paper_id, n FROM like_counts WHERE n > 0').all();
    return json(Object.fromEntries(results.map((r) => [r.paper_id, r.n])), 200, cors);
  }
  if (!PAPER_ID.test(id)) return json({ error: 'bad id' }, 400, cors);
  const voter = await voterOf(req, env);
  const [count, mine] = await env.DB.batch([
    env.DB.prepare('SELECT n FROM like_counts WHERE paper_id = ?').bind(id),
    env.DB.prepare('SELECT 1 FROM likes WHERE paper_id = ? AND voter = ?').bind(id, voter),
  ]);
  return json({ count: count.results[0]?.n ?? 0, liked: mine.results.length > 0 }, 200, cors);
}

// { id, liked: true|false } を受けて、押す・取り消す
async function setLike(req, env, cors, lang) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!PAPER_ID.test(id)) return json({ error: 'bad id' }, 400, cors);
  const voter = await voterOf(req, env);

  if (body.liked) {
    // 実在しない論文に数が溜まらないよう、初めて押された時だけ公開サイトにページがあるか確かめる
    const known = await env.DB.prepare('SELECT 1 FROM like_counts WHERE paper_id = ?').bind(id).first();
    if (!known) {
      const r = await fetch(`${env.SITE_ORIGIN}${env.SITE_BASE_PATH || "/"}p/${id}.html`, { method: "HEAD" });
      if (!r.ok) return fail(lang, 'likeMissing', 404, cors);
    }
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO likes (paper_id, voter, created_at) VALUES (?, ?, ?)')
      .bind(id, voter, new Date().toISOString()).run();
    if (ins.meta.changes) {
      await env.DB.prepare('INSERT INTO like_counts (paper_id, n) VALUES (?, 1) ON CONFLICT(paper_id) DO UPDATE SET n = n + 1')
        .bind(id).run();
    }
  } else {
    const del = await env.DB.prepare('DELETE FROM likes WHERE paper_id = ? AND voter = ?').bind(id, voter).run();
    if (del.meta.changes) {
      await env.DB.prepare('UPDATE like_counts SET n = n - 1 WHERE paper_id = ? AND n > 0').bind(id).run();
    }
  }
  const row = await env.DB.prepare('SELECT n FROM like_counts WHERE paper_id = ?').bind(id).first();
  return json({ count: row?.n ?? 0, liked: !!body.liked }, 200, cors);
}

async function submit(req, env, cors, lang) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_PDF_BYTES + 64 * 1024) return fail(lang, 'pdfSize', 413, cors);

  const form = await req.formData();
  const ip = req.headers.get('CF-Connecting-IP') || 'local';

  if (!(await verifyTurnstile(form.get('cf-turnstile-response'), ip, env))) {
    return fail(lang, 'turnstile', 400, cors);
  }

  const now = new Date();
  const day = jst(now).slice(0, 10);
  const rateKey = `rl:${await sha256hex(env.IP_SALT + ip)}:${day}`;
  const used = Number((await env.RATE.get(rateKey)) || 0);
  if (used >= DAILY_LIMIT) return fail(lang, 'submitLimit', 429, cors, DAILY_LIMIT);

  const provider = str(form.get('provider'));
  const model = str(form.get('model'));
  const modelOther = str(form.get('model_other'));
  const purpose = str(form.get('purpose'));
  const comment = str(form.get('comment'));
  const author = str(form.get('author'));
  const pdf = form.get('pdf');

  if (!PROVIDERS.includes(provider)) return fail(lang, 'provider', 400, cors);
  if (!modelChoices(provider).includes(model)) return fail(lang, 'model', 400, cors);
  if (model === MODEL_NOT_LISTED && !modelOther) return fail(lang, 'modelOther', 400, cors);
  if ([...modelOther].length > MAX_MODEL_OTHER) return fail(lang, 'modelOtherLong', 400, cors, MAX_MODEL_OTHER);
  if (!purpose) return fail(lang, 'purpose', 400, cors);
  if ([...purpose].length > MAX_PURPOSE) return fail(lang, 'purposeLong', 400, cors, MAX_PURPOSE);
  if ([...comment].length > MAX_COMMENT) return fail(lang, 'commentLong', 400, cors, MAX_COMMENT);
  if ([...author].length > MAX_AUTHOR) return fail(lang, 'authorLong', 400, cors, MAX_AUTHOR);
  if (!pdf || typeof pdf === 'string') return fail(lang, 'pdfMissing', 400, cors);
  if (pdf.size > MAX_PDF_BYTES) return fail(lang, 'pdfSize', 413, cors);

  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    return fail(lang, 'notPdf', 400, cors);
  }

  const stamp = jst(now).replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261021-013000
  const id = `${stamp}-${crypto.randomUUID().slice(0, 4)}`;
  const meta = {
    id,
    created_at: now.toISOString(),
    provider,
    // model: 一覧から選んだ名前か、一覧にない時に書かれた名前。わからない時は null
    model: model === MODEL_UNKNOWN ? null : model === MODEL_NOT_LISTED ? modelOther : model,
    model_in_list: model !== MODEL_UNKNOWN && model !== MODEL_NOT_LISTED,
    purpose,
    comment: comment || null,
    author: author || null, // 投稿者が自分で書いたもの（名前・X・ペンネームなど何でも）。本人か確かめていない
  };

  // 本文が先、meta.json が後。一覧は meta.json があるものだけを拾うので、途中で失敗しても半端な投稿は出ない
  await putFile(env, `papers/${id}/paper.pdf`, Buffer.from(bytes).toString('base64'), `投稿 ${id}（PDF）`);
  await putFile(env, `papers/${id}/meta.json`,
    Buffer.from(JSON.stringify(meta, null, 2) + '\n').toString('base64'), `投稿 ${id}`);

  await env.RATE.put(rateKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
  return json({ ok: true, id }, 200, cors);
}

async function putFile(env, path, contentB64, message) {
  const url = `${env.GITHUB_API}/repos/${env.GITHUB_REPO}/contents/${path}`;
  const init = {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-ronbun-submit',
    },
    body: JSON.stringify({ message, content: contentB64, branch: env.GITHUB_BRANCH }),
  };
  // 同時に投稿が来るとGitHubが409を返すことがあるので、少し待って再送する
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, init);
    if (r.ok) return;
    if (r.status !== 409) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  throw new Error('GitHub 409 が続いた');
}

async function verifyTurnstile(token, ip, env) {
  if (!token) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  body.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await r.json();
  return data.success === true;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function jst(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19);
}

async function sha256hex(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Buffer.from(h).toString('hex');
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
