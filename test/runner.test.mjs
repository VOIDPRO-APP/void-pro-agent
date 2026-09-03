import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, execute, identityToken, ENDPOINT, AUDIENCE } from '../runner-core.mjs';
const task = '74cde117-ccfe-41ed-88c5-e082ac6e1e42';
const requestId = '70cfc35a-e6ab-4d0f-9909-0fc3b0c4f204';
test('sends only opaque identifiers to fixed server, never provider data', async () => {
  const output = await advance(task, requestId, { token: async () => 'test.jwt.sig', fetcher: async (url, options) => {
    assert.equal(url, ENDPOINT);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { action: 'advance', taskId: task, requestId });
    return Response.json({ taskId: task, status: 'completed', done: true, sequence: 3, model: 'must-not-leak', message: '::error injected' });
  }});
  assert.deepEqual(output, { taskId: task, status: 'completed', done: true, sequence: 3 });
});
test('rejects task injection before any network call', async () => {
  await assert.rejects(advance('$(cat secret)', requestId), /TASK_INVALID/);
});
test('uncertain response retries the SAME operation id', async () => {
  let calls = 0; const identifiers = [];
  const result = await execute(task, { sleep: async () => {}, log: () => {}, uuid: () => requestId,
    advance: async (_, id) => {
      identifiers.push(id);
      if (++calls === 1) throw new TypeError('transport');
      return { done: true, status: 'completed', sequence: 1 };
    },
  });
  assert.equal(result, 'completed'); assert.deepEqual(identifiers, [requestId, requestId]);
});
test('permanent rejection is not retried; response bodies do not leak', async () => {
  await assert.rejects(advance(task, requestId, { token: async () => 'jwt', fetcher: async () => new Response('secret-provider-message', { status: 403 }) }), /^Error: VOID_PRO_EXECUTION_REFUSED$/);
});
test('mismatching or oversized responses fail closed', async () => {
  for (const response of [Response.json({ taskId: requestId, status: 'completed', done: true, sequence: 1 }), new Response('x'.repeat(20000))]) {
    await assert.rejects(advance(task, requestId, { token: async () => 'jwt', fetcher: async () => response }), /RESPONSE_INVALID/);
  }
});
test('OIDC is audience bound and request cannot follow redirects', async () => {
  await identityToken({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://test.actions.githubusercontent.com/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private' }, async (url, options) => {
    assert.equal(url.searchParams.get('audience'), AUDIENCE); assert.equal(options.redirect, 'error');
    return Response.json({ value: 'a.b.c' });
  });
  await assert.rejects(identityToken({ ACTIONS_ID_TOKEN_REQUEST_URL: 'https://attacker.example/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'private' }), /IDENTITY_UNAVAILABLE/);
});
test('supports many persisted steps without one long request', async () => {
  let calls = 0;
  assert.equal(await execute(task, { sleep: async () => {}, log: () => {}, uuid: () => requestId,
    advance: async () => ({ status: ++calls >= 150 ? 'completed' : 'reading', done: calls >= 150, sequence: calls }),
  }), 'completed');
  assert.equal(calls, 150);
});
