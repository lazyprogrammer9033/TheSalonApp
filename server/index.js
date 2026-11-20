'use strict';

const path = require('path');
const https = require('https');
const { createApp } = require('./app');
const { createPublicApp } = require('./public-app');
const { ensureCertificates, localNames } = require('./lib/tls');
const { ensureDemoData } = require('./lib/demo-data');

const port = Number(process.env.PORT || 4000);
const httpsPort = Number(process.env.HTTPS_PORT || 4443);
const host = process.env.HOST || '0.0.0.0';
// Demo mode (the default for The Salon App sales demo): sign in with
// manager / manager and start with a sample salon full of data.
// Set DEMO=0 to start a real salon with an empty database instead.
const demo = process.env.DEMO !== '0';
const app = createApp({
  demo,
  requireLogin: demo ? true : undefined,
  sampleServices: demo,
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : undefined,
  secureCookies: process.env.SECURE_COOKIES === '1',
  trustProxy: process.env.TRUST_PROXY === '1' ? true : 'loopback',
});

// https runs beside http so the iPad can keep the app for offline use.
const secure = process.env.HTTPS === '0' ? null : ensureCertificates(app.locals.ctx.dataDir);
app.locals.ctx.https = secure ? { port: httpsPort } : null;

const servers = [];

function listen() {
  servers.push(app.listen(port, host, () => {
    const { dns, ips } = localNames();
    const lan = ips.filter((ip) => ip !== '127.0.0.1');
    console.log(`\n  The Salon App is running.\n`);
    console.log(`  On this computer:   http://localhost:${port}`);
    console.log(`  On the iPad (Wi-Fi): http://${dns[2]}:${port}`);
    for (const a of lan) console.log(`                   or http://${a}:${port}`);
    if (secure) {
      console.log(`\n  iPad with offline mode (after the one-time certificate step in the README):`);
      console.log(`                      https://${dns[2]}:${httpsPort}`);
      for (const a of lan) console.log(`                   or https://${a}:${httpsPort}`);
    }
    console.log(`\n  Data folder:        ${app.locals.ctx.dataDir}`);
    if (demo) console.log(`  Demo sign-in:       username "manager", password "manager"`);
    console.log('');
  }));
  if (secure) {
    const s = https.createServer({ key: secure.key, cert: secure.cert }, app);
    s.on('error', (e) => console.warn(`  Secure (https) access is off: ${e.message}`));
    servers.push(s.listen(httpsPort, host));
  }
}

function listenPublic() {
  // The customer page (confirm / cancel / change a booking) has its own port on
  // this computer only. A tunnel such as Cloudflare Tunnel points here, so the
  // internet can reach these pages and nothing else in the app.
  const publicPort = Number(process.env.PUBLIC_PORT || 4080);
  const publicServer = createPublicApp(app.locals.ctx).listen(publicPort, '127.0.0.1', () => {
    console.log(`  Customer booking page (for the tunnel only): http://127.0.0.1:${publicPort}\n`);
  });
  publicServer.on('error', (e) => console.warn(`  Customer booking page is off: ${e.message}`));
  servers.push(publicServer);
}

async function start() {
  if (demo) {
    try {
      await ensureDemoData(app);
    } catch (e) {
      console.warn(`  Could not prepare the demo data: ${e.message}`);
    }
  }
  listen();
  listenPublic();
}

function shutdown() {
  let open = servers.length;
  if (!open) process.exit(0);
  for (const s of servers) s.close(() => --open === 0 && (app.locals.close(), process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
