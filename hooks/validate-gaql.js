#!/usr/bin/env node
let input = '';
const timeout = setTimeout(() => {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}, 3000);

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const d = JSON.parse(input);
    const q = (d.tool_input?.query || d.input?.query || '').trim();
    const upper = q.toUpperCase();
    if (q && !upper.startsWith('SELECT')) {
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'Only SELECT queries are allowed via run_gaql. Write operations are blocked.' }));
      process.exit(0);
    }
    const blocked = ['CREATE', 'UPDATE', 'DELETE', 'MUTATE', 'REMOVE', 'INSERT'];
    for (const kw of blocked) {
      if (upper.includes(kw) && !upper.startsWith('SELECT')) {
        process.stdout.write(JSON.stringify({ decision: 'deny', reason: `GAQL query contains blocked keyword: ${kw}` }));
        process.exit(0);
      }
    }
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  }
});

if (process.stdin.isTTY) {
  clearTimeout(timeout);
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
  process.exit(0);
}
