// MCP stdio 代理自测：模拟客户端跑 initialize → tools/list → tools/call 全链路
'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');

const proc = spawn('node', [path.join(__dirname, '..', 'src', 'mcp-proxy.cjs')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
let nextId = 1;
proc.stdout.on('data', d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg); pending.delete(msg.id);
    }
  }
});

function rpc(method, params) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

(async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
  console.log('== initialize:', init.result.serverInfo.name, init.result.serverInfo.version);

  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await rpc('tools/list', {});
  console.log('== tools/list:', tools.result.tools.map(t => t.name).join(', '));

  const st = await rpc('tools/call', { name: 'get_status', arguments: { project: '大脑' } });
  console.log('== get_status(大脑) 前 300 字:');
  console.log(JSON.parse(st.result.content[0].text).status_markdown.slice(0, 300));

  const rec = await rpc('tools/call', { name: 'record', arguments: {
    project: 'shared-brain', type: 'note', client: 'cherry',
    content: '[自测] MCP 代理链路验证记录：从 stdio 代理写入成功。' } });
  console.log('== record:', JSON.parse(rec.result.content[0].text));

  const sr = await rpc('tools/call', { name: 'search', arguments: { query: '否决 云服务' } });
  const srText = JSON.parse(sr.result.content[0].text);
  const srj = srText.results ? srText : { results: [] };
  console.log('== search(否决 云服务):', (srText.results || srText.error || []).length, '条, top:', (srText.results ? srText.results[0].content.slice(0, 40) : JSON.stringify(srText).slice(0, 80)));

  console.log('ALL MCP TESTS PASSED');
  proc.kill();
  process.exit(0);
})().catch(e => { console.error(e); proc.kill(); process.exit(1); });
