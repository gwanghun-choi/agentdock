import json,sys,statistics as st
rows=[]
for f in sys.argv[1:]:
    for l in open(f): rows.append(json.loads(l))
g={}
for r in rows:
    # taskset 2-core runs come first of each triple; label by order is lost, so keep file order
    g.setdefault((r['label'],r['type'],r['mode'],r['size']),[]).append(r)
for k,v in g.items():
    chunks=[(x.get('js') or {}) for x in v]
    if k[1]=='chromium' and k[2]=='software' and k[3]=='wide':
        parts=[('2core',v[0::2]),('allcore',v[1::2])]
    else: parts=[('',v)]
    for name,p in parts:
        if not p: continue
        m=lambda f:st.median(f(x) for x in p)
        print(k[0],k[1],k[2],k[3],name,'n',len(p),'scene',p[-1]['scene'],'->',p[-1]['scene2'],'liveAt',[x['liveAt'] for x in p],'fps',round(m(lambda x:x['live']['fps']),1),'draws/s',m(lambda x:x['live']['drawsPerSec']),'tris/s',m(lambda x:x['live']['trisPerSec']),'busy',m(lambda x:x['machineBusyCores']),'rest3s',[x['rest']['drawsIn3s'] for x in p],'heapMB',p[-1]['page']['heapMB'],'ctx',p[-1]['page']['contexts'],'canvas',p[-1]['page']['canvases'],'jsKB',round(p[-1]['js']['bytes']/1024),'jsMaxKB',round(p[-1]['js']['biggest']/1024),'btn',p[-1]['page']['button'],'err',len(p[-1]['errors']),'fcp',round(p[-1]['page']['fcp'] or 0))
