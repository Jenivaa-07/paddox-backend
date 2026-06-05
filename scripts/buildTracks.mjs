// scripts/buildTracks.mjs
// PADDOX — Coordinate-Derived Track SVG Generator
// STAGE 1: real coordinates      [ [lng, lat], ... ]      from OSM/Overpass or manual fallback
// STAGE 2: normalized svgPoints  [ { x, y }, ... ]        projected + simplified + centered
// STAGE 3: detailedPath          "M x y L x y ..."       final SVG path string
//
// Data attribution: © OpenStreetMap contributors (ODbL) for OSM-derived data.
// Keep attribution visible wherever these generated maps are displayed publicly.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

const OUT_DIR = "../paddox-frontend/data";
const PREVIEW_DIR = "../paddox-frontend/previews";
const VIEWBOX = { W: 300, H: 180, pad: 22 };
const REQUEST_DELAY_MS = 1600;

/* ════════════════════════════════════════════════════════════════
   OPTIONAL MANUAL FALLBACKS

   Create this file in frontend repo:

   paddox-frontend/data/manualTrackCoordinates.js

   Example:

   export const manualTrackCoordinates = {
     monaco: [
       [7.42, 43.73],
       [7.421, 43.731]
     ]
   };

   Manual data is useful for street circuits where OSM may not tag the full
   race route as highway=raceway.
════════════════════════════════════════════════════════════════ */

async function loadManualCoordinates(){
  const manualPath = path.resolve("../paddox-frontend/data/manualTrackCoordinates.js");

  if(!existsSync(manualPath)) return {};

  try{
    const fileUrl = pathToFileURL(manualPath).href + `?t=${Date.now()}`;
    const mod = await import(fileUrl);
    return mod.manualTrackCoordinates || {};
  }catch(e){
    console.warn("Could not load manualTrackCoordinates.js:", e.message);
    return {};
  }
}

/* ════════════════════════════════════════════════════════════════
   STAGE 1 — Fetch ordered coordinate list from Overpass
════════════════════════════════════════════════════════════════ */

