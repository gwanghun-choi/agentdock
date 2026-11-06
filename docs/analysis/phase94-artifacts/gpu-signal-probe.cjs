// usage: node gpu-signal-probe.cjs  — what each browser says about its renderer, on a blank page.
const pw = require('/home/ChoiGwanghun/workspace_auto/agentdock/node_modules/@playwright/test');
const probe = () => {
  const c = (o) => document.createElement('canvas').getContext('webgl2', o);
  const plain = c(); const strict = c({ failIfMajorPerformanceCaveat: true });
  const i = plain?.getExtension('WEBGL_debug_renderer_info');
  const out = { webgl2: !!plain, caveatStrict: !!strict, renderer: i ? String(plain.getParameter(i.UNMASKED_RENDERER_WEBGL)) : plain ? 'extension absent' : null, masked: plain ? String(plain.getParameter(plain.RENDERER)) : null, cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null };
  plain?.getExtension('WEBGL_lose_context')?.loseContext(); strict?.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
};
const SW = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const GPU = ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
(async () => {
  for (const [name, type, args] of [['chromium default headless', 'chromium', []], ['chromium swiftshader', 'chromium', SW], ['chromium vulkan gpu', 'chromium', GPU], ['chromium webgl disabled', 'chromium', ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis']], ['firefox', 'firefox', []], ['webkit', 'webkit', []]]) {
    const b = await pw[type].launch({ args });
    const p = await b.newPage(); await p.goto('about:blank');
    console.log(name.padEnd(28), JSON.stringify(await p.evaluate(probe)));
    await b.close();
  }
})();
