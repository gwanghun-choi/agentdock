#!/usr/bin/env bash
# READ ONLY: GET and one HEAD. Prints status, size, time; never a request body.
B=https://agentdock-delta.vercel.app; n=0
g(){ n=$((n+1)); r=$(curl -s -o body.html -w '%{http_code} %{time_starttransfer} %{time_total} %{size_download}' "$B$1"); echo "$r $1"; sleep 0.4; }
x(){ python3 - "$@" <<'P'
import re,sys
s=open('body.html',errors='replace').read()
for p in sys.argv[1:]:
    m=re.findall(p,s); print('   ',p[:40],'→',len(m),[re.sub(r'<[^>]+>|\s+',' ',str(i))[:100] for i in m[:3]])
P
}
g /; x '<span class="chip-count">([^<]+)' 'indexed[^<]{0,40}' 'newest read ([0-9-]+)' 'last sync[^<]{0,50}' 'x-agentdock'
for t in skill plugin mcp_server command hook agent; do g "/artifacts?type=$t"; x 'pager-status[^>]*>([^<]+)' 'class="result-count[^>]*>[^<]*' '([0-9,]+) (?:artifacts|results)'; done
g "/artifacts"; x '([0-9,]+) (?:artifacts|results)' 'pager-status[^>]*>(.{0,60})'
g "/artifacts?lang=any"; x '([0-9,]+) (?:artifacts|results)'
g "/artifacts?lang=zh"; x '([0-9,]+) (?:artifacts|results)'
g "/artifacts?lang=ko"; x '([0-9,]+) (?:artifacts|results)'
g "/artifacts?lang=ja"; x '([0-9,]+) (?:artifacts|results)'
g "/artifacts?q=code%20review"; x '([0-9,]+) (?:artifacts|results)'
g "/artifacts?q=%EC%BD%94%EB%93%9C%20%EB%A6%AC%EB%B7%B0&lang=any"; x '([0-9,]+) (?:artifacts|results)'
g "/artifacts?q=%E4%BB%A3%E7%A0%81%E5%AE%A1%E6%9F%A5&lang=any"; x '([0-9,]+) (?:artifacts|results)'
g "/artifacts?q=zzzzqqqqxxxx"; x '([0-9,]+) (?:artifacts|results)' 'No [a-z ]{0,40}match[^<]{0,50}' 'class="notice[^>]*>.{0,80}'
g "/artifacts?sort=name"; x 'row-title[^>]*><a[^>]*>([^<]+)'
g "/artifacts?sort=stars"; x 'row-title[^>]*><a[^>]*>([^<]+)'
g "/artifacts?sort=bogus"; g "/artifacts?page=2"; x 'pager-status[^>]*>(.{0,60})'
g "/artifacts?page=999999"; x 'no page[^<]{0,30}|There is no page[^<]{0,30}'
g "/artifacts?page=-1"; g "/artifacts?page=abc"; g "/artifacts?type=bogus"; g "/artifacts?lang=xx"
# Security inputs: reflected? The body is only searched for an unescaped copy.
g "/artifacts?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"; x '<script>alert\(1\)' '&lt;script&gt;alert'
g "/artifacts?q=%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E"; x '<img src=x' 'onerror=alert\(1\)"' 
g "/artifacts?type=%22%3E%3Csvg%20onload%3Dalert(1)%3E"; x '<svg onload'
g "/artifacts?q=$(python3 -c 'print("a"*5000)')"
g "/artifacts?q=%27%3B%20select%20pg_sleep(5)--"
g "/r/%00/%00"; g "/r/..%2f..%2fetc/passwd"; g "/r/nobody/nothing"; g "/jobs/1"; g "/jobs/999999"; g "/jobs/abc"
g /api; g /api/health; g /api/packages; g /api/search?q=a; g /.env; g /.git/config; g /package.json; g /next.config.ts; g /robots.txt; g /sitemap.xml; g /favicon.ico
g "/_next/image?url=%2Ffavicon.ico&w=64&q=75"; g "/_next/image?url=https%3A%2F%2Fexample.com%2Fa.png&w=64&q=75"
g /skills
echo "requests=$n"