function escapeOverpassRegex(value){
  return String(value).replace(/[\\"']/g, "\\$&");
}

async function fetchCoordinates(circuit){
  const { search, bbox } = circuit;
  const [s, w, n, e] = bbox;
  const safeSearch = escapeOverpassRegex(search);

  // Keep requests small. Big combined relation queries often return 406/504 on public Overpass servers.
  const queries = [
    `
[out:json][timeout:45];
way["highway"="raceway"]["name"~"${safeSearch}",i](${s},${w},${n},${e});
(._;>;);
out body;
`,
    `
[out:json][timeout:45];
way["highway"="raceway"](${s},${w},${n},${e});
(._;>;);
out body;
`
  ];

  let lastError = null;

  for(const query of queries){
    for(const endpoint of OVERPASS_ENDPOINTS){
      try{
        const data = await requestOverpass(endpoint, query);
        const coordinates = osmToOrderedCoordinates(data);

        if(coordinates && coordinates.length >= 10){
          return coordinates;
        }
      }catch(error){
        lastError = error;
        console.log(`\n  source failed: ${endpoint} → ${error.message}`);
        await sleep(1800);
      }
    }
  }

  throw lastError || new Error("All Overpass endpoints failed");
}

async function requestOverpass(endpoint, query){
  const body = new URLSearchParams({ data: query }).toString();

  try{
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "application/json"
      },
      body
    });

    if(response.ok){
      return await response.json();
    }

    const errorText = await response.text().catch(() => "");
    throw new Error(`POST ${response.status} ${cleanError(errorText)}`);
  }catch(postError){
    const url = `${endpoint}?data=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if(response.ok){
      return await response.json();
    }

    const errorText = await response.text().catch(() => "");
    throw new Error(`POST failed: ${postError.message} | GET ${response.status} ${cleanError(errorText)}`);
  }
}

function cleanError(text){
  return String(text || "")
    .replace(/\s+/g, " ")
    .slice(0, 140);
}

function osmToOrderedCoordinates(data){
  const nodes = new Map();
  const wayCandidates = [];

  for(const el of data.elements || []){
    if(el.type === "node"){
      nodes.set(el.id, [el.lon, el.lat]);
    }

    if(el.type === "way" && Array.isArray(el.nodes)){
      const tags = el.tags || {};
      const isRaceway = tags.highway === "raceway";
      const hasName = Boolean(tags.name);

      if(isRaceway){
        wayCandidates.push({
          nodes: el.nodes.slice(),
          tags,
          score: hasName ? 2 : 1
        });
      }
    }
  }

  if(!wayCandidates.length) return null;

  wayCandidates.sort((a, b) => {
    return (b.score - a.score) || (b.nodes.length - a.nodes.length);
  });

  let chain = wayCandidates.shift().nodes.slice();
  let progress = true;

  while(wayCandidates.length && progress){
    progress = false;

    const head = chain[0];
    const tail = chain[chain.length - 1];

    let bestIndex = -1;
    let bestMode = null;
    let bestLen = -1;

    for(let i = 0; i < wayCandidates.length; i++){
      const way = wayCandidates[i].nodes;
      const wayHead = way[0];
      const wayTail = way[way.length - 1];
      const len = way.length;

      if(wayTail === head && len > bestLen){
        bestIndex = i;
        bestMode = "prepend";
        bestLen = len;
      }

      if(wayHead === head && len > bestLen){
        bestIndex = i;
        bestMode = "prependReverse";
        bestLen = len;
      }

      if(wayHead === tail && len > bestLen){
        bestIndex = i;
        bestMode = "append";
        bestLen = len;
      }

      if(wayTail === tail && len > bestLen){
        bestIndex = i;
        bestMode = "appendReverse";
        bestLen = len;
      }
    }

    if(bestIndex >= 0){
      const way = wayCandidates.splice(bestIndex, 1)[0].nodes;

      if(bestMode === "prepend"){
        chain = way.concat(chain.slice(1));
      }

      if(bestMode === "prependReverse"){
        chain = way.slice().reverse().concat(chain.slice(1));
      }

      if(bestMode === "append"){
        chain = chain.concat(way.slice(1));
      }

      if(bestMode === "appendReverse"){
        chain = chain.concat(way.slice().reverse().slice(1));
      }

      progress = true;
    }
  }

  const coordinates = chain.map(id => nodes.get(id)).filter(Boolean);
  return coordinates.length >= 10 ? dedupeCoordinates(coordinates) : null;
}

function dedupeCoordinates(coordinates){
  const output = [];

  for(const coordinate of coordinates){
    const last = output[output.length - 1];

    if(!last || last[0] !== coordinate[0] || last[1] !== coordinate[1]){
      output.push(coordinate);
    }
  }

  return output;
}

/* ════════════════════════════════════════════════════════════════
   STAGE 2 — Convert coordinates → normalized SVG points
════════════════════════════════════════════════════════════════ */

function coordinatesToSvgPoints(coordinates, options = {}){
  const {
    W = VIEWBOX.W,
    H = VIEWBOX.H,
    pad = VIEWBOX.pad,
    simplify = 0.6
  } = options;

  if(!coordinates || coordinates.length < 2) return [];

  const lat0 = coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length;
  const R = 6378137;
  const rad = Math.PI / 180;

  let planar = coordinates.map(([lng, lat]) => ({
    x: R * lng * rad * Math.cos(lat0 * rad),
    y: -R * lat * rad
  }));

  planar = rdp(planar, metersEps(planar, simplify));

  const xs = planar.map(point => point.x);
  const ys = planar.map(point => point.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;

  const scale = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
  const ox = (W - bw * scale) / 2 - minX * scale;
  const oy = (H - bh * scale) / 2 - minY * scale;

  return planar.map(point => ({
    x: round2(point.x * scale + ox),
    y: round2(point.y * scale + oy)
  }));
}

function metersEps(planar, knob){
  const xs = planar.map(point => point.x);
  const ys = planar.map(point => point.y);

  const diag = Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys)
  ) || 1;

  return (diag / 300) * knob;
}

function rdp(points, eps){
  if(points.length < 3) return points;

  const start = points[0];
  const end = points[points.length - 1];

  let index = -1;
  let maxDistance = 0;

  for(let i = 1; i < points.length - 1; i++){
    const distance = perpendicularDistance(points[i], start, end);

    if(distance > maxDistance){
      maxDistance = distance;
      index = i;
    }
  }

  if(maxDistance > eps){
    const left = rdp(points.slice(0, index + 1), eps).slice(0, -1);
    const right = rdp(points.slice(index), eps);
    return left.concat(right);
  }

  return [start, end];
}

function perpendicularDistance(point, start, end){
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1e-9;

  return Math.abs(
    dx * (start.y - point.y) -
    dy * (start.x - point.x)
  ) / length;
}

/* ════════════════════════════════════════════════════════════════
   STAGE 3 — Build SVG paths
════════════════════════════════════════════════════════════════ */

function buildLinePath(svgPoints, shouldClose = true){
  if(!svgPoints.length) return "";

  let d = `M ${svgPoints[0].x} ${svgPoints[0].y}`;

  for(let i = 1; i < svgPoints.length; i++){
    d += ` L ${svgPoints[i].x} ${svgPoints[i].y}`;
  }

  return d + (shouldClose && isClosedLoop(svgPoints) ? " Z" : "");
}

function buildSmoothPath(svgPoints, shouldClose = true){
  if(svgPoints.length < 2) return "";

  const closed = shouldClose && isClosedLoop(svgPoints);
  const points = closed ? svgPoints.concat([svgPoints[0]]) : svgPoints.slice();

  let d = `M ${points[0].x} ${points[0].y} `;

  for(let i = 0; i < points.length - 1; i++){
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += `C ${round2(c1x)} ${round2(c1y)} ${round2(c2x)} ${round2(c2y)} ${p2.x} ${p2.y} `;
  }

  return d.trim() + (closed ? " Z" : "");
}

function isClosedLoop(points){
  if(points.length < 3) return false;

  const first = points[0];
  const last = points[points.length - 1];

  return Math.hypot(first.x - last.x, first.y - last.y) < 8;
}

/* ════════════════════════════════════════════════════════════════
   Distance-based markers
════════════════════════════════════════════════════════════════ */

function markersFromDistance(svgPoints, startOffset = 0){
  const points = rotatePoints(svgPoints, startOffset);
  const distances = cumulativeDistances(points);
  const total = distances[distances.length - 1] || 1;
  const at = fraction => interpolateAtDistance(points, distances, total * fraction);

  return {
    startFinish: at(0),
    sectors: [
      { label: "S1", ...at(0.333) },
      { label: "S2", ...at(0.666) },
      { label: "S3", ...at(0.86) }
    ]
  };
}

function rotatePoints(points, offset = 0){
  if(!points.length || !offset) return points.slice();

  const index = Math.max(
    0,
    Math.min(points.length - 1, Math.floor(offset * points.length))
  );

  return points.slice(index).concat(points.slice(0, index));
}

function cumulativeDistances(points){
  const distances = [0];

  for(let i = 1; i < points.length; i++){
    const previous = points[i - 1];
    const current = points[i];

    distances.push(
      distances[i - 1] + Math.hypot(current.x - previous.x, current.y - previous.y)
    );
  }

  if(isClosedLoop(points)){
    const first = points[0];
    const last = points[points.length - 1];
    distances[distances.length - 1] += Math.hypot(first.x - last.x, first.y - last.y);
  }

  return distances;
}

function interpolateAtDistance(points, distances, target){
  for(let i = 1; i < distances.length; i++){
    if(distances[i] >= target){
      const previousDistance = distances[i - 1];
      const span = distances[i] - previousDistance || 1;
      const t = (target - previousDistance) / span;

      return {
        x: round2(points[i - 1].x + (points[i].x - points[i - 1].x) * t),
        y: round2(points[i - 1].y + (points[i].y - points[i - 1].y) * t)
      };
    }
  }

  const point = points[points.length - 1] || { x: 0, y: 0 };

  return {
    x: point.x,
    y: point.y
  };
}

const round2 = value => +Number(value).toFixed(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ════════════════════════════════════════════════════════════════
   CIRCUIT REGISTRY — 27 PADDOX tracks
════════════════════════════════════════════════════════════════ */

const CIRCUITS = [
  {
    id: "albert_park",
    circuitName: "Albert Park Circuit",
    raceName: "Australian Grand Prix",
    country: "Australia",
    location: "Melbourne",
    type: "street",
    direction: "clockwise",
    search: "Albert Park",
    bbox: [-37.86, 144.95, -37.83, 145.00],
    startOffset: 0
  },
  {
    id: "shanghai",
    circuitName: "Shanghai International Circuit",
    raceName: "Chinese Grand Prix",
    country: "China",
    location: "Shanghai",
    type: "race",
    direction: "clockwise",
    search: "Shanghai International Circuit",
    bbox: [31.32, 121.20, 31.35, 121.25],
    startOffset: 0
  },
  {
    id: "suzuka",
    circuitName: "Suzuka Circuit",
    raceName: "Japanese Grand Prix",
    country: "Japan",
    location: "Suzuka",
    type: "race",
    direction: "clockwise",
    search: "Suzuka",
    bbox: [34.83, 136.52, 34.86, 136.55],
    startOffset: 0
  },
  {
    id: "bahrain",
    circuitName: "Bahrain International Circuit",
    raceName: "Bahrain Grand Prix",
    country: "Bahrain",
    location: "Sakhir",
    type: "race",
    direction: "clockwise",
    search: "Bahrain International Circuit",
    bbox: [26.02, 50.50, 26.04, 50.53],
    startOffset: 0
  },
  {
    id: "jeddah",
    circuitName: "Jeddah Corniche Circuit",
    raceName: "Saudi Arabian Grand Prix",
    country: "Saudi Arabia",
    location: "Jeddah",
    type: "street",
    direction: "counter-clockwise",
    search: "Jeddah Corniche Circuit",
    bbox: [21.62, 39.09, 21.65, 39.13],
    startOffset: 0
  },
  {
    id: "miami",
    circuitName: "Miami International Autodrome",
    raceName: "Miami Grand Prix",
    country: "United States",
    location: "Miami",
    type: "street",
    direction: "counter-clockwise",
    search: "Miami International Autodrome",
    bbox: [25.95, -80.26, 25.97, -80.22],
    startOffset: 0
  },
  {
    id: "imola",
    circuitName: "Autodromo Internazionale Enzo e Dino Ferrari",
    raceName: "Emilia Romagna Grand Prix",
    country: "Italy",
    location: "Imola",
    type: "race",
    direction: "counter-clockwise",
    search: "Imola",
    bbox: [44.33, 11.70, 44.35, 11.73],
    startOffset: 0
  },
  {
    id: "monaco",
    circuitName: "Circuit de Monaco",
    raceName: "Monaco Grand Prix",
    country: "Monaco",
    location: "Monte Carlo",
    type: "street",
    direction: "clockwise",
    search: "Circuit de Monaco",
    bbox: [43.728, 7.410, 43.748, 7.435],
    startOffset: 0
  },
  {
    id: "gilles_villeneuve",
    circuitName: "Circuit Gilles Villeneuve",
    raceName: "Canadian Grand Prix",
    country: "Canada",
    location: "Montreal",
    type: "street",
    direction: "clockwise",
    search: "Circuit Gilles Villeneuve",
    bbox: [45.49, -73.54, 45.52, -73.51],
    startOffset: 0
  },
  {
    id: "barcelona_catalunya",
    circuitName: "Circuit de Barcelona-Catalunya",
    raceName: "Spanish Grand Prix",
    country: "Spain",
    location: "Montmeló",
    type: "race",
    direction: "clockwise",
    search: "Circuit de Barcelona-Catalunya",
    bbox: [41.56, 2.24, 41.59, 2.28],
    startOffset: 0
  },
  {
    id: "madrid_madring",
    circuitName: "Madring",
    raceName: "Spanish Grand Prix",
    country: "Spain",
    location: "Madrid",
    type: "street",
    direction: "clockwise",
    search: "Madring",
    bbox: [40.45, -3.63, 40.49, -3.57],
    startOffset: 0
  },
  {
    id: "red_bull_ring",
    circuitName: "Red Bull Ring",
    raceName: "Austrian Grand Prix",
    country: "Austria",
    location: "Spielberg",
    type: "race",
    direction: "clockwise",
    search: "Red Bull Ring",
    bbox: [47.20, 14.74, 47.23, 14.78],
    startOffset: 0
  },
  {
    id: "silverstone",
    circuitName: "Silverstone Circuit",
    raceName: "British Grand Prix",
    country: "United Kingdom",
    location: "Silverstone",
    type: "race",
    direction: "clockwise",
    search: "Silverstone Circuit",
    bbox: [52.06, -1.04, 52.09, -1.00],
    startOffset: 0
  },
  {
    id: "spa",
    circuitName: "Circuit de Spa-Francorchamps",
    raceName: "Belgian Grand Prix",
    country: "Belgium",
    location: "Stavelot",
    type: "race",
    direction: "clockwise",
    search: "Spa-Francorchamps",
    bbox: [50.42, 5.95, 50.46, 6.00],
    startOffset: 0
  },
  {
    id: "hungaroring",
    circuitName: "Hungaroring",
    raceName: "Hungarian Grand Prix",
    country: "Hungary",
    location: "Mogyoród",
    type: "race",
    direction: "clockwise",
    search: "Hungaroring",
    bbox: [47.57, 19.23, 47.60, 19.27],
    startOffset: 0
  },
  {
    id: "zandvoort",
    circuitName: "Circuit Zandvoort",
    raceName: "Dutch Grand Prix",
    country: "Netherlands",
    location: "Zandvoort",
    type: "race",
    direction: "clockwise",
    search: "Circuit Zandvoort",
    bbox: [52.37, 4.52, 52.40, 4.56],
    startOffset: 0
  },
  {
    id: "monza",
    circuitName: "Autodromo Nazionale Monza",
    raceName: "Italian Grand Prix",
    country: "Italy",
    location: "Monza",
    type: "race",
    direction: "clockwise",
    search: "Autodromo Nazionale Monza",
    bbox: [45.60, 9.26, 45.63, 9.30],
    startOffset: 0
  },
  {
    id: "baku",
    circuitName: "Baku City Circuit",
    raceName: "Azerbaijan Grand Prix",
    country: "Azerbaijan",
    location: "Baku",
    type: "street",
    direction: "counter-clockwise",
    search: "Baku City Circuit",
    bbox: [40.35, 49.82, 40.39, 49.90],
    startOffset: 0
  },
  {
    id: "marina_bay",
    circuitName: "Marina Bay Street Circuit",
    raceName: "Singapore Grand Prix",
    country: "Singapore",
    location: "Singapore",
    type: "street",
    direction: "counter-clockwise",
    search: "Marina Bay Street Circuit",
    bbox: [1.28, 103.84, 1.31, 103.87],
    startOffset: 0
  },
  {
    id: "cota",
    circuitName: "Circuit of The Americas",
    raceName: "United States Grand Prix",
    country: "United States",
    location: "Austin",
    type: "race",
    direction: "counter-clockwise",
    search: "Circuit of the Americas",
    bbox: [30.12, -97.66, 30.15, -97.62],
    startOffset: 0
  },
  {
    id: "mexico_city",
    circuitName: "Autódromo Hermanos Rodríguez",
    raceName: "Mexico City Grand Prix",
    country: "Mexico",
    location: "Mexico City",
    type: "race",
    direction: "clockwise",
    search: "Autódromo Hermanos Rodríguez",
    bbox: [19.39, -99.11, 19.42, -99.08],
    startOffset: 0
  },
  {
    id: "interlagos",
    circuitName: "Autódromo José Carlos Pace",
    raceName: "São Paulo Grand Prix",
    country: "Brazil",
    location: "São Paulo",
    type: "race",
    direction: "counter-clockwise",
    search: "Interlagos",
    bbox: [-23.72, -46.71, -23.69, -46.67],
    startOffset: 0
  },
  {
    id: "las_vegas",
    circuitName: "Las Vegas Strip Circuit",
    raceName: "Las Vegas Grand Prix",
    country: "United States",
    location: "Las Vegas",
    type: "street",
    direction: "counter-clockwise",
    search: "Las Vegas Strip Circuit",
    bbox: [36.09, -115.19, 36.13, -115.15],
    startOffset: 0
  },
  {
    id: "lusail",
    circuitName: "Lusail International Circuit",
    raceName: "Qatar Grand Prix",
    country: "Qatar",
    location: "Lusail",
    type: "race",
    direction: "clockwise",
    search: "Lusail International Circuit",
    bbox: [25.47, 51.44, 25.51, 51.47],
    startOffset: 0
  },
  {
    id: "yas_marina",
    circuitName: "Yas Marina Circuit",
    raceName: "Abu Dhabi Grand Prix",
    country: "United Arab Emirates",
    location: "Abu Dhabi",
    type: "race",
    direction: "counter-clockwise",
    search: "Yas Marina Circuit",
    bbox: [24.45, 54.59, 24.49, 54.62],
    startOffset: 0
  },
  {
    id: "istanbul_park",
    circuitName: "Istanbul Park",
    raceName: "Turkish Grand Prix",
    country: "Turkey",
    location: "Istanbul",
    type: "race",
    direction: "counter-clockwise",
    search: "Istanbul Park",
    bbox: [40.94, 29.39, 40.97, 29.43],
    startOffset: 0
  },
  {
    id: "portimao",
    circuitName: "Algarve International Circuit",
    raceName: "Portuguese Grand Prix",
    country: "Portugal",
    location: "Portimão",
    type: "race",
    direction: "clockwise",
    search: "Algarve International Circuit",
    bbox: [37.22, -8.65, 37.25, -8.61],
    startOffset: 0
  }
];

/* ════════════════════════════════════════════════════════════════
   Preview generator
════════════════════════════════════════════════════════════════ */

function buildPreviewHtml(tracks){
  const cards = Object.values(tracks).map(track => `
    <article class="card">
      <div class="meta">
        <h2>${escapeHtml(track.circuitName)}</h2>
        <p>${escapeHtml(track.raceName)} • ${escapeHtml(track.location)}, ${escapeHtml(track.country)}</p>
        <small>${track.svgPointsCount} points • ${track.closedLoop ? "closed" : "open"} • ${escapeHtml(track.sourceType)}</small>
      </div>
      <svg viewBox="${track.viewBox}" role="img" aria-label="${escapeHtml(track.circuitName)} track preview">
        <path d="${track.detailedPath}" class="track shadow" />
        <path d="${track.detailedPath}" class="track main" />
        <circle cx="${track.startFinish.x}" cy="${track.startFinish.y}" r="4" class="start" />
        ${track.sectors.map(sector => `<text x="${sector.x}" y="${sector.y}" class="sector">${sector.label}</text>`).join("")}
      </svg>
    </article>
  `).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PADDOX Track Preview</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #070707;
      color: #fff;
      font-family: Inter, Arial, sans-serif;
      padding: 28px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 34px;
      letter-spacing: .04em;
    }

    .lead {
      color: #aaa;
      margin: 0 0 24px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }

    .card {
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 22px;
      background: linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.03));
      padding: 18px;
      box-shadow: 0 22px 55px rgba(0,0,0,.45);
      overflow: hidden;
    }

    .meta h2 {
      font-size: 18px;
      margin: 0 0 6px;
    }

    .meta p {
      margin: 0;
      color: #c9c9c9;
    }

    .meta small {
      display: block;
      color: #777;
      margin-top: 6px;
    }

    svg {
      width: 100%;
      height: auto;
      margin-top: 14px;
      overflow: visible;
      background: radial-gradient(circle at 50% 50%, rgba(225,6,0,.11), transparent 58%);
      border-radius: 18px;
    }

    .track {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .track.shadow {
      stroke: #000;
      stroke-width: 10;
      opacity: .65;
    }

    .track.main {
      stroke: #f4f4f4;
      stroke-width: 5;
    }

    .start {
      fill: #e10600;
      stroke: white;
      stroke-width: 1.5;
    }

    .sector {
      fill: #e10600;
      font-size: 12px;
      font-weight: 800;
      paint-order: stroke;
      stroke: #070707;
      stroke-width: 3px;
      stroke-linejoin: round;
    }
  </style>
</head>
<body>
  <h1>PADDOX Track Preview</h1>
  <p class="lead">Visual QA file generated from coordinate-derived SVG paths.</p>
  <section class="grid">${cards}</section>
</body>
</html>`;
}

