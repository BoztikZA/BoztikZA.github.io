const fs = require('fs');
const target = 'd:/Boztik Website/deliver-v3/js/site-analytics.js';
const newFunc = fs.readFileSync('d:/Boztik Website/_new_pages_func.js', 'utf8');
let s = fs.readFileSync(target, 'utf8');
const start = s.indexOf('function renderPages() {');
const end = s.indexOf('function renderDeliver() {');
if (start === -1 || end === -1) { console.log('NOT FOUND start=' + start + ' end=' + end); process.exit(1); }
s = s.substring(0, start) + newFunc + '\n\n' + s.substring(end);
fs.writeFileSync(target, s);
console.log('spliced new renderPages in place');
