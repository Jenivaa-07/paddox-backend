#!/usr/bin/env python3
"""
scripts/buildTracksFastF1.py

PADDOX — FastF1 True Sector Track Generator + Anime.js Preview
STAGE 1: FastF1 fastest-lap telemetry X/Y/Time points
STAGE 2: Normalize to SVG viewBox 0 0 300 180
STAGE 3: Split into true sector paths using FastF1 Sector1Time + Sector2Time
STAGE 4: Generate PADDOX JS data + animated preview

Run from paddox-backend:

  py scripts/buildTracksFastF1.py

Outputs to sibling frontend repo:

  ../paddox-frontend/data/paddoxTracks.generated.js
  ../paddox-frontend/data/paddoxTracks.debug.json
  ../paddox-frontend/previews/paddox-tracks-preview.html
"""

from __future__ import annotations

import json
import math
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import fastf1
import numpy as np
import pandas as pd


OUT_DIR = Path("../paddox-frontend/data")
PREVIEW_DIR = Path("../paddox-frontend/previews")
CACHE_DIR = Path("./scripts/fastf1-cache")

VIEW_W = 300
VIEW_H = 180
PAD = 22
LOAD_TELEMETRY = True

SECTOR_COLORS = {
    "S1": "#e10600",   # PADDOX red
    "S2": "#00d2ff",   # electric cyan
    "S3": "#ffd400",   # performance gold
}

# Final transform values collected during PADDOX H3.4B orientation tuning.
# Order used by apply_track_transform:
# 1) rotate first, 2) flipX/flipY second, 3) fit into viewBox.
TRACK_TRANSFORMS: Dict[str, Dict[str, Any]] = {
    "albert_park": {"rotate": 90, "flipX": False, "flipY": False},
    "shanghai": {"rotate": 45, "flipX": False, "flipY": True},
    "suzuka": {"rotate": 0, "flipX": False, "flipY": True},
    "bahrain": {"rotate": 90, "flipX": False, "flipY": True},
    "jeddah": {"rotate": 65, "flipX": False, "flipY": False},
    "miami": {"rotate": 0, "flipX": False, "flipY": True},
    "imola": {"rotate": 0, "flipX": False, "flipY": True},
    "monaco": {"rotate": 270, "flipX": True, "flipY": False},
    "gilles_villeneuve": {"rotate": 270, "flipX": False, "flipY": True},
    "barcelona_catalunya": {"rotate": 90, "flipX": True, "flipY": False},
    "madrid_madring": {"rotate": 0, "flipX": False, "flipY": False},
    "red_bull_ring": {"rotate": 315, "flipX": True, "flipY": False},
    "silverstone": {"rotate": 90, "flipX": False, "flipY": True},
    "spa": {"rotate": 315, "flipX": False, "flipY": True},
    "hungaroring": {"rotate": 315, "flipX": True, "flipY": False},
    "zandvoort": {"rotate": 0, "flipX": True, "flipY": False},
    "monza": {"rotate": 90, "flipX": False, "flipY": True},
    "baku": {"rotate": 0, "flipX": False, "flipY": False},
    "marina_bay": {"rotate": 0, "flipX": False, "flipY": False},
    "cota": {"rotate": 0, "flipX": False, "flipY": True},
    "mexico_city": {"rotate": 0, "flipX": False, "flipY": True},
    "interlagos": {"rotate": 270, "flipX": False, "flipY": False},
    "las_vegas": {"rotate": 90, "flipX": False, "flipY": True},
    "lusail": {"rotate": 270, "flipX": False, "flipY": True},
    "yas_marina": {"rotate": 90, "flipX": False, "flipY": True},
    "istanbul_park": {"rotate": 0, "flipX": False, "flipY": True},
    "portimao": {"rotate": 90, "flipX": False, "flipY": True},
}

