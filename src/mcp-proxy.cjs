#!/usr/bin/env node
// shared-brain M0-lite · MCP stdio 薄代理 — 无状态转发给守护进程
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'daemon.json');
const BASE = process.env.SB_URL || 'http://127.0.0.1:' + (Number(process.env.SB_PORT) || 47623);

function state() {
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return { base: BASE, token: st.token, port: st.port };
}

async function api(method, p, body) {
  const { base, token } = state();
  const res = await fetch(base + p, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// —— MCP 工具定义（恰好三个，§7.1）——
const TOOLS = [
  {
    name: 'record',
    description: '把当前工作状态写入共享大脑（跨 Agent 持久）。时机：任务开始/里程碑/决策/遇阻/会话收尾。',
    inputSchema: {
      type: 'object',
      required: ['project', 'type', 'content'],
      properties: {
        project: { type: 'string', description: '项目 slug 或别名，如 shared-brain / 大脑' },
        type: { type: 'string', enum: ['task_update', 'decision', 'note', 'blocker'],
                description: 'task_update=任务/进度；decision=拍板的决策(含理由)；note=备注/教训；blocker=阻塞' },
        content: { type: 'string', description: 'Markdown 正文，人眼可读，写清：做了什么/结论/位置' },
        payload: { type: 'object', description: '结构化: {status, next:[], artifacts:[]}',
                   properties: {
                     status: { type: 'string', description: 'in_progress|waiting_user|done' },
                     next: { type: 'array', items: { type: 'string' }, description: '接下来的待办步骤' },
                     artifacts: { type: 'array', items: { type: 'string' }, description: '产物位置(路径/URL)' },
                   } },
        tags: { type: 'array', items: { type: 'string' } },
        project_alias: { type: 'string', description: '用户刚才用的项目新叫法，补录别名' },
      },
    },
  },
  {
    name: 'get_status',
    description: '拉取项目/全部项目的当前状态（开局必调）。返回浓缩状态块：进行中、最近决策、阻塞、下一步。',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '项目 slug/别名；缺省=全部活跃项目' },
        budget_chars: { type: 'number', description: '输出预算，默认 2000' },
      },
    },
  },
  {
    name: 'search',
    description: '搜索共享大脑历史记录（为什么这么决定/之前做过什么）。',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        project: { type: 'string' },
        type: { type: 'string', enum: ['task_update', 'decision', 'note', 'blocker'] },
        limit: { type: 'number', description: '默认 10，上限 25' },
      },
    },
  },
];

const { Server } = (() => { try { return require('@modelcontextprotocol/sdk/server/index.cjs'); } catch { return {}; } })();
// 若无 MCP SDK，退化为最小 JSON-RPC 实现（M0-lite 不引依赖）

async function callTool(name, args) {
  if (name === 'record') {
    return await api('POST', '/records', args);
  }
  if (name === 'get_status') {
    const p = new URLSearchParams();
    if (args.project) p.set('project', args.project);
    if (args.budget_chars) p.set('budget', String(args.budget_chars));
    return await api('GET', '/status?' + p.toString());
  }
  if (name === 'search') {
    const p = new URLSearchParams();
    p.set('q', args.query);
    if (args.project) p.set('project', args.project);
    if (args.type) p.set('type', args.type);
    if (args.limit) p.set('limit', String(args.limit));
    return await api('GET', '/search?' + p.toString());
  }
  return { error: 'unknown tool: ' + name };
}

// —— 最小 MCP stdio JSON-RPC（无需 SDK）——
const rl = readline.createInterface({ input: process.stdin });
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return out({ jsonrpc: '2.0', id, result: {
        protocolVersion: params && params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'shared-brain', version: '0.1.0-m0lite' },
      } });
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
    if (method === 'ping') return out({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return out({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const r = await callTool(params.name, params.arguments || {});
      return out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 2) }] } });
    }
    if (method === 'resources/list') return out({ jsonrpc: '2.0', id, result: { resources: [] } });
    if (method === 'prompts/list') return out({ jsonrpc: '2.0', id, result: { prompts: [] } });
    return out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } });
  } catch (e) {
    return out({ jsonrpc: '2.0', id, error: { code: -32000, message: String(e && e.message || e) } });
  }
});

process.stderr.write('[shared-brain mcp-proxy] stdio ready → ' + BASE + '\n');
