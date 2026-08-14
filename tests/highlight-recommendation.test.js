const test = require('node:test');
const assert = require('node:assert/strict');
const { rankHighlights } = require('../services/highlightRecommendation.service');

const videos = [
  { youtubeId:'aaaaaaaaaaa', title:'Ferrari', channel:'FORMULA 1', type:'onboard', teams:['Ferrari'], drivers:['Charles Leclerc'], publishedAt:'2026-01-01' },
  { youtubeId:'bbbbbbbbbbb', title:'McLaren', channel:'FORMULA 1', type:'race-highlight', teams:['McLaren'], drivers:['Lando Norris'], publishedAt:'2026-01-02' },
  { youtubeId:'ccccccccccc', title:'Generic', channel:'FORMULA 1', type:'race-highlight', teams:[], drivers:[], publishedAt:'2026-01-03' }
];

test('favourite driver and team content is ranked first', () => {
  const [first] = rankHighlights({
    preferences: { favouriteTeam:'Ferrari', favouriteDriver:'Charles Leclerc' },
    videos,
    limit: 3,
    seed: 'fan'
  });

  assert.equal(first.youtubeId, 'aaaaaaaaaaa');
  assert.match(first.reason, /Charles Leclerc/);
});

test('dismissed content is pushed out of a limited result set', () => {
  const result = rankHighlights({
    preferences: { favouriteTeam:'Ferrari' },
    activity: [{ videoId:'aaaaaaaaaaa', event:'dismiss', count:1 }],
    videos,
    limit: 2,
    seed: 'fan'
  });

  assert.equal(result.some(video => video.youtubeId === 'aaaaaaaaaaa'), false);
});

test('guest history reduces repeated videos', () => {
  const [first] = rankHighlights({ videos, guestSeen:['ccccccccccc'], limit:1, seed:'guest' });
  assert.notEqual(first.youtubeId, 'ccccccccccc');
});
