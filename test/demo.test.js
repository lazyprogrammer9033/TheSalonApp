'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, setupOwner } = require('./helpers');
const { ensureDemoData } = require('../server/lib/demo-data');

test('demo mode signs in with manager / manager and fills a sample salon', async () => {
  const t = await startApp({ demo: true, requireLogin: true });
  try {
    const anon = t.client();
    const status = (await anon.get('/api/auth/status')).data;
    assert.equal(status.setupRequired, false);
    assert.equal(status.requireLogin, true);
    assert.deepEqual(status.demo, { username: 'manager', password: 'manager' });
    assert.equal((await anon.get('/api/customers?limit=1')).status, 401);

    await ensureDemoData(t.app, { log: () => {} });
    const c = t.client();
    assert.equal((await c.post('/api/auth/login', { username: 'manager', password: 'manager' })).status, 200);
    const me = (await c.get('/api/auth/status')).data.user;
    assert.equal(me.role, 'owner');
    const dash = (await c.get('/api/dashboard')).data;
    assert.ok(dash.monthSalesCents > 0, 'demo data has sales this month');
    assert.equal((await c.get('/api/settings')).data.business_name, 'Bella Salon & Spa');
    const customers = (await c.get('/api/customers?limit=5')).data;
    assert.ok(customers.total > 30);

    // A second start does not duplicate anything.
    const before = t.ctx.db().prepare('SELECT COUNT(*) c FROM visits').get().c;
    await ensureDemoData(t.app, { log: () => {} });
    assert.equal(t.ctx.db().prepare('SELECT COUNT(*) c FROM visits').get().c, before);
  } finally {
    await t.close();
  }
});

test('the demo account is not created outside demo mode', async () => {
  const t = await startApp();
  try {
    const c = t.client();
    assert.equal((await c.get('/api/auth/status')).data.demo, null);
    assert.equal((await c.post('/api/auth/login', { username: 'manager', password: 'manager' })).status, 401);
  } finally {
    await t.close();
  }
});

test('hiding a service keeps its price', async () => {
  const t = await startApp();
  try {
    const c = await setupOwner(t);
    const svc = (await c.get('/api/services')).data[0].services[0];
    assert.equal((await c.put('/api/services/' + svc.id, { active: false })).status, 200);
    const after = (await c.get('/api/services?all=1')).data[0].services.find((s) => s.id === svc.id);
    assert.equal(after.priceCents, svc.priceCents);
    assert.equal(after.active, 0);
    assert.equal((await c.put('/api/services/' + svc.id, { price: 52 })).status, 200);
    assert.equal((await c.get('/api/services?all=1')).data[0].services.find((s) => s.id === svc.id).priceCents, 5200);
  } finally {
    await t.close();
  }
});
