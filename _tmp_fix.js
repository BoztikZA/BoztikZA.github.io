const fs = require('fs');
const p = 'd:/Boztik Website/deliver-v3/js/analytics-report.js';
let s = fs.readFileSync(p, 'utf8');
const block = '\n  line();\n  line("TRAFFIC SOURCES");\n  line("NOT AVAILABLE here. Sources (Google, Reddit, Direct, Social, Referral) exist only in GA4. The first-party counter deliberately records no referrer.");\n';
s = s.replace(block, '\n');
fs.writeFileSync(p, s);
console.log('done');