CIRCUITS: List[Dict[str, Any]] = [
    {"id":"albert_park","circuitName":"Albert Park Circuit","raceName":"Australian Grand Prix","country":"Australia","location":"Melbourne","type":"street","direction":"clockwise","attempts":[(2025,"Australian Grand Prix","Q"),(2024,"Australian Grand Prix","Q"),(2023,"Australian Grand Prix","Q")]},
    {"id":"shanghai","circuitName":"Shanghai International Circuit","raceName":"Chinese Grand Prix","country":"China","location":"Shanghai","type":"race","direction":"clockwise","attempts":[(2025,"Chinese Grand Prix","Q"),(2024,"Chinese Grand Prix","Q"),(2019,"Chinese Grand Prix","Q")]},
    {"id":"suzuka","circuitName":"Suzuka Circuit","raceName":"Japanese Grand Prix","country":"Japan","location":"Suzuka","type":"race","direction":"clockwise","attempts":[(2025,"Japanese Grand Prix","Q"),(2024,"Japanese Grand Prix","Q"),(2023,"Japanese Grand Prix","Q")]},
    {"id":"bahrain","circuitName":"Bahrain International Circuit","raceName":"Bahrain Grand Prix","country":"Bahrain","location":"Sakhir","type":"race","direction":"clockwise","attempts":[(2025,"Bahrain Grand Prix","Q"),(2024,"Bahrain Grand Prix","Q"),(2023,"Bahrain Grand Prix","Q")]},
    {"id":"jeddah","circuitName":"Jeddah Corniche Circuit","raceName":"Saudi Arabian Grand Prix","country":"Saudi Arabia","location":"Jeddah","type":"street","direction":"counter-clockwise","attempts":[(2025,"Saudi Arabian Grand Prix","Q"),(2024,"Saudi Arabian Grand Prix","Q"),(2023,"Saudi Arabian Grand Prix","Q")]},
    {"id":"miami","circuitName":"Miami International Autodrome","raceName":"Miami Grand Prix","country":"United States","location":"Miami","type":"street","direction":"counter-clockwise","attempts":[(2025,"Miami Grand Prix","Q"),(2024,"Miami Grand Prix","Q"),(2023,"Miami Grand Prix","Q")]},
    {"id":"imola","circuitName":"Autodromo Internazionale Enzo e Dino Ferrari","raceName":"Emilia Romagna Grand Prix","country":"Italy","location":"Imola","type":"race","direction":"counter-clockwise","attempts":[(2025,"Emilia Romagna Grand Prix","Q"),(2024,"Emilia Romagna Grand Prix","Q"),(2022,"Emilia Romagna Grand Prix","Q")]},
    {"id":"monaco","circuitName":"Circuit de Monaco","raceName":"Monaco Grand Prix","country":"Monaco","location":"Monte Carlo","type":"street","direction":"clockwise","attempts":[(2025,"Monaco Grand Prix","Q"),(2024,"Monaco Grand Prix","Q"),(2023,"Monaco Grand Prix","Q")]},
    {"id":"gilles_villeneuve","circuitName":"Circuit Gilles Villeneuve","raceName":"Canadian Grand Prix","country":"Canada","location":"Montreal","type":"street","direction":"clockwise","attempts":[(2025,"Canadian Grand Prix","Q"),(2024,"Canadian Grand Prix","Q"),(2023,"Canadian Grand Prix","Q")]},
    {"id":"barcelona_catalunya","circuitName":"Circuit de Barcelona-Catalunya","raceName":"Spanish Grand Prix","country":"Spain","location":"Montmeló","type":"race","direction":"clockwise","attempts":[(2025,"Spanish Grand Prix","Q"),(2024,"Spanish Grand Prix","Q"),(2023,"Spanish Grand Prix","Q")]},
    {"id":"madrid_madring","circuitName":"Madring","raceName":"Spanish Grand Prix","country":"Spain","location":"Madrid","type":"street","direction":"clockwise","attempts":[],"note":"No FastF1 telemetry exists yet for Madring."},
    {"id":"red_bull_ring","circuitName":"Red Bull Ring","raceName":"Austrian Grand Prix","country":"Austria","location":"Spielberg","type":"race","direction":"clockwise","attempts":[(2025,"Austrian Grand Prix","Q"),(2024,"Austrian Grand Prix","Q"),(2023,"Austrian Grand Prix","Q")]},
    {"id":"silverstone","circuitName":"Silverstone Circuit","raceName":"British Grand Prix","country":"United Kingdom","location":"Silverstone","type":"race","direction":"clockwise","attempts":[(2025,"British Grand Prix","Q"),(2024,"British Grand Prix","Q"),(2023,"British Grand Prix","Q")]},
    {"id":"spa","circuitName":"Circuit de Spa-Francorchamps","raceName":"Belgian Grand Prix","country":"Belgium","location":"Stavelot","type":"race","direction":"clockwise","attempts":[(2025,"Belgian Grand Prix","Q"),(2024,"Belgian Grand Prix","Q"),(2023,"Belgian Grand Prix","Q")]},
    {"id":"hungaroring","circuitName":"Hungaroring","raceName":"Hungarian Grand Prix","country":"Hungary","location":"Mogyoród","type":"race","direction":"clockwise","attempts":[(2025,"Hungarian Grand Prix","Q"),(2024,"Hungarian Grand Prix","Q"),(2023,"Hungarian Grand Prix","Q")]},
    {"id":"zandvoort","circuitName":"Circuit Zandvoort","raceName":"Dutch Grand Prix","country":"Netherlands","location":"Zandvoort","type":"race","direction":"clockwise","attempts":[(2025,"Dutch Grand Prix","Q"),(2024,"Dutch Grand Prix","Q"),(2023,"Dutch Grand Prix","Q")]},
    {"id":"monza","circuitName":"Autodromo Nazionale Monza","raceName":"Italian Grand Prix","country":"Italy","location":"Monza","type":"race","direction":"clockwise","attempts":[(2025,"Italian Grand Prix","Q"),(2024,"Italian Grand Prix","Q"),(2023,"Italian Grand Prix","Q")]},
    {"id":"baku","circuitName":"Baku City Circuit","raceName":"Azerbaijan Grand Prix","country":"Azerbaijan","location":"Baku","type":"street","direction":"counter-clockwise","attempts":[(2025,"Azerbaijan Grand Prix","Q"),(2024,"Azerbaijan Grand Prix","Q"),(2023,"Azerbaijan Grand Prix","Q")]},
    {"id":"marina_bay","circuitName":"Marina Bay Street Circuit","raceName":"Singapore Grand Prix","country":"Singapore","location":"Singapore","type":"street","direction":"counter-clockwise","attempts":[(2025,"Singapore Grand Prix","Q"),(2024,"Singapore Grand Prix","Q"),(2023,"Singapore Grand Prix","Q")]},
    {"id":"cota","circuitName":"Circuit of The Americas","raceName":"United States Grand Prix","country":"United States","location":"Austin","type":"race","direction":"counter-clockwise","attempts":[(2025,"United States Grand Prix","Q"),(2024,"United States Grand Prix","Q"),(2023,"United States Grand Prix","Q")]},
    {"id":"mexico_city","circuitName":"Autódromo Hermanos Rodríguez","raceName":"Mexico City Grand Prix","country":"Mexico","location":"Mexico City","type":"race","direction":"clockwise","attempts":[(2025,"Mexico City Grand Prix","Q"),(2024,"Mexico City Grand Prix","Q"),(2023,"Mexico City Grand Prix","Q")]},
    {"id":"interlagos","circuitName":"Autódromo José Carlos Pace","raceName":"São Paulo Grand Prix","country":"Brazil","location":"São Paulo","type":"race","direction":"counter-clockwise","attempts":[(2025,"São Paulo Grand Prix","Q"),(2024,"São Paulo Grand Prix","Q"),(2023,"São Paulo Grand Prix","Q")]},
    {"id":"las_vegas","circuitName":"Las Vegas Strip Circuit","raceName":"Las Vegas Grand Prix","country":"United States","location":"Las Vegas","type":"street","direction":"counter-clockwise","attempts":[(2025,"Las Vegas Grand Prix","Q"),(2024,"Las Vegas Grand Prix","Q"),(2023,"Las Vegas Grand Prix","Q")]},
    {"id":"lusail","circuitName":"Lusail International Circuit","raceName":"Qatar Grand Prix","country":"Qatar","location":"Lusail","type":"race","direction":"clockwise","attempts":[(2025,"Qatar Grand Prix","Q"),(2024,"Qatar Grand Prix","Q"),(2023,"Qatar Grand Prix","Q")]},
    {"id":"yas_marina","circuitName":"Yas Marina Circuit","raceName":"Abu Dhabi Grand Prix","country":"United Arab Emirates","location":"Abu Dhabi","type":"race","direction":"counter-clockwise","attempts":[(2025,"Abu Dhabi Grand Prix","Q"),(2024,"Abu Dhabi Grand Prix","Q"),(2023,"Abu Dhabi Grand Prix","Q")]},
    {"id":"istanbul_park","circuitName":"Istanbul Park","raceName":"Turkish Grand Prix","country":"Turkey","location":"Istanbul","type":"race","direction":"counter-clockwise","attempts":[(2021,"Turkish Grand Prix","Q"),(2020,"Turkish Grand Prix","Q")]},
    {"id":"portimao","circuitName":"Algarve International Circuit","raceName":"Portuguese Grand Prix","country":"Portugal","location":"Portimão","type":"race","direction":"clockwise","attempts":[(2021,"Portuguese Grand Prix","Q"),(2020,"Portuguese Grand Prix","Q")]},
]


