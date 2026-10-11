// shared-brain M0-lite · 守护进程：REST (127.0.0.1) — 唯一真身
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Brain, fmtLocal } = require('./db.cjs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'daemon.json');
const PORT = Number(process.env.SB_PORT || 47623);

function loadState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  }
  const st = { port: PORT, token: crypto.randomBytes(24).toString('hex') };
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
  return st;
}

const state = loadState();
const brain = new Brain(path.join(DATA_DIR, 'shared-brain.db'));
const startedAt = Date.now();

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function authOK(req, url) {
  const h = req.headers['authorization'] || '';
  const q = url.searchParams.get('token') || '';
  return h === `Bearer ${state.token}` || q === state.token;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${state.port}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (url.pathname !== '/health' && !authOK(req, url)) return json(res, 401, { error: 'unauthorized' });

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, version: '0.1.0-m0lite', uptime_s: Math.floor((Date.now() - startedAt) / 1000) });
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      const proj = url.searchParams.get('project');
      const budget = Math.min(4000, Math.max(200, Number(url.searchParams.get('budget') || 2000)));
      if (proj) {
        const rp = brain.resolveProject(proj);
        if (rp.candidates) return json(res, 200, { ambiguous: true, candidates: rp.candidates, hint: '多个项目匹配，请让用户澄清' });
        if (!rp.project) return json(res, 200, { not_found: true, hint: `没有叫「${proj}」的项目` });
        return json(res, 200, { project: { slug: rp.project.slug, name: rp.project.name }, status_markdown: brain.renderStatus(rp.project, budget) });
      }
      return json(res, 200, { status_markdown: brain.renderAllStatus(budget) });
    }
    if (req.method === 'POST' && url.pathname === '/records') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      if (!body.project || !body.type || !body.content) {
        return json(res, 400, { error: 'project / type / content 必填' });
      }
      if (!['task_update', 'decision', 'note', 'blocker'].includes(body.type)) {
        return json(res, 400, { error: 'type 必须是 task_update|decision|note|blocker' });
      }
      const rp = brain.resolveProject(body.project, { create: true });
      if (rp.candidates) return json(res, 200, { ambiguous: true, candidates: rp.candidates });
      const { id, ts } = brain.insertRecord({
        client: body.client || 'unknown', project_id: rp.project.id, type: body.type,
        content: body.content, payload: body.payload, tags: body.tags, session_ref: body.session_ref,
      });
      if (body.project_alias) brain.addAlias(rp.project.id, body.project_alias);
      return json(res, 200, { id, ts, project_slug: rp.project.slug, resolved_as: rp.project.name });
    }
    if (req.method === 'GET' && url.pathname === '/search') {
      const q = url.searchParams.get('q');
      if (!q) return json(res, 400, { error: 'q 必填' });
      const rows = brain.search(q, {
        project: url.searchParams.get('project') || undefined,
        type: url.searchParams.get('type') || undefined,
        limit: Math.min(25, Number(url.searchParams.get('limit') || 10)),
      });
      return json(res, 200, { results: rows.map(r => ({
        id: r.id, ts: r.ts, ts_local: fmtLocal(r.ts), client: r.client, type: r.type,
        content: r.content, score: Number(r.score.toFixed(4)),
      })) });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(state.port, '127.0.0.1', () => {
  console.log(`[shared-brain] daemon on http://127.0.0.1:${state.port} (token in ${STATE_FILE})`);
});
