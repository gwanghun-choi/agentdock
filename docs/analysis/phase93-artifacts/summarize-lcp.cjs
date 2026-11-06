// usage: node summarize-lcp.cjs <jsonl>...  median and range per condition
const fs=require('fs');const med=a=>{a=[...a].sort((x,y)=>x-y);return a[Math.floor((a.length-1)/2)]};
for(const f of process.argv.slice(2)){const g={};for(const l of fs.readFileSync(f,'utf8').trim().split('\n')){const r=JSON.parse(l);(g[r.label]||=[]).push(r)}
for(const[k,rs]of Object.entries(g)){const lcp=rs.map(r=>r.lcp.at(-1).t),h=rs.map(r=>r.nav.finalHead||r.nav.ttfb),fcp=rs.map(r=>r.paint['first-contentful-paint']),cls=rs.map(r=>r.cls);
console.log(f.split('/').pop().padEnd(18),k.padEnd(14),'n='+rs.length,'head',med(h),'fcp',med(fcp),'lcp',Math.round(med(lcp)),'['+Math.round(Math.min(...lcp))+'-'+Math.round(Math.max(...lcp))+']',rs[0].lcp.at(-1).el,'cls max',Math.max(...cls).toFixed(4),'errors',rs.flatMap(r=>r.errors).length)}}
