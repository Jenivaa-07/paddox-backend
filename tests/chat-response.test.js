const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeQuestion, normalizeChatPayload } = require('../controllers/chat.controller');

test('chat question is bounded and control characters are removed', () => {
  assert.equal(normalizeQuestion('  What is\u0000 an undercut?  '), 'What is an undercut?');
  assert.equal(normalizeQuestion('x'.repeat(700)).length, 600);
  assert.equal(normalizeQuestion({ query: 'not a string' }), '');
});

test('grounded response keeps verified source metadata', () => {
  const result = normalizeChatPayload({
    answer: 'An undercut is an earlier pit stop to gain time on fresh tyres.',
    grounded: true,
    sources: [{ source: 'f1_terminology.md', version: '1.0.0', date: '2026-07-30' }],
    request_id: 'req-1',
  });

  assert.equal(result.grounded, true);
  assert.equal(result.sources[0].title, 'Curated F1 Terminology');
  assert.equal(result.requestId, 'req-1');
});

test('response cannot claim grounding without a retrieved source', () => {
  const result = normalizeChatPayload({ answer: 'Unsupported answer', grounded: true, sources: [] });
  assert.equal(result.grounded, false);
  assert.deepEqual(result.sources, []);
});
