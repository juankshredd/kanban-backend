'use strict';

const lines = (...ls) => ls.join('\n');

function request(name, method, url, opts = {}) {
  const req = {
    method,
    header: opts.header ? opts.header.slice() : [],
    url,
  };

  if (opts.auth) req.auth = opts.auth;

  if (opts.body !== undefined) {
    req.header.push({ key: 'Content-Type', value: 'application/json' });
    req.body = {
      mode: 'raw',
      raw: JSON.stringify(opts.body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  if (opts.description) req.description = opts.description;

  const item = { name, request: req, response: [] };

  const events = [];
  if (opts.prerequest) {
    events.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: opts.prerequest.split('\n') } });
  }
  if (opts.tests) {
    events.push({ listen: 'test', script: { type: 'text/javascript', exec: opts.tests.split('\n') } });
  }
  if (events.length) item.event = events;

  return item;
}

function folder(name, items, opts = {}) {
  const f = { name, item: items };
  if (opts.auth) f.auth = opts.auth;
  if (opts.description) f.description = opts.description;
  return f;
}

const noAuth = { type: 'noauth' };
const asUserA = { type: 'bearer', bearer: [{ key: 'token', value: '{{userAToken}}', type: 'string' }] };
const asUserB = { type: 'bearer', bearer: [{ key: 'token', value: '{{userBToken}}', type: 'string' }] };
const asUserC = { type: 'bearer', bearer: [{ key: 'token', value: '{{userCToken}}', type: 'string' }] };
const withBadToken = { type: 'bearer', bearer: [{ key: 'token', value: 'not.a.valid.jwt', type: 'string' }] };

const status = (code) => `pm.test('Status code is ${code}', function () { pm.response.to.have.status(${code}); });`;
const hasProp = (varName, prop) =>
  `pm.test('Response has property "${prop}"', function () { pm.expect(${varName}).to.have.property('${prop}'); });`;
const messageIsString = () =>
  `pm.test('Error response has a message string', function () { const body = pm.response.json(); pm.expect(body).to.have.property('message'); pm.expect(typeof body.message).to.eql('string'); });`;
const bodyVar = 'const body = pm.response.json();';

module.exports = {
  lines,
  request,
  folder,
  noAuth,
  asUserA,
  asUserB,
  asUserC,
  withBadToken,
  status,
  hasProp,
  messageIsString,
  bodyVar,
};
