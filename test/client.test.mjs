import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import client from '../dist/client.js';
import device from '../dist/device.js';

const { NanoleafClient, NanoleafHttpError, requestToken } = client;
const { toHomeKitName } = device;

const TOKEN = 'testtoken';
const requests = [];
let pairingMode = false;
let server;
let port;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body });
      if (req.url === '/api/v1/new' && req.method === 'POST') {
        if (!pairingMode) {
          res.writeHead(403).end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ auth_token: TOKEN }));
        }
        return;
      }
      if (!req.url.startsWith(`/api/v1/${TOKEN}/`)) {
        res.writeHead(401).end();
        return;
      }
      const path = req.url.slice(`/api/v1/${TOKEN}`.length);
      if (path === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          name: 'Test', serialNo: 'S1', manufacturer: 'Nanoleaf', firmwareVersion: '1.0.0', model: 'NL00',
          state: { on: { value: true } },
          effects: { select: 'Forest', effectsList: ['Forest', 'Ocean'] },
        }));
      } else if ((path === '/effects' || path === '/state') && req.method === 'PUT') {
        res.writeHead(204).end();
      } else if (path.startsWith('/events')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        // Split a message across chunks and use CRLF line endings to exercise the parser.
        res.write('id: 1\r\ndata: {"events":[{"attr":1,"va');
        res.write('lue":false}]}\r\n\r\n');
        res.write('id: 3\ndata: {"events":[{"attr":1,"value":"Ocean"}]}\n\n');
        res.end('data: not an event\n\n');
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => server.close());

test('requestToken fails with 403 outside pairing mode and returns the token in pairing mode', async () => {
  pairingMode = false;
  await assert.rejects(requestToken('127.0.0.1', port), (err) => err instanceof NanoleafHttpError && err.status === 403);
  pairingMode = true;
  assert.equal(await requestToken('127.0.0.1', port), TOKEN);
});

test('getInfo returns the device state and scene list', async () => {
  const info = await new NanoleafClient('127.0.0.1', port, TOKEN).getInfo();
  assert.equal(info.effects.select, 'Forest');
  assert.deepEqual(info.effects.effectsList, ['Forest', 'Ocean']);
  assert.equal(info.state.on.value, true);
});

test('selectEffect and setOn send the expected requests', async () => {
  const c = new NanoleafClient('127.0.0.1', port, TOKEN);
  await c.selectEffect('Ocean');
  await c.setOn(false);
  const [select, state] = requests.slice(-2);
  assert.deepEqual(select, { method: 'PUT', url: `/api/v1/${TOKEN}/effects`, body: '{"select":"Ocean"}' });
  assert.deepEqual(state, { method: 'PUT', url: `/api/v1/${TOKEN}/state`, body: '{"on":{"value":false}}' });
});

test('an invalid token is reported as HTTP 401', async () => {
  await assert.rejects(
    new NanoleafClient('127.0.0.1', port, 'wrong').getInfo(),
    (err) => err instanceof NanoleafHttpError && err.status === 401,
  );
});

test('streamEvents parses split and CRLF messages and skips malformed ones', async () => {
  const received = [];
  await new NanoleafClient('127.0.0.1', port, TOKEN)
    .streamEvents([1, 3], (id, events) => received.push({ id, events }), new AbortController().signal);
  assert.deepEqual(received, [
    { id: 1, events: [{ attr: 1, value: false }] },
    { id: 3, events: [{ attr: 1, value: 'Ocean' }] },
  ]);
});

test('toHomeKitName removes characters HomeKit does not accept', () => {
  assert.equal(toHomeKitName('Northern Lights'), 'Northern Lights');
  assert.equal(toHomeKitName('Sunset 🌅'), 'Sunset');
  assert.equal(toHomeKitName('*Solid*'), 'Solid');
  assert.equal(toHomeKitName('Rock\'n\'Roll  #2'), 'Rock\'n\'Roll 2');
  assert.equal(toHomeKitName('Ébredés - reggel'), 'Ébredés - reggel');
  assert.equal(toHomeKitName('🎉🎉'), 'Nanoleaf Scene');
});
