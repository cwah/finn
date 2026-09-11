// Chrome DevTools Protocol against the Android emulator, over `adb forward`.
//
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   node cdp.mjs eval    "expression"     # evaluate in the page
//   node cdp.mjs gesture "expression"     # same, but as a user gesture
//   node cdp.mjs push                     # deliver a bodiless push to the service worker
//   node cdp.mjs targets                  # list what is open
//
// CDP_PORT picks which localhost page to attach to (default 8099, the container).
// Node's WebSocket is built in, so this needs nothing installed.

const [, , mode = 'targets', ...rest] = process.argv;
const WANT = process.env.CDP_PORT || '8099';

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
if (mode === 'targets') {
  for (const t of list) console.log(`${t.type.padEnd(16)} ${t.url}`);
  process.exit(0);
}

// The page target, NOT the browser target — ServiceWorker.deliverPushMessage lives here.
const page = list.find((t) => t.type === 'page' && t.url.includes(`:${WANT}`))
  || list.find((t) => t.type === 'page' && /localhost:\d+/.test(t.url));
if (!page) { console.error(`no page on :${WANT}. Try: node cdp.mjs targets`); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method, params }));
});
await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else if (m.method) events.push(m);
};

if (mode === 'eval' || mode === 'gesture') {
  const out = await send('Runtime.evaluate', {
    expression: rest.join(' '),
    awaitPromise: true,
    returnByValue: true,
    // A permission request is only honoured from a gesture; CDP can assert one. NOTE that
    // the prompt then blocks on-screen until something taps Allow, so this call will hang
    // unless permission is already granted for THIS origin.
    userGesture: mode === 'gesture',
  });
  console.log(JSON.stringify(
    out.exceptionDetails ? { error: out.exceptionDetails.text, detail: out.result?.description }
      : out.result.value, null, 2));
} else if (mode === 'push') {
  await send('ServiceWorker.enable');
  await new Promise((r) => setTimeout(r, 1500));
  const regs = events
    .filter((e) => e.method === 'ServiceWorker.workerRegistrationUpdated')
    .flatMap((e) => e.params.registrations || []);
  const reg = regs.find((r) => r.scopeURL.includes(`:${WANT}`)) || regs[0];
  if (!reg) { console.error('no service worker registration'); process.exit(1); }
  // Bodiless, exactly as the server sends it.
  await send('ServiceWorker.deliverPushMessage', {
    origin: new URL(reg.scopeURL).origin, registrationId: reg.registrationId, data: '',
  });
  console.log(`push delivered to ${reg.scopeURL}`);
  await new Promise((r) => setTimeout(r, 2500));
}
ws.close();
