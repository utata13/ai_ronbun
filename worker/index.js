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
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'POST' && req.headers.get('Origin') !== env.SITE_ORIGIN) {
      return json({ error: 'このページからは送れません。' }, 403, cors);
    }
    try {
      if (route === 'POST /api/submit') return await submit(req, env, cors);
      if (route === 'POST /api/report') return await report(req, env, cors);
      if (route === 'GET /api/likes') return await getLikes(req, env, cors, url);
      if (route === 'POST /api/like') return await setLike(req, env, cors);
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      console.error(e);
      return json({ error: 'サーバーでエラーが起きました。時間をおいてもう一度試してください。' }, 500, cors);
    }
  },
};

const PAPER_ID = /^\d{8}-\d{6}-[0-9a-f]{4}$/;
const REPORT_DAILY_LIMIT = 10;

async function report(req, env, cors) {
  const form = await req.formData();
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (!(await verifyTurnstile(form.get('cf-turnstile-response'), ip, env))) {
    return json({ error: '確認（ロボットでないことのチェック）が通りませんでした。もう一度試してください。' }, 400, cors);
  }
  const rateKey = `rr:${await sha256hex(env.IP_SALT + ip)}:${jst(new Date()).slice(0, 10)}`;
  const used = Number((await env.RATE.get(rateKey)) || 0);
  if (used >= REPORT_DAILY_LIMIT) return json({ error: `1日に送れるのは${REPORT_DAILY_LIMIT}件までです。` }, 429, cors);

  const paper = str(form.get('paper'));
  const reason = str(form.get('reason'));
  const contact = str(form.get('contact'));
  const id = (paper.match(/\d{8}-\d{6}-[0-9a-f]{4}/) || [])[0];
  if (!id) return json({ error: '論文のページのURLを書いてください。' }, 400, cors);
  if (!reason) return json({ error: '理由を書いてください。' }, 400, cors);
  if ([...reason].length > MAX_REPORT_REASON) return json({ error: `理由は${MAX_REPORT_REASON}字までです。` }, 400, cors);
  if ([...contact].length > MAX_REPORT_CONTACT) return json({ error: `連絡先は${MAX_REPORT_CONTACT}字までです。` }, 400, cors);

  const body = [
    `論文: ${env.SITE_ORIGIN}${env.SITE_BASE_PATH || '/'}p/${id}.html`,
    `消す場所: papers/${id}/`,
    `受付: ${jst(new Date()).replace('T', ' ')}（日本時間）`,
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
async function setLike(req, env, cors) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!PAPER_ID.test(id)) return json({ error: 'bad id' }, 400, cors);
  const voter = await voterOf(req, env);

  if (body.liked) {
    // 実在しない論文に数が溜まらないよう、初めて押された時だけ公開サイトにページがあるか確かめる
    const known = await env.DB.prepare('SELECT 1 FROM like_counts WHERE paper_id = ?').bind(id).first();
    if (!known) {
      const r = await fetch(`${env.SITE_ORIGIN}${env.SITE_BASE_PATH || "/"}p/${id}.html`, { method: "HEAD" });
      if (!r.ok) return json({ error: 'その論文は見つかりません。' }, 404, cors);
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

async function submit(req, env, cors) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_PDF_BYTES + 64 * 1024) return json({ error: 'PDFは10MBまでです。' }, 413, cors);

  const form = await req.formData();
  const ip = req.headers.get('CF-Connecting-IP') || 'local';

  if (!(await verifyTurnstile(form.get('cf-turnstile-response'), ip, env))) {
    return json({ error: '確認（ロボットでないことのチェック）が通りませんでした。もう一度試してください。' }, 400, cors);
  }

  const now = new Date();
  const day = jst(now).slice(0, 10);
  const rateKey = `rl:${await sha256hex(env.IP_SALT + ip)}:${day}`;
  const used = Number((await env.RATE.get(rateKey)) || 0);
  if (used >= DAILY_LIMIT) return json({ error: `1日に投稿できるのは${DAILY_LIMIT}本までです。` }, 429, cors);

  const provider = str(form.get('provider'));
  const model = str(form.get('model'));
  const modelOther = str(form.get('model_other'));
  const purpose = str(form.get('purpose'));
  const comment = str(form.get('comment'));
  const author = str(form.get('author'));
  const pdf = form.get('pdf');

  if (!PROVIDERS.includes(provider)) return json({ error: '書いたAIを選んでください。' }, 400, cors);
  if (!modelChoices(provider).includes(model)) return json({ error: 'モデルを選んでください。' }, 400, cors);
  if (model === MODEL_NOT_LISTED && !modelOther) return json({ error: '一覧にないモデルの名前を書いてください。' }, 400, cors);
  if ([...modelOther].length > MAX_MODEL_OTHER) return json({ error: `モデルの名前は${MAX_MODEL_OTHER}字までです。` }, 400, cors);
  if (!purpose) return json({ error: '何を調べようとしたかを書いてください。' }, 400, cors);
  if ([...purpose].length > MAX_PURPOSE) return json({ error: `何を調べようとしたかは${MAX_PURPOSE}字までです。` }, 400, cors);
  if ([...comment].length > MAX_COMMENT) return json({ error: `一言は${MAX_COMMENT}字までです。` }, 400, cors);
  if ([...author].length > MAX_AUTHOR) return json({ error: `投稿者は${MAX_AUTHOR}字までです。` }, 400, cors);
  if (!pdf || typeof pdf === 'string') return json({ error: 'PDFを添付してください。' }, 400, cors);
  if (pdf.size > MAX_PDF_BYTES) return json({ error: 'PDFは10MBまでです。' }, 413, cors);

  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
    return json({ error: 'PDFではないファイルです。' }, 400, cors);
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
