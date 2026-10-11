// 通用写入工具：node scripts/record.cjs <project> <type> <content> [payloadJSON]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'daemon.json'), 'utf8'));

const [project, type, content, payloadRaw] = process.argv.slice(2);
if (!project || !type || !content) {
  console.error('usage: node scripts/record.cjs <project> <type> <content> [payloadJSON]');
  process.exit(1);
}
const body = { project, type, content, client: 'cli' };
if (payloadRaw) { try { body.payload = JSON.parse(payloadRaw); } catch { console.error('payload 不是合法 JSON'); process.exit(1); } }

fetch(`http://127.0.0.1:${st.port}/records`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${st.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(r => r.json()).then(r => {
  if (r.error) { console.error(r.error); process.exit(1); }
  console.log(`#${r.id} [${r.project_slug}] ${r.ts}`);
}).catch(e => { console.error('daemon 不可达：', e.message); process.exit(1); });
