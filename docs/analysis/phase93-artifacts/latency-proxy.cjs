// usage: node latency-proxy.cjs <listenPort> <rttMs> [resumeMs=0] [idleMs=5000]
// TCP proxy to the test PostgreSQL. Delays every chunk rtt/2 each way, and when
// no connection has been open for idleMs holds new connections for resumeMs: a
// stand-in for a network hop and a scale-to-zero database waking. Not a model of
// Neon's compute speed.
const net = require('net');
const [port, rtt, resume = '0', idle = '5000'] = process.argv.slice(2);
const half = +rtt / 2; let open = 0; let lastClose = 0; let wakeUntil = 0;
net.createServer((c) => {
  c.pause(); c.on('error', () => {});
  const now = Date.now();
  if (+resume && open === 0 && now - lastClose > +idle && now > wakeUntil) wakeUntil = now + +resume;
  open++;
  c.on('close', () => { if (--open === 0) lastClose = Date.now(); });
  setTimeout(() => {
    const u = net.connect(55432, '127.0.0.1');
    u.on('error', () => c.destroy());
    const pipe = (a, b) => {
      a.on('data', (d) => (half ? setTimeout(() => b.writable && b.write(d), half) : b.write(d)));
      a.on('close', () => setTimeout(() => b.destroy(), half));
    };
    pipe(c, u); pipe(u, c); c.resume();
  }, Math.max(0, wakeUntil - now));
}).listen(+port, '127.0.0.1');
