const catalog = require('../data/highlightCatalog');

const POSITIVE_EVENTS = new Set(['play', 'like', 'complete']);
const VALID_EVENTS = new Set(['impression', 'play', 'like', 'complete', 'dismiss']);

function clean(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matches(value, candidates = []) {
  const needle = clean(value);
  return !!needle && candidates.some(candidate => {
    const haystack = clean(candidate);
    return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
  });
}

function stableTieBreaker(seed = '', id = '') {
  return `${seed}:${id}`.split('').reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 7) % 1000;
}

function activityMap(activity = []) {
  return new Map(activity.map(item => [String(item.videoId || ''), item]));
}

function preferredTypes(activity = [], videos = catalog) {
  const typeByVideo = new Map(videos.map(video => [video.youtubeId, video.type]));
  const scores = new Map();

  activity.forEach(item => {
    if (!POSITIVE_EVENTS.has(item.event)) return;
    const type = typeByVideo.get(String(item.videoId || ''));
    if (!type) return;
    scores.set(type, (scores.get(type) || 0) + Math.max(1, Number(item.count || 1)));
  });

  return scores;
}

function reasonFor(video, preferences = {}) {
  if (matches(preferences.favouriteDriver, video.drivers)) {
    return `Because you follow ${preferences.favouriteDriver}`;
  }
  if (matches(preferences.favouriteTeam, video.teams)) {
    return `Picked for ${preferences.favouriteTeam} fans`;
  }
  return video.type === 'race-highlight' ? 'Fresh race action' : 'From the official F1 channel';
}

function rankHighlights({ preferences = {}, activity = [], guestSeen = [], limit = 6, seed = 'guest', videos = catalog } = {}) {
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 6));
  const byVideo = activityMap(activity);
  const guestSeenSet = new Set((guestSeen || []).map(String));
  const typeAffinity = preferredTypes(activity, videos);
  const newest = Math.max(...videos.map(video => new Date(video.publishedAt).getTime() || 0));

  return videos
    .map(video => {
      const interaction = byVideo.get(video.youtubeId);
      const ageDays = Math.max(0, (newest - new Date(video.publishedAt).getTime()) / 86400000);
      let score = Math.max(0, 18 - Math.floor(ageDays / 30));

      if (matches(preferences.favouriteTeam, video.teams)) score += 40;
      if (matches(preferences.favouriteDriver, video.drivers)) score += 55;
      score += Math.min(20, (typeAffinity.get(video.type) || 0) * 4);

      if (interaction?.event === 'dismiss') score -= 100;
      else if (interaction && ['play', 'complete'].includes(interaction.event)) score -= 35;
      if (guestSeenSet.has(video.youtubeId)) score -= 35;

      score += stableTieBreaker(seed, video.youtubeId) / 1000;

      return {
        ...video,
        score,
        reason: reasonFor(video, preferences),
        thumbnail: `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`,
        watchUrl: `https://www.youtube.com/watch?v=${video.youtubeId}`
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, safeLimit)
    .map(({ score, ...video }) => video);
}

module.exports = { VALID_EVENTS, rankHighlights };
