// 一次性播种脚本：把今天（2026-10-11）龙虾侧真实工作历史写入共享大脑
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const STATE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'daemon.json'), 'utf8'));
const BASE = 'http://127.0.0.1:' + STATE.port;

async function rec(body) {
  const res = await fetch(BASE + '/records', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${STATE.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const r = await res.json();
  if (r.error) throw new Error(r.error);
  console.log(`#${r.id} [${body.project}] ${body.type}: ${(body.content || '').slice(0, 40)}...`);
}

// 预注册项目 + 别名（用一条 note 先建项目，再补别名靠 API？No——别名走 project_alias）
(async () => {
  // 1. shared-brain 项目本体
  await rec({ project: 'shared-brain', client: 'openclaw', type: 'note',
    content: '项目别名：rag / 大脑 / 共享大脑 / shared brain（本条即项目注册）。',
    project_alias: 'rag' });

  // 2. 今天的时间线（按真实发生顺序）
  await rec({ project: 'shared-brain', client: 'openclaw', type: 'task_update',
    content: '目标重定义：原「重做一个 RAG 项目」在讨论中演化——乐的真实痛点是跨客户端上下文断裂（OpenClaw/Cherry Studio 互不知情）。产品定型为跨 Agent 个人上下文中枢，RAG 检索降级为 v2 引擎。',
    payload: { status: 'in_progress' }, tags: ['pivot'] });

  await rec({ project: 'shared-brain', client: 'openclaw', type: 'decision',
    content: '产品形态=本机守护进程+MCP(stdio 薄代理+HTTP)+SQLite 本地存储。否决：云服务（隐私三连杀）、独立客户端 app（方向反了）、纯 stdio 插件（多进程各写各的破功）。' });

  await rec({ project: 'shared-brain', client: 'openclaw', type: 'decision',
    content: '技术栈=TypeScript/Node（MCP SDK 一等公民；本机 Node 24）。M0-lite 用纯 JS 零构建零依赖，Node 内置 node:sqlite。' });

  await rec({ project: 'shared-brain', client: 'openclaw', type: 'decision',
    content: '数据模型=append-only records + 派生视图（当前状态=最新 task_update 实时算，不落库）。agent 无删除权，仅人类可软删（CLI）。' });

  await rec({ project: 'shared-brain', client: 'openclaw', type: 'task_update',
    content: '设计文档完成并落盘：docs/specs/2026-10-11-shared-brain-design.md（意图/数据模型/接口/流程/里程碑/风险全量）。',
    payload: { artifacts: ['docs/specs/2026-10-11-shared-brain-design.md'] } });

  // 3. homepage 项目（今天早上的另一条线）
  await rec({ project: 'homepage', client: 'openclaw', type: 'task_update',
    content: '个人主页已上线 https://tlreal.github.io/ （GitHub Pages，仓库 tlreal.github.io，本地 D:\\tools\\githubfiel\\tlreal.github.io）。模板页，等乐给内容素材。',
    payload: { status: 'waiting_user', next: ['乐提供内容素材', '替换模板上线'],
               artifacts: ['https://tlreal.github.io/'] }, tags: ['delivered'] });

  // 4. 当前快照
  await rec({ project: 'shared-brain', client: 'openclaw', type: 'task_update',
    content: 'M0-lite 实现中：守护进程(REST+SQLite+FTS5)+MCP stdio 代理+三工具(record/get_status/search) 代码完成，自测通过（健康检查/写入/别名/状态渲染）。下一步=Cherry Studio 连接实测闭环。',
    payload: { status: 'in_progress',
               next: ['Cherry 配 MCP 指向 stdio 代理', '粘连接提示词', '乐实测「继续/今天做了什么」闭环验收'] } });

  // 5. 给 shared-brain 补常用别名
  await rec({ project: 'shared-brain', client: 'cli', type: 'note',
    content: '别名补充注册。', project_alias: '共享大脑' });
  await rec({ project: 'shared-brain', client: 'cli', type: 'note',
    content: '别名补充注册。', project_alias: '大脑' });

  console.log('seed done.');
})().catch(e => { console.error(e); process.exit(1); });