def setup_fastf1() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(CACHE_DIR))


def try_load_session(year: int, event: str, session_code: str):
    session = fastf1.get_session(year, event, session_code)
    session.load(laps=True, telemetry=LOAD_TELEMETRY, weather=False, messages=False)
    return session


def td_seconds(value: Any) -> Optional[float]:
    if value is None or pd.isna(value):
        return None
    try:
        return float(pd.to_timedelta(value).total_seconds())
    except Exception:
        return None


def extract_lap_points_and_sector_times(session) -> Tuple[List[Dict[str, float]], Dict[str, Any]]:
    fastest = session.laps.pick_fastest()

    if fastest is None or pd.isna(fastest.get("LapTime", None)):
        raise RuntimeError("No fastest lap available")

    driver = str(fastest.get("Driver", ""))
    lap_time = str(fastest.get("LapTime", ""))

    sector1 = td_seconds(fastest.get("Sector1Time", None))
    sector2 = td_seconds(fastest.get("Sector2Time", None))
    sector3 = td_seconds(fastest.get("Sector3Time", None))

    tel = fastest.get_telemetry()

    required = {"X", "Y", "Time"}
    missing = required.difference(set(tel.columns))

    if missing:
        raise RuntimeError(f"Telemetry missing columns: {sorted(missing)}")

    clean = tel[["X", "Y", "Time"]].replace([np.inf, -np.inf], np.nan).dropna()

    points: List[Dict[str, float]] = []
    last: Optional[Tuple[float, float]] = None

    for row in clean.itertuples(index=False):
        x = float(row.X)
        y = float(row.Y)
        t = td_seconds(row.Time)

        if t is None:
            continue

        current = (x, y)

        if last is None or math.hypot(current[0] - last[0], current[1] - last[1]) > 1.0:
            points.append({"x": x, "y": y, "t": t})
            last = current

    if len(points) < 30:
        raise RuntimeError(f"Not enough X/Y telemetry points: {len(points)}")

    meta = {
        "driver": driver,
        "lapTime": lap_time,
        "rawTelemetryPoints": len(points),
        "sectorTimes": {
            "S1": sector1,
            "S2": sector2,
            "S3": sector3,
        },
    }

    return points, meta


