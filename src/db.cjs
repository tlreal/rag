// shared-brain M0-lite · 数据层：SQLite (node:sqlite) + FTS5 trigram
'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  aliases     TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,
  client      TEXT NOT NULL,
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  type        TEXT NOT NULL CHECK(type IN ('task_update','decision','note','blocker')),
  content     TEXT NOT NULL,
  payload     TEXT,
  tags        TEXT,
  session_ref TEXT,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_records_proj_ts ON records(project_id, ts DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(content, content='records', content_rowid='id', tokenize='trigram');
CREATE TRIGGER IF NOT EXISTS records_fts_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

const TYPE_WEIGHT = { blocker: 1.0, decision: 0.9, task_update: 0.7, note: 0.4 };
const HALF_LIFE_DAYS = 7;

function slugify(name) {
  const ascii = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii && ascii.length >= 2) return ascii.slice(0, 48);
  return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

class Brain {
  constructor(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  // —— 项目与别名解析（§8.5）——
  resolveProject(name, { create = false } = {}) {
    const rows = this.db.prepare('SELECT * FROM projects').all();
    const n = String(name).trim();
    // 1. slug / name 精确
    let hit = rows.find(p => p.slug === n || p.name === n);
    if (hit) return { project: hit };
    // 2. 别名精确
    hit = rows.find(p => { try { return JSON.parse(p.aliases).includes(n); } catch { return false; } });
    if (hit) return { project: hit };
    // 3. 模糊（名称/别名包含）
    const fuzzy = rows.filter(p => p.name.includes(n) ||
      (() => { try { return JSON.parse(p.aliases).some(a => a.includes(n) || n.includes(a)); } catch { return false; } })());
    if (fuzzy.length === 1) return { project: fuzzy[0] };
    if (fuzzy.length > 1) return { candidates: fuzzy.map(p => ({ slug: p.slug, name: p.name })) };
    // 4. 新建（record 路径）
    if (create) {
      const slug = slugify(n);
      const now = new Date().toISOString();
      const info = this.db.prepare(
        'INSERT INTO projects (slug, name, aliases, created_at) VALUES (?, ?, ?, ?)'
      ).run(slug, n, '[]', now);
      return { project: this.db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(info.lastInsertRowid)) };
    }
    return {};
  }

  addAlias(projectId, alias) {
    const p = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!p) return;
    let aliases; try { aliases = JSON.parse(p.aliases); } catch { aliases = []; }
    const a = String(alias).trim();
    if (!a || aliases.includes(a) || p.slug === a || p.name === a) return;
    aliases.push(a);
    this.db.prepare('UPDATE projects SET aliases = ? WHERE id = ?').run(JSON.stringify(aliases), projectId);
  }

  // —— 写入（§6.1）——
  insertRecord({ client, project_id, type, content, payload, tags, session_ref }) {
    const ts = new Date().toISOString();
    const info = this.db.prepare(
      `INSERT INTO records (ts, client, project_id, type, content, payload, tags, session_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(ts, client || 'unknown', project_id, type, content,
      payload ? JSON.stringify(payload) : null,
      tags ? JSON.stringify(tags) : null, session_ref || null);
    return { id: Number(info.lastInsertRowid), ts };
  }

  // —— 派生视图（§6.2）——
  latestTaskUpdate(projectId) {
    return this.db.prepare(
      `SELECT * FROM records WHERE project_id = ? AND type = 'task_update' AND deleted_at IS NULL
       ORDER BY ts DESC, id DESC LIMIT 1`
    ).get(projectId) || null;
  }

  activeBlockers(projectId) {
    const latest = this.latestTaskUpdate(projectId);
    return this.db.prepare(
      `SELECT * FROM records WHERE project_id = ? AND type = 'blocker' AND deleted_at IS NULL
       AND ts > ? ORDER BY ts DESC`
    ).all(projectId, latest ? latest.ts : '1970-01-01');
  }

  recentDecisions(projectId, n = 3) {
    return this.db.prepare(
      `SELECT * FROM records WHERE project_id = ? AND type = 'decision' AND deleted_at IS NULL
       ORDER BY ts DESC, id DESC LIMIT ?`
    ).all(projectId, n);
  }

  activeProjects() {
    return this.db.prepare(`SELECT * FROM projects WHERE status = 'active' ORDER BY id`).all()
      .filter(p => this.db.prepare(
        'SELECT COUNT(*) AS c FROM records WHERE project_id = ?').get(p.id).c > 0);
  }

  renderStatus(project, budget = 2000) {
    const task = this.latestTaskUpdate(project.id);
    const decisions = this.recentDecisions(project.id);
    const blockers = this.activeBlockers(project.id);
    let payload = {}; try { payload = task ? JSON.parse(task.payload || '{}') : {}; } catch {}
    const lines = [];
    lines.push(`### ${project.name}（${project.slug}）`);
    lines.push(`**当前状态**：${task ? (payload.status || 'in_progress') : '（暂无任务记录）'}`);
    if (task) lines.push(`**进展**：${task.content}`);
    if (task) lines.push(`（截至 ${fmtLocal(task.ts)} · 来自 ${task.client}）`);
    if (payload.next && payload.next.length) {
      lines.push(`**下一步**：`);
      payload.next.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
    }
    if (blockers.length) {
      lines.push(`**阻塞**：`);
      blockers.forEach(b => lines.push(`- ${b.content}（${fmtLocal(b.ts)}，来自 ${b.client}）`));
    }
    if (decisions.length) {
      lines.push(`**最近决策**：`);
      decisions.forEach(d => lines.push(`- ${fmtLocal(d.ts)} [${d.client}] ${d.content}`));
    }
    return lines.join('\n');
  }

  renderAllStatus(budget = 2000) {
    const projects = this.activeProjects();
    if (!projects.length) return '（大脑中暂无活跃项目记录）';
    const blocks = [];
    let used = 0;
    for (const p of projects) {
      const b = this.renderStatus(p, budget);
      if (used + b.length > budget && blocks.length) break;
      blocks.push(b);
      used += b.length;
    }
    return blocks.join('\n\n');
  }

  // —— 检索（§9 排序：相关度 × 类型权重 × 时间衰减）——
  search(q, { project, type, limit = 10 } = {}) {
    q = String(q).trim();
    if (!q) return [];
    const params = [];
    let where = 'r.deleted_at IS NULL';
    const words = q.trim().split(/\s+/).filter(Boolean);
    const useFts = [...q].length >= 3;
    const ftsWords = words.filter(w => [...w].length >= 3);
    let rows;
    if (useFts && ftsWords.length) {
      const phrase = ftsWords.map(w => '"' + [...w].slice(0, 32).join('') + '"').join(' ');
      try {
        rows = this.db.prepare(
          `SELECT r.*, bm25(records_fts) AS fts_rank FROM records_fts f
           JOIN records r ON r.id = f.rowid
           WHERE records_fts MATCH ? AND r.deleted_at IS NULL`
        ).all(phrase);
      } catch { rows = []; }
    }
    const likeClauses = words.map(() => 'r.content LIKE ?').join(' AND ');
    const liked = this.db.prepare(
      `SELECT r.*, 0 AS fts_rank FROM records r WHERE ${likeClauses} AND r.deleted_at IS NULL`
    ).all(...words.map(w => '%' + w.replace(/[%_]/g, m => '\\' + m) + '%'));
    const merged = new Map();
    for (const r of [...(rows || []), ...liked]) {
      if (!merged.has(r.id)) merged.set(r.id, r);
    }
    let list = [...merged.values()];
    if (project) {
      const rp = this.resolveProject(project);
      if (!rp.project) return [];
      list = list.filter(r => r.project_id === rp.project.id);
    }
    if (type) list = list.filter(r => r.type === type);
    const now = Date.now();
    return list.map(r => {
      const ageDays = (now - Date.parse(r.ts)) / 86400000;
      const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      const rel = r.fts_rank < 0 ? Math.min(1, 1 / (1 - r.fts_rank)) : 0.5; // bm25 为负，越负越相关
      const score = rel * (TYPE_WEIGHT[r.type] || 0.5) * decay;
      return { ...r, score };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  listRecords(projectSlug, limit = 50) {
    let rows = this.db.prepare(
      'SELECT r.*, p.slug AS project_slug FROM records r JOIN projects p ON p.id = r.project_id WHERE r.deleted_at IS NULL ORDER BY r.ts DESC, r.id DESC LIMIT ?'
    ).all(limit);
    if (projectSlug) {
      const rp = this.resolveProject(projectSlug);
      rows = rp.project ? rows.filter(r => r.project_id === rp.project.id) : [];
    }
    return rows;
  }
}

function fmtLocal(iso) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

module.exports = { Brain, fmtLocal };
