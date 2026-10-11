const fs = require('node:fs');
const { execSync } = require('node:child_process');
const sha = execSync('gh api repos/tlreal/rag/contents/src/mcp-proxy.cjs --jq .sha').toString().trim();
const body = JSON.stringify({
  message: 'mcp-proxy: self-heal daemon on ECONNREFUSED (spawn detached with logs)',
  branch: 'main',
  sha,
  content: fs.readFileSync('src/mcp-proxy.cjs').toString('base64'),
});
fs.writeFileSync('data/api-push-body.json', body);
execSync('gh api repos/tlreal/rag/contents/src/mcp-proxy.cjs -X PUT --input data/api-push-body.json', { stdio: 'inherit' });
fs.unlinkSync('data/api-push-body.json');
console.log('pushed via API (input file)');