def get_track_points(circuit: Dict[str, Any]) -> Tuple[Optional[List[Dict[str, float]]], Dict[str, Any]]:
    attempts = circuit.get("attempts", [])

    if not attempts:
        return None, {"status": "skipped", "reason": circuit.get("note", "No FastF1 attempts configured")}

    errors = []

    for year, event, session_code in attempts:
        try:
            print(f"  trying {year} {event} {session_code} ...", end=" ")
            session = try_load_session(year, event, session_code)
            points, meta = extract_lap_points_and_sector_times(session)
            print(f"ok ({len(points)} pts, {meta.get('driver')})")

            return points, {
                "status": "ok",
                "sourceYear": year,
                "sourceEvent": event,
                "sourceSession": session_code,
                **meta,
            }
        except Exception as exc:
            message = f"{year} {event} {session_code}: {exc}"
            print("failed")
            errors.append(message)

    return None, {"status": "failed", "errors": errors[-5:]}


def round2(value: float) -> float:
    return round(float(value), 2)


def rdp(points: List[Dict[str, float]], eps: float) -> List[Dict[str, float]]:
    if len(points) < 3:
        return points

    start = points[0]
    end = points[-1]

    max_dist = 0.0
    index = -1

    for i in range(1, len(points) - 1):
        dist = perpendicular_distance(points[i], start, end)
        if dist > max_dist:
            max_dist = dist
            index = i

    if max_dist > eps:
        left = rdp(points[: index + 1], eps)[:-1]
        right = rdp(points[index:], eps)
        return left + right

    return [start, end]


def perpendicular_distance(point: Dict[str, float], start: Dict[str, float], end: Dict[str, float]) -> float:
    x, y = point["x"], point["y"]
    x1, y1 = start["x"], start["y"]
    x2, y2 = end["x"], end["y"]

    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy) or 1e-9

    return abs(dx * (y1 - y) - dy * (x1 - x)) / length


def simplify_eps(points: List[Dict[str, float]], knob: float) -> float:
    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]
    diag = math.hypot(max(xs) - min(xs), max(ys) - min(ys)) or 1
    return (diag / 300.0) * knob


def normalize_points(points: List[Dict[str, float]], width: int = VIEW_W, height: int = VIEW_H, pad: int = PAD) -> List[Dict[str, float]]:
    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    bw = max(max_x - min_x, 1)
    bh = max(max_y - min_y, 1)

    scale = min((width - 2 * pad) / bw, (height - 2 * pad) / bh)
    ox = (width - bw * scale) / 2 - min_x * scale
    oy = (height - bh * scale) / 2 - min_y * scale

    return [{"x": round2(p["x"] * scale + ox), "y": round2(p["y"] * scale + oy), "t": p["t"]} for p in points]


def fit_points_to_viewbox(points: List[Dict[str, float]], width: int = VIEW_W, height: int = VIEW_H, pad: int = PAD) -> List[Dict[str, float]]:
    if not points:
        return []

    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    bw = max(max_x - min_x, 1)
    bh = max(max_y - min_y, 1)

    scale = min((width - 2 * pad) / bw, (height - 2 * pad) / bh)
    ox = (width - bw * scale) / 2 - min_x * scale
    oy = (height - bh * scale) / 2 - min_y * scale

    return [{"x": round2(p["x"] * scale + ox), "y": round2(p["y"] * scale + oy), "t": p["t"]} for p in points]


