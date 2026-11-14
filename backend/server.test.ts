import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from './server.ts';

test('one listener serves both frontends, assets and APIs', async (t) => {
  const server = createAppServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  for (const path of ['/', '/styles.css', '/app.js', '/lending/', '/lending/styles.css', '/lending/app.js', '/insurance/status', '/health']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    await response.text();
  }
  const response = await fetch(base + '/applications', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ demoConsent: true, pan: 'ABCDE1234F', phone: '9876543210' }),
  });
  assert.equal(response.status, 201);
  assert.ok((await response.json()).id);
});
