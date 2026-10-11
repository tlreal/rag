// 分离式启动守护进程：detached + unref，不挂任何调用方进程树；日志落文件
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DAEMON = path.join(ROOT, 'src', 'daemon.cjs');

async function alive() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'daemon.json'), 'utf8'));
    const r = await fetch(`http://127.0.0.1:${st.port || 47623}/health`);
    return (await r.json()).ok === true;
  } catch { return false; }
}

(async () => {
  if (await alive()) { console.log('daemon already alive'); return 0; }
  const out = fs.openSync(path.join(ROOT, 'data', 'daemon.out.log'), 'a');
  const err = fs.openSync(path.join(ROOT, 'data', 'daemon.err.log'), 'a');
  fs.writeSync(err, `\n--- launcher ${new Date().toISOString()} ---\n`);
  const child = spawn(process.execPath, [DAEMON], {
    detached: true, stdio: ['ignore', out, err], cwd: ROOT,
  });
  child.unref();
  await new Promise(r => setTimeout(r, 1200));
  console.log((await alive()) ? 'daemon started (detached)' : 'daemon FAILED to start — see data/daemon.err.log');
})().then(c => process.exit(c || 0)).catch(e => { console.error(e); process.exit(1); });