def apply_track_transform(points: List[Dict[str, float]], transform: Optional[Dict[str, Any]] = None) -> List[Dict[str, float]]:
    if not points:
        return []

    transform = transform or {}
    rotate = int(transform.get("rotate", 0)) % 360
    flip_x = bool(transform.get("flipX", False))
    flip_y = bool(transform.get("flipY", False))

    if rotate == 0 and not flip_x and not flip_y:
        return points

    cx = VIEW_W / 2
    cy = VIEW_H / 2
    rad = math.radians(rotate)
    cos_a = math.cos(rad)
    sin_a = math.sin(rad)

    transformed = []

    for p in points:
        x = p["x"] - cx
        y = p["y"] - cy

        # Rotate first.
        rx = x * cos_a - y * sin_a
        ry = x * sin_a + y * cos_a

        # Flip after rotation.
        if flip_x:
            rx = -rx
        if flip_y:
            ry = -ry

        transformed.append({"x": round2(rx + cx), "y": round2(ry + cy), "t": p["t"]})

    return fit_points_to_viewbox(transformed)


def build_line_path(points: List[Dict[str, float]]) -> str:
    if not points:
        return ""

    d = f'M {points[0]["x"]} {points[0]["y"]}'

    for point in points[1:]:
        d += f' L {point["x"]} {point["y"]}'

    return d


def simplify_points(points: List[Dict[str, float]], knob: float = 0.55) -> List[Dict[str, float]]:
    if len(points) < 3:
        return points
    return rdp(points, simplify_eps(points, knob))


def interpolate_time_point(points: List[Dict[str, float]], target_time: float) -> Dict[str, float]:
    if not points:
        return {"x": 0, "y": 0, "t": target_time}

    for i in range(1, len(points)):
        if points[i]["t"] >= target_time:
            prev = points[i - 1]
            curr = points[i]
            span = curr["t"] - prev["t"] or 1e-9
            ratio = (target_time - prev["t"]) / span

            return {
                "x": round2(prev["x"] + (curr["x"] - prev["x"]) * ratio),
                "y": round2(prev["y"] + (curr["y"] - prev["y"]) * ratio),
                "t": target_time,
            }

    last = points[-1]
    return {"x": last["x"], "y": last["y"], "t": target_time}


