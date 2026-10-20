// 手元で試すためのサーバー。GitHubの「ファイルを書き込む」APIのふりをして dev_repo/ に保存し、
// 書き込みがあるたびにサイトを作り直して（GitHub Actions の代わり）、site/ を配信する。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.join(root, 'dev_repo');
const site = path.join(root, 'site');
const PORT = 8851;

function rebuild() {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--data', repo, '--out', site, '--config', 'config.dev.json'], { encoding: 'utf8' });
  process.stdout.write(r.stdout + r.stderr);
}

let timer;
const scheduleRebuild = () => { clearTimeout(timer); timer = setTimeout(rebuild, 300); };

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.pdf': 'application/pdf', '.txt': 'text/plain' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
  if (m && req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const { content, message } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const rel = decodeURIComponent(m[1]);
      const dst = path.join(repo, rel);
      if (!dst.startsWith(repo + path.sep)) { res.writeHead(400).end(); return; }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, Buffer.from(content, 'base64'));
      console.log(`commit: ${message} -> ${rel}`);
      if (rel.endsWith('meta.json')) scheduleRebuild();
      res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ content: { path: rel } }));
    });
    return;
  }
  const issue = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/issues$/);
  if (issue && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const dir = path.join(root, 'dev_reports');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}.json`);
      fs.writeFileSync(file, Buffer.concat(chunks));
      console.log(`issue: ${path.relative(root, file)}`);
      res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"number":1}');
    });
    return;
  }
  let p = path.join(site, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) p = path.join(p, 'index.html');
  if (!p.startsWith(site) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404, { 'Content-Type': types['.html'] });
    fs.createReadStream(path.join(site, '404.html')).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => {
  rebuild();
  console.log(`site + fake GitHub: http://localhost:${PORT}/`);
});