function escapeHtml(value){
  return String(value).replace(/[&<>"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[character]));
}

/* ════════════════════════════════════════════════════════════════
   RUN ALL STAGES
════════════════════════════════════════════════════════════════ */

async function main(){
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(PREVIEW_DIR, { recursive: true });

  const manualCoordinates = await loadManualCoordinates();
  const out = {};
  const debug = {};

  for(const circuit of CIRCUITS){
    try{
      process.stdout.write(`${circuit.id.padEnd(22)} `);

      let sourceType = "osm-overpass";
      let coordinates = manualCoordinates[circuit.id];

      if(coordinates?.length){
        sourceType = "manual-coordinate-fallback";
      }else{
        coordinates = await fetchCoordinates(circuit);
        await sleep(REQUEST_DELAY_MS);
      }

      if(!coordinates || coordinates.length < 10){
        console.log("✗ no reliable coordinates");

        debug[circuit.id] = {
          status: "failed",
          reason: "No reliable coordinates",
          sourceType
        };

        continue;
      }

      const svgPoints = coordinatesToSvgPoints(coordinates, {
        simplify: circuit.simplify ?? 0.55
      });

      const svgPointsMini = coordinatesToSvgPoints(coordinates, {
        simplify: circuit.miniSimplify ?? 2.1
      });

      const detailedPath = buildLinePath(svgPoints, true);
      const smoothPath = buildSmoothPath(svgPoints, true);
      const miniPath = buildLinePath(svgPointsMini, true);
      const markers = markersFromDistance(svgPoints, circuit.startOffset ?? 0);
      const closedLoop = isClosedLoop(svgPoints);

      out[circuit.id] = {
        id: circuit.id,
        circuitName: circuit.circuitName,
        raceName: circuit.raceName,
        country: circuit.country,
        location: circuit.location,
        type: circuit.type,
        direction: circuit.direction,
        sourceType,
        viewBox: "0 0 300 180",
        detailedPath,
        smoothPath,
        miniPath,
        startFinish: markers.startFinish,
        sectors: markers.sectors,
        render: {
          strokeWidth: 5,
          strokeLinecap: "round",
          strokeLinejoin: "round"
        },
        attribution: "© OpenStreetMap contributors (ODbL)"
      };

      debug[circuit.id] = {
        status: "ok",
        sourceType,
        closedLoop,
        coordinatesCount: coordinates.length,
        svgPointsCount: svgPoints.length,
        miniPointsCount: svgPointsMini.length,
        coordinatesSample: coordinates.slice(0, 5),
        svgPointsSample: svgPoints.slice(0, 5),
        bbox: circuit.bbox
      };

      out[circuit.id].svgPointsCount = svgPoints.length;
      out[circuit.id].closedLoop = closedLoop;

      console.log(`✓ coords:${coordinates.length} → pts:${svgPoints.length} ${closedLoop ? "closed" : "open"}`);
    }catch(error){
      console.log("✗", error.message);

      debug[circuit.id] = {
        status: "error",
        error: error.message
      };
    }
  }

  const cleanOut = JSON.parse(JSON.stringify(out));

  for(const track of Object.values(cleanOut)){
    delete track.svgPointsCount;
    delete track.closedLoop;
  }

  const banner = `// AUTO-GENERATED by scripts/buildTracks.mjs
// Data: © OpenStreetMap contributors (ODbL) where sourceType is osm-overpass.

`;

  writeFileSync(
    `${OUT_DIR}/paddoxTracks.generated.js`,
    banner + "export const paddoxTracks = " + JSON.stringify(cleanOut, null, 2) + ";\n"
  );

  writeFileSync(
    `${OUT_DIR}/paddoxTracks.debug.json`,
    JSON.stringify(debug, null, 2)
  );

  writeFileSync(
    `${PREVIEW_DIR}/paddox-tracks-preview.html`,
    buildPreviewHtml(out)
  );

  console.log(`\nWrote ${Object.keys(cleanOut).length}/${CIRCUITS.length} circuits.`);
  console.log(`Dataset  → ${OUT_DIR}/paddoxTracks.generated.js`);
  console.log(`Debug    → ${OUT_DIR}/paddoxTracks.debug.json`);
  console.log(`Preview  → ${PREVIEW_DIR}/paddox-tracks-preview.html`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});