def build_true_sector_paths(points: List[Dict[str, float]], meta: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    sector_times = meta.get("sectorTimes", {})
    s1 = sector_times.get("S1")
    s2 = sector_times.get("S2")

    total_time = points[-1]["t"] if points else None

    # If FastF1 sector times are unavailable, use fallback thirds.
    true_sector_data = bool(s1 and s2)

    if true_sector_data:
        s1_end = float(s1)
        s2_end = float(s1 + s2)
    else:
        total = float(total_time or 1)
        s1_end = total * 0.333
        s2_end = total * 0.666

    s1_boundary = interpolate_time_point(points, s1_end)
    s2_boundary = interpolate_time_point(points, s2_end)

    sector_1 = [p for p in points if p["t"] <= s1_end]
    sector_1.append(s1_boundary)

    sector_2 = [s1_boundary] + [p for p in points if s1_end < p["t"] <= s2_end] + [s2_boundary]

    sector_3 = [s2_boundary] + [p for p in points if p["t"] > s2_end]

    sectors = []

    for label, sector_points in [("S1", sector_1), ("S2", sector_2), ("S3", sector_3)]:
        cleaned = simplify_points(sector_points, 0.35)

        sectors.append({
            "label": label,
            "color": SECTOR_COLORS[label],
            "path": build_line_path(cleaned),
            "pointCount": len(cleaned),
            "start": {"x": cleaned[0]["x"], "y": cleaned[0]["y"]} if cleaned else {"x": 0, "y": 0},
            "end": {"x": cleaned[-1]["x"], "y": cleaned[-1]["y"]} if cleaned else {"x": 0, "y": 0},
            "trueSectorBoundary": true_sector_data,
        })

    markers = {
        "startFinish": {"x": round2(points[0]["x"]), "y": round2(points[0]["y"])},
        "sectors": [
            {"label": "S1", "x": s1_boundary["x"], "y": s1_boundary["y"], "color": SECTOR_COLORS["S1"]},
            {"label": "S2", "x": s2_boundary["x"], "y": s2_boundary["y"], "color": SECTOR_COLORS["S2"]},
            {"label": "S3", "x": points[-1]["x"], "y": points[-1]["y"], "color": SECTOR_COLORS["S3"]},
        ],
    }

    return sectors, markers


def html_escape(value: Any) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def build_preview_html(tracks: Dict[str, Any], debug: Dict[str, Any]) -> str:
    cards = []

    for track_id, track in tracks.items():
        dbg = debug.get(track_id, {})
        source_line = f'{dbg.get("sourceYear", "")} {dbg.get("sourceSession", "")} • {dbg.get("driver", "")}'.strip()

        sector_paths = "".join(
            f'<path d="{sp["path"]}" class="sector-path sector-{sp["label"].lower()}" data-sector="{sp["label"]}" />'
            for sp in track.get("sectorPaths", [])
        )

        sector_labels = "".join(
            f'<text x="{s["x"]}" y="{s["y"]}" class="sector-label" fill="{s.get("color", "#e10600")}">{html_escape(s["label"])}</text>'
            for s in track.get("sectors", [])
        )

        cards.append(f"""
        <article class="card">
          <div class="meta">
            <div>
              <h2>{html_escape(track["circuitName"])}</h2>
              <p>{html_escape(track["raceName"])} • {html_escape(track["location"])}, {html_escape(track["country"])}</p>
              <small>{html_escape(source_line)} • {html_escape(track.get("sourceType", ""))}</small>
            </div>
            <span class="track-badge">Live path</span>
          </div>
          <svg viewBox="{track["viewBox"]}" role="img" aria-label="{html_escape(track["circuitName"])} track preview">
            <path d="{track["detailedPath"]}" class="track-shadow" />
            <path d="{track["detailedPath"]}" class="track-glow" />
            <path d="{track["detailedPath"]}" class="track-base" />
            {sector_paths}
            <circle cx="{track["startFinish"]["x"]}" cy="{track["startFinish"]["y"]}" r="3.8" class="start-dot" />
            <circle class="race-dot" r="3.3" />
            {sector_labels}
          </svg>
        </article>
        """)

    for item in CIRCUITS:
        if item["id"] not in tracks:
            dbg = debug.get(item["id"], {})
            cards.append(f"""
            <article class="card failed">
              <div class="meta">
                <h2>{html_escape(item["circuitName"])}</h2>
                <p>{html_escape(item["raceName"])} • {html_escape(item["location"])}, {html_escape(item["country"])}</p>
                <small>Not generated • {html_escape(dbg.get("reason", dbg.get("status", "failed")))}</small>
              </div>
              <div class="placeholder">NO FASTF1 TRACK SHAPE YET</div>
            </article>
            """)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PADDOX True Sector Track Preview</title>
  <style>
    * {{ box-sizing: border-box; }}
    :root {{
      --pdx-red: {SECTOR_COLORS["S1"]};
      --pdx-cyan: {SECTOR_COLORS["S2"]};
      --pdx-gold: {SECTOR_COLORS["S3"]};
      --pdx-ink: #070707;
      --pdx-panel: rgba(255,255,255,.055);
      --pdx-border: rgba(255,255,255,.105);
    }}
    body {{
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 16% -10%, rgba(225,6,0,.18), transparent 34%),
        radial-gradient(circle at 86% 8%, rgba(0,210,255,.09), transparent 30%),
        linear-gradient(180deg, #050505 0%, #090909 44%, #030303 100%);
      color: #fff;
      font-family: Inter, Arial, sans-serif;
      padding: 30px;
    }}
    .shell {{ max-width: 1540px; margin: 0 auto; }}
    .hero {{
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      margin-bottom: 22px;
      border-bottom: 1px solid rgba(255,255,255,.08);
      padding-bottom: 20px;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: clamp(30px, 3vw, 48px);
      letter-spacing: .045em;
      text-transform: uppercase;
      line-height: 1;
    }}
    .lead {{
      color: #a8a8a8;
      margin: 0;
      max-width: 900px;
      line-height: 1.6;
      font-size: 14px;
    }}
    .legend {{
      display:flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
      min-width: 300px;
    }}
    .pill {{
      border:1px solid rgba(255,255,255,.12);
      border-radius: 999px;
      padding: 9px 12px;
      color:#cfcfcf;
      background: linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.03));
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
      font-size: 12px;
      white-space: nowrap;
    }}
    .s1 {{ color: var(--pdx-red); }} .s2 {{ color: var(--pdx-cyan); }} .s3 {{ color: var(--pdx-gold); }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
      gap: 20px;
    }}
    .card {{
      position: relative;
      border: 1px solid var(--pdx-border);
      border-radius: 26px;
      background:
        radial-gradient(circle at 50% 62%, rgba(225,6,0,.13), transparent 46%),
        linear-gradient(145deg, rgba(255,255,255,.075), rgba(255,255,255,.025));
      padding: 18px;
      box-shadow: 0 26px 75px rgba(0,0,0,.52);
      overflow: hidden;
      min-height: 278px;
      isolation: isolate;
    }}
    .card::before {{
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(110deg, transparent 0%, rgba(255,255,255,.055) 42%, transparent 62%),
        radial-gradient(circle at 50% 100%, rgba(255,255,255,.055), transparent 55%);
      opacity: .55;
      z-index: -1;
    }}
    .card::after {{
      content: "";
      position: absolute;
      left: 18px;
      right: 18px;
      top: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.24), transparent);
      opacity: .75;
    }}
    .card.failed {{ opacity: .72; }}
    .meta {{
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: start;
      min-height: 58px;
    }}
    .meta h2 {{
      font-size: 17px;
      margin: 0 0 6px;
      letter-spacing: .01em;
      line-height: 1.12;
    }}
    .meta p {{
      margin: 0;
      color: #d5d5d5;
      font-size: 13px;
      line-height: 1.35;
    }}
    .meta small {{
      display: block;
      color: #777;
      margin-top: 6px;
      font-size: 11px;
    }}
    .track-badge {{
      border: 1px solid rgba(225,6,0,.24);
      color: rgba(255,255,255,.72);
      background: rgba(225,6,0,.08);
      border-radius: 999px;
      padding: 6px 9px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }}
    svg {{
      width: 100%;
      height: 185px;
      margin-top: 12px;
      overflow: visible;
      border-radius: 20px;
      background:
        radial-gradient(circle at 50% 52%, rgba(255,255,255,.055), transparent 34%),
        radial-gradient(circle at 50% 54%, rgba(225,6,0,.10), transparent 58%),
        linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));
    }}
    .track-shadow, .track-base, .track-glow, .sector-path {{
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }}
    .track-shadow {{ stroke: #000; stroke-width: 8; opacity: .62; }}
    .track-glow {{ stroke: rgba(225,6,0,.12); stroke-width: 9; filter: blur(2px); }}
    .track-base {{ stroke: rgba(255,255,255,.12); stroke-width: 4.1; }}
    .sector-path {{
      stroke-width: 3.05;
      filter: drop-shadow(0 0 5px rgba(255,255,255,.15));
    }}
    .sector-s1 {{ stroke: var(--pdx-red); filter: drop-shadow(0 0 5px rgba(225,6,0,.34)); }}
    .sector-s2 {{ stroke: var(--pdx-cyan); filter: drop-shadow(0 0 5px rgba(0,210,255,.30)); }}
    .sector-s3 {{ stroke: var(--pdx-gold); filter: drop-shadow(0 0 5px rgba(255,212,0,.30)); }}
    .start-dot {{ fill: #ffffff; stroke: var(--pdx-red); stroke-width:1.35; filter: drop-shadow(0 0 6px rgba(255,255,255,.45)); }}
    .race-dot {{ fill: var(--pdx-red); stroke: #fff; stroke-width: 1.25; filter: drop-shadow(0 0 9px rgba(225,6,0,.9)); }}
    .sector-label {{
      font-size: 10.5px;
      font-weight: 900;
      paint-order: stroke;
      stroke:#070707;
      stroke-width: 3px;
      stroke-linejoin: round;
      letter-spacing: .02em;
    }}
    .placeholder {{
      height: 185px;
      margin-top: 12px;
      border-radius: 20px;
      display: grid;
      place-items: center;
      color: #666;
      border: 1px dashed rgba(255,255,255,.16);
      background: rgba(255,255,255,.03);
      font-weight: 800;
      letter-spacing: .08em;
    }}
    @media (max-width: 760px) {{
      body {{ padding: 18px; }}
      .hero {{ display: block; }}
      .legend {{ justify-content: flex-start; margin-top: 16px; }}
      .grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div>
        <h1>PADDOX True Sector Track Preview</h1>
        <p class="lead">Generated from FastF1 fastest-lap telemetry. Sector colors are split from sector timing boundaries where FastF1 provides Sector1Time and Sector2Time. Anime.js animates sector reveal and a racing dot along the telemetry path.</p>
      </div>
      <div class="legend">
        <span class="pill"><b class="s1">Sector 1</b> PADDOX red</span>
        <span class="pill"><b class="s2">Sector 2</b> electric cyan</span>
        <span class="pill"><b class="s3">Sector 3</b> performance gold</span>
      </div>
    </header>
    <section class="grid">{"".join(cards)}</section>

  <script src="https://cdn.jsdelivr.net/npm/animejs@3.2.1/lib/anime.min.js"></script>
  <script>
    window.addEventListener("load", () => {{
      if (!window.anime) return;

      document.querySelectorAll(".card svg").forEach((svg, index) => {{
        const sectors = svg.querySelectorAll(".sector-path");
        const fullPath = svg.querySelector(".track-base");
        const dot = svg.querySelector(".race-dot");

        sectors.forEach((path, i) => {{
          path.setAttribute("stroke-dasharray", path.getTotalLength());
          path.setAttribute("stroke-dashoffset", path.getTotalLength());

          anime({{
            targets: path,
            strokeDashoffset: [path.getTotalLength(), 0],
            duration: 1100,
            delay: 180 * i + (index % 4) * 90,
            easing: "easeInOutSine"
          }});
        }});

        if (fullPath && dot) {{
          const motion = anime.path(fullPath);
          anime({{
            targets: dot,
            translateX: motion("x"),
            translateY: motion("y"),
            duration: 7200,
            easing: "linear",
            loop: true,
            delay: (index % 4) * 250
          }});
        }}
      }});
    }});
  </script>
  </main>
</body>
</html>"""


def main() -> int:
    setup_fastf1()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    tracks: Dict[str, Any] = {}
    debug: Dict[str, Any] = {}

    print("PADDOX FastF1 True Sector Generator")
    print("Output:", OUT_DIR.resolve())
    print("Cache :", CACHE_DIR.resolve())
    print()

    for circuit in CIRCUITS:
        track_id = circuit["id"]
        print(f"{track_id.ljust(22)}")

        try:
            raw_points, meta = get_track_points(circuit)
            debug[track_id] = {**meta, "circuitName": circuit["circuitName"], "raceName": circuit["raceName"]}

            if not raw_points:
                print("  ✗ skipped/failed")
                continue

            normalized = normalize_points(raw_points)
            transform = TRACK_TRANSFORMS.get(track_id, {"rotate": 0, "flipX": False, "flipY": False})
            transformed = apply_track_transform(normalized, transform)

            if len(transformed) < 30:
                raise RuntimeError(f"Not enough transformed telemetry points: {len(transformed)}")

            simplified = simplify_points(transformed, 0.55)
            mini = simplify_points(transformed, 2.1)

            sector_paths, markers = build_true_sector_paths(transformed, meta)

            tracks[track_id] = {
                "id": track_id,
                "circuitName": circuit["circuitName"],
                "raceName": circuit["raceName"],
                "country": circuit["country"],
                "location": circuit["location"],
                "type": circuit["type"],
                "direction": circuit["direction"],
                "sourceType": "fastf1-telemetry-true-sector",
                "viewBox": "0 0 300 180",
                "detailedPath": build_line_path(simplified),
                "miniPath": build_line_path(mini),
                "sectorPaths": sector_paths,
                "startFinish": markers["startFinish"],
                "sectors": markers["sectors"],
                "sectorColors": SECTOR_COLORS,
                "render": {"strokeWidth": 2.8, "strokeLinecap": "round", "strokeLinejoin": "round"},
                "animation": {"library": "animejs", "motionPath": True, "sectorReveal": True},
                "attribution": "Track shape and sector timing derived from FastF1 telemetry data",
            }

            debug[track_id].update({
                "status": "ok",
                "rawPointCount": len(raw_points),
                "transformedPointCount": len(transformed),
                "svgPointsCount": len(simplified),
                "miniPointsCount": len(mini),
                "sectorPaths": [{"label": s["label"], "pointCount": s["pointCount"], "trueSectorBoundary": s["trueSectorBoundary"]} for s in sector_paths],
                "transform": transform,
            })

            print(f"  ✓ raw:{len(raw_points)} → svg:{len(simplified)} → sectors:{'/'.join(str(s['pointCount']) for s in sector_paths)}")

        except Exception as exc:
            debug[track_id] = {"status": "error", "error": str(exc), "trace": traceback.format_exc(limit=2)}
            print(f"  ✗ {exc}")

        print()

    banner = """// AUTO-GENERATED by scripts/buildTracksFastF1.py
// Track shapes and sector paths are derived from FastF1 fastest-lap telemetry where available.

"""

    (OUT_DIR / "paddoxTracks.generated.js").write_text(
        banner + "export const paddoxTracks = " + json.dumps(tracks, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )

    (OUT_DIR / "paddoxTracks.debug.json").write_text(json.dumps(debug, indent=2, ensure_ascii=False), encoding="utf-8")
    (PREVIEW_DIR / "paddox-tracks-preview.html").write_text(build_preview_html(tracks, debug), encoding="utf-8")

    print(f"Wrote {len(tracks)}/{len(CIRCUITS)} circuits.")
    print(f"Dataset → {OUT_DIR / 'paddoxTracks.generated.js'}")
    print(f"Debug   → {OUT_DIR / 'paddoxTracks.debug.json'}")
    print(f"Preview → {PREVIEW_DIR / 'paddox-tracks-preview.html'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
