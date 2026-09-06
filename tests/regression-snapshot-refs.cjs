// Regression test R1: second snapshot must keep all interactive elements
const { connectBrowser } = require('C:/Users/tusha/.zcode/workspace/default/AgenticBrowser/dist/cli/cdp.js');
const { extractionScript } = require('C:/Users/tusha/.zcode/workspace/default/AgenticBrowser/dist/shared/pageJson.js');

(async () => {
  const h = await connectBrowser({});
  const s = h.session;
  const page = 'data:text/html,<html><body><a href=%23a>Link A</a><button>Button B</button><input type=text placeholder="Field C"><button>Button D</button></body></html>';

  await s.send('Page.navigate', { url: page });
  await new Promise((r) => setTimeout(r, 1200));

  const snap1 = await s.evaluate(extractionScript({ textLimit: 100 }));
  const snap2 = await s.evaluate(extractionScript({ textLimit: 100 })); // second pass on same DOM

  console.log('snapshot1 interactive:', snap1.interactive.length, '| links:', snap1.links.length);
  console.log('snapshot2 interactive:', snap2.interactive.length, '| links:', snap2.links.length);

  const refs1 = [...snap1.links.map(l => l.ref), ...snap1.interactive.map(i => i.ref)].sort();
  const refs2 = [...snap2.links.map(l => l.ref), ...snap2.interactive.map(i => i.ref)].sort();
  console.log('refs stable across snapshots:', JSON.stringify(refs1) === JSON.stringify(refs2), refs1, refs2);

  // no duplicate refs within one snapshot
  const all = [...snap1.links.map(l => l.ref), ...snap1.interactive.map(i => i.ref)];
  console.log('no duplicate refs:', new Set(all).size === all.length);

  process.exit(0);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
