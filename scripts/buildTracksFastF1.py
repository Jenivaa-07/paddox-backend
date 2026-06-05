#!/usr/bin/env python3
"""
scripts/buildTracksFastF1.py

PADDOX — FastF1 Track Shape Generator
STAGE 1: FastF1 fastest-lap telemetry X/Y points
STAGE 2: normalized svgPoints inside viewBox 0 0 300 180
STAGE 3: detailedPath / smoothPath / miniPath for PADDOX UI

Run from paddox-backend:

  pip install -r scripts/requirements-trackgen.txt
  python scripts/buildTracksFastF1.py

Output goes to the sibling frontend repo:

  ../paddox-frontend/data/paddoxTracks.generated.js
  ../paddox-frontend/data/paddoxTracks.debug.json
  ../paddox-frontend/previews/paddox-tracks-preview.html
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import fastf1
import numpy as np
import pandas as pd


# ═══════════════════════════════════════════════════════════════
# PROJECT PATHS — based on your real repo setup:
#
# Desktop/Paddox/
#   paddox-backend/
#   paddox-frontend/
# ═══════════════════════════════════════════════════════════════

OUT_DIR = Path("../paddox-frontend/data")
PREVIEW_DIR = Path("../paddox-frontend/previews")
CACHE_DIR = Path("./scripts/fastf1-cache")

VIEW_W = 300
VIEW_H = 180
PAD = 22

# FastF1 can be slow while caching data for the first time.
# Keep this true for best data quality.
LOAD_TELEMETRY = True


# ═══════════════════════════════════════════════════════════════
# CIRCUIT REGISTRY
#
# event: FastF1 event name or known alias.
# year/session are selected from real historical data that exists.
#
# NOTE:
# - Madrid has no FastF1 telemetry yet because it is future/new.
# - Istanbul Park and Portimão are included from older F1 seasons.
# - If a session fails, fallbacks are tried automatically.
# ═══════════════════════════════════════════════════════════════

CIRCUITS: List[Dict[str, Any]] = [
    {
        "id": "albert_park",
        "circuitName": "Albert Park Circuit",
        "raceName": "Australian Grand Prix",
        "country": "Australia",
        "location": "Melbourne",
        "type": "street",
        "direction": "clockwise",
        "event": "Australian Grand Prix",
        "attempts": [(2025, "Australian Grand Prix", "Q"), (2024, "Australian Grand Prix", "Q"), (2023, "Australian Grand Prix", "Q")],
    },
    {
        "id": "shanghai",
        "circuitName": "Shanghai International Circuit",
        "raceName": "Chinese Grand Prix",
        "country": "China",
        "location": "Shanghai",
        "type": "race",
        "direction": "clockwise",
        "event": "Chinese Grand Prix",
        "attempts": [(2025, "Chinese Grand Prix", "Q"), (2024, "Chinese Grand Prix", "Q"), (2019, "Chinese Grand Prix", "Q")],
    },
    {
        "id": "suzuka",
        "circuitName": "Suzuka Circuit",
        "raceName": "Japanese Grand Prix",
        "country": "Japan",
        "location": "Suzuka",
        "type": "race",
        "direction": "clockwise",
        "event": "Japanese Grand Prix",
        "attempts": [(2025, "Japanese Grand Prix", "Q"), (2024, "Japanese Grand Prix", "Q"), (2023, "Japanese Grand Prix", "Q")],
    },
    {
        "id": "bahrain",
        "circuitName": "Bahrain International Circuit",
        "raceName": "Bahrain Grand Prix",
        "country": "Bahrain",
        "location": "Sakhir",
        "type": "race",
        "direction": "clockwise",
        "event": "Bahrain Grand Prix",
        "attempts": [(2025, "Bahrain Grand Prix", "Q"), (2024, "Bahrain Grand Prix", "Q"), (2023, "Bahrain Grand Prix", "Q")],
    },
    {
        "id": "jeddah",
        "circuitName": "Jeddah Corniche Circuit",
        "raceName": "Saudi Arabian Grand Prix",
        "country": "Saudi Arabia",
        "location": "Jeddah",
        "type": "street",
        "direction": "counter-clockwise",
        "event": "Saudi Arabian Grand Prix",
        "attempts": [(2025, "Saudi Arabian Grand Prix", "Q"), (2024, "Saudi Arabian Grand Prix", "Q"), (2023, "Saudi Arabian Grand Prix", "Q")],
    },
    {
        "id": "miami",
        "circuitName": "Miami International Autodrome",
        "raceName": "Miami Grand Prix",
        "country": "United States",
        "location": "Miami",
        "type": "street",
        "direction": "counter-clockwise",
        "event": "Miami Grand Prix",
        "attempts": [(2025, "Miami Grand Prix", "Q"), (2024, "Miami Grand Prix", "Q"), (2023, "Miami Grand Prix", "Q")],
    },
    {
        "id": "imola",
        "circuitName": "Autodromo Internazionale Enzo e Dino Ferrari",
        "raceName": "Emilia Romagna Grand Prix",
        "country": "Italy",
        "location": "Imola",
        "type": "race",
        "direction": "counter-clockwise",
        "event": "Emilia Romagna Grand Prix",
        "attempts": [(2025, "Emilia Romagna Grand Prix", "Q"), (2024, "Emilia Romagna Grand Prix", "Q"), (2022, "Emilia Romagna Grand Prix", "Q")],
    },
    {
        "id": "monaco",
        "circuitName": "Circuit de Monaco",
        "raceName": "Monaco Grand Prix",
        "country": "Monaco",
        "location": "Monte Carlo",
        "type": "street",
        "direction": "clockwise",
        "event": "Monaco Grand Prix",
        "attempts": [(2025, "Monaco Grand Prix", "Q"), (2024, "Monaco Grand Prix", "Q"), (2023, "Monaco Grand Prix", "Q")],
    },
    {
        "id": "gilles_villeneuve",
        "circuitName": "Circuit Gilles Villeneuve",
        "raceName": "Canadian Grand Prix",
        "country": "Canada",
        "location": "Montreal",
        "type": "street",
        "direction": "clockwise",
        "event": "Canadian Grand Prix",
        "attempts": [(2025, "Canadian Grand Prix", "Q"), (2024, "Canadian Grand Prix", "Q"), (2023, "Canadian Grand Prix", "Q")],
    },
    {
        "id": "barcelona_catalunya",
        "circuitName": "Circuit de Barcelona-Catalunya",
        "raceName": "Spanish Grand Prix",
        "country": "Spain",
        "location": "Montmeló",
        "type": "race",
        "direction": "clockwise",
        "event": "Spanish Grand Prix",
        "attempts": [(2025, "Spanish Grand Prix", "Q"), (2024, "Spanish Grand Prix", "Q"), (2023, "Spanish Grand Prix", "Q")],
    },
    {
        "id": "madrid_madring",
        "circuitName": "Madring",
        "raceName": "Spanish Grand Prix",
        "country": "Spain",
        "location": "Madrid",
        "type": "street",
        "direction": "clockwise",
        "event": "Madrid Grand Prix",
        "attempts": [],
        "futureOnly": True,
        "note": "No FastF1 telemetry exists yet for Madring. Add manual SVG until the first official session exists.",
    },
    {
        "id": "red_bull_ring",
        "circuitName": "Red Bull Ring",
        "raceName": "Austrian Grand Prix",
        "country": "Austria",
        "location": "Spielberg",
        "type": "race",
        "direction": "clockwise",
        "event": "Austrian Grand Prix",
        "attempts": [(2025, "Austrian Grand Prix", "Q"), (2024, "Austrian Grand Prix", "Q"), (2023, "Austrian Grand Prix", "Q")],
    },
    {
        "id": "silverstone",
        "circuitName": "Silverstone Circuit",
        "raceName": "British Grand Prix",
        "country": "United Kingdom",
        "location": "Silverstone",
        "type": "race",
        "direction": "clockwise",
        "event": "British Grand Prix",
        "attempts": [(2025, "British Grand Prix", "Q"), (2024, "British Grand Prix", "Q"), (2023, "British Grand Prix", "Q")],
    },
    {
        "id": "spa",
        "circuitName": "Circuit de Spa-Francorchamps",
        "raceName": "Belgian Grand Prix",
        "country": "Belgium",
        "location": "Stavelot",
        "type": "race",
        "direction": "clockwise",
        "event": "Belgian Grand Prix",
        "attempts": [(2025, "Belgian Grand Prix", "Q"), (2024, "Belgian Grand Prix", "Q"), (2023, "Belgian Grand Prix", "Q")],
    },
    {
        "id": "hungaroring",
        "circuitName": "Hungaroring",
        "raceName": "Hungarian Grand Prix",
        "country": "Hungary",
        "location": "Mogyoród",
        "type": "race",
        "direction": "clockwise",
        "event": "Hungarian Grand Prix",
        "attempts": [(2025, "Hungarian Grand Prix", "Q"), (2024, "Hungarian Grand Prix", "Q"), (2023, "Hungarian Grand Prix", "Q")],
    },
    {
        "id": "zandvoort",
        "circuitName": "Circuit Zandvoort",
        "raceName": "Dutch Grand Prix",
        "country": "Netherlands",
        "location": "Zandvoort",
        "type": "race",
        "direction": "clockwise",
        "event": "Dutch Grand Prix",
        "attempts": [(2025, "Dutch Grand Prix", "Q"), (2024, "Dutch Grand Prix", "Q"), (2023, "Dutch Grand Prix", "Q")],
    },
    {
        "id": "monza",
        "circuitName": "Autodromo Nazionale Monza",
        "raceName": "Italian Grand Prix",
        "country": "Italy",
        "location": "Monza",
        "type": "race",
        "direction": "clockwise",
        "event": "Italian Grand Prix",
        "attempts": [(2025, "Italian Grand Prix", "Q"), (2024, "Italian Grand Prix", "Q"), (2023, "Italian Grand Prix", "Q")],
    },
    {
        "id": "baku",
        "circuitName": "Baku City Circuit",
        "raceName": "Azerbaijan Grand Prix",
        "country": "Azerbaijan",
        "location": "Baku",
        "type": "street",
        "direction": "counter-clockwise",
        "event": "Azerbaijan Grand Prix",
        "attempts": [(2025, "Azerbaijan Grand Prix", "Q"), (2024, "Azerbaijan Grand Prix", "Q"), (2023, "Azerbaijan Grand Prix", "Q")],
    },
    {
        "id": "marina_bay",
        "circuitName": "Marina Bay Street Circuit",
        "raceName": "Singapore Grand Prix",
        "country": "Singapore",
        "location": "Singapore",
        "type": "street",
        "direction": "counter-clockwise",
        "event": "Singapore Grand Prix",
        "attempts": [(2025, "Singapore Grand Prix", "Q"), (2024, "Singapore Grand Prix", "Q"), (2023, "Singapore Grand Prix", "Q")],
    },
    {
        "id": "cota",
        "circuitName": "Circuit of The Americas",
        "raceName": "United States Grand Prix",
        "country": "United States",
        "location": "Austin",
        "type": "race",
        "direction": "counter-clockwise",
        "event": "United States Grand Prix",
        "attempts": [(2025, "United States Grand Prix", "Q"), (2024, "United States Grand Prix", "Q"), (2023, "United States Grand Prix", "Q")],
    },
    {
        "id": "mexico_city",
        "circuitName": "Autódromo Hermanos Rodríguez",
        "raceName": "Mexico City Grand Prix",
        "country": "Mexico",
        "location": "Mexico City",
        "type": "race",
        "direction": "clockwise",
        "event": "Mexico City Grand Prix",
        "attempts": [(2025, "Mexico City Grand Prix", "Q"), (2024, "Mexico City Grand Prix", "Q"), (2023, "Mexico City Grand Prix", "Q")],
    },
    {
        "id": "interlagos",
        "circuitName": "Autódromo José Carlos Pace",
        "raceName": "São Paulo Grand Prix",
        "country": "Brazil",
        "location": "São Paulo",
        "type": "race",
        "direction": "counter-clockwise",
        "event": "São Paulo Grand Prix",
        "attempts": [(2025, "São Paulo Grand Prix", "Q"), (2024, "São Paulo Grand Prix", "Q"), (2023, "São Paulo Grand Prix", "Q")],
    },
    {
        "id": "las_vegas",
        "circuitName": "Las Vegas Strip Circuit",
        "raceName": "Las Vegas Grand Prix",
        "country": "United States",
        "location": "Las Vegas",
        "type": "street",
        "direction": "counter-clockwise",
        "event": "Las Vegas Grand Prix",
        "attempts": [(2025, "Las Vegas Grand Prix", "Q"), (2024, "Las Vegas Grand Prix", "Q"), (2023, "Las Vegas Grand Prix", "Q")],
    },
    {
        "id": "lusail",
        "circuitName": "Lusail International Circuit",
        "raceName": "Qatar Grand Prix",
        "country": "Qatar",
        "location": "Lusail",
        "type": "race",
        "direction": "clockwise",
        "event": "Qatar Grand Prix",
        "attempts": [(2025, "Qatar Grand Prix", "Q"), (2024, "Qatar Grand Prix", "Q"), (2023, "Qatar Grand Prix", "Q")],
    },
    {
        "id": "yas_marina",
        "circuitName": "Yas Marina Circuit",
        "raceName": "Abu Dhabi Grand Prix",
        "country": "United Arab Emirates",
        "location": "Abu Dhabi",
        "type": "race",
        "direction": "counter-clockwise",
        "event": "Abu Dhabi Grand Prix",
        "attempts": [(2025, "Abu Dhabi Grand Prix", "Q"), (2024, "Abu Dhabi Grand Prix", "Q"), (2023, "Abu Dhabi Grand Prix", "Q")],
    },
    {
        "id": "istanbul_park",
        "circuitName": "Istanbul Park",
        "raceName": "Turkish Grand Prix",
        "country": "Turkey",
        "location": "Istanbul",
        "type": "race",
        "direction": "counter-clockwise",
        "event": "Turkish Grand Prix",
        "attempts": [(2021, "Turkish Grand Prix", "Q"), (2020, "Turkish Grand Prix", "Q")],
    },
    {
        "id": "portimao",
        "circuitName": "Algarve International Circuit",
        "raceName": "Portuguese Grand Prix",
        "country": "Portugal",
        "location": "Portimão",
        "type": "race",
        "direction": "clockwise",
        "event": "Portuguese Grand Prix",
        "attempts": [(2021, "Portuguese Grand Prix", "Q"), (2020, "Portuguese Grand Prix", "Q")],
    },
]


# ═══════════════════════════════════════════════════════════════
# FASTF1 DATA
# ═══════════════════════════════════════════════════════════════

def setup_fastf1() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(CACHE_DIR))


def try_load_session(year: int, event: str, session_code: str):
    session = fastf1.get_session(year, event, session_code)
    session.load(
        laps=True,
        telemetry=LOAD_TELEMETRY,
        weather=False,
        messages=False,
    )
    return session


def extract_xy_from_session(session) -> Tuple[List[Tuple[float, float]], Dict[str, Any]]:
    # Prefer qualifying fastest lap for a clean, representative racing line.
    fastest = session.laps.pick_fastest()

    if fastest is None or pd.isna(fastest.get("LapTime", None)):
        raise RuntimeError("No fastest lap available")

    driver = str(fastest.get("Driver", ""))
    lap_time = str(fastest.get("LapTime", ""))

    tel = fastest.get_telemetry()

    if "X" not in tel.columns or "Y" not in tel.columns:
        raise RuntimeError("Telemetry does not contain X/Y position columns")

    xy = tel[["X", "Y"]].replace([np.inf, -np.inf], np.nan).dropna()

    # Remove stationary/duplicate points
    coords: List[Tuple[float, float]] = []
    last: Optional[Tuple[float, float]] = None

    for row in xy.itertuples(index=False):
        x = float(row.X)
        y = float(row.Y)
        point = (x, y)

        if last is None or math.hypot(point[0] - last[0], point[1] - last[1]) > 1.0:
            coords.append(point)
            last = point

    if len(coords) < 30:
        raise RuntimeError(f"Not enough X/Y telemetry points: {len(coords)}")

    meta = {
        "driver": driver,
        "lapTime": lap_time,
        "rawTelemetryPoints": len(coords),
    }

    return coords, meta


def get_track_coordinates(circuit: Dict[str, Any]) -> Tuple[Optional[List[Tuple[float, float]]], Dict[str, Any]]:
    attempts = circuit.get("attempts", [])

    if not attempts:
        return None, {
            "status": "skipped",
            "reason": circuit.get("note", "No FastF1 attempts configured"),
        }

    errors = []

    for year, event, session_code in attempts:
        try:
            print(f"  trying {year} {event} {session_code} ...", end=" ")
            session = try_load_session(year, event, session_code)
            coords, meta = extract_xy_from_session(session)
            print(f"ok ({len(coords)} pts, {meta.get('driver')})")

            return coords, {
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

    return None, {
        "status": "failed",
        "errors": errors[-5:],
    }


# ═══════════════════════════════════════════════════════════════
# GEOMETRY / SVG
# ═══════════════════════════════════════════════════════════════

def round2(value: float) -> float:
    return round(float(value), 2)


def rdp(points: List[Tuple[float, float]], eps: float) -> List[Tuple[float, float]]:
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


def perpendicular_distance(point, start, end) -> float:
    x, y = point
    x1, y1 = start
    x2, y2 = end

    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy) or 1e-9

    return abs(dx * (y1 - y) - dy * (x1 - x)) / length


def simplify_eps(points: List[Tuple[float, float]], knob: float) -> float:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    diag = math.hypot(max(xs) - min(xs), max(ys) - min(ys)) or 1
    return (diag / 300.0) * knob


def normalize_points(
    points: List[Tuple[float, float]],
    simplify: float = 0.55,
    width: int = VIEW_W,
    height: int = VIEW_H,
    pad: int = PAD,
) -> List[Dict[str, float]]:
    if len(points) < 2:
        return []

    cleaned = rdp(points, simplify_eps(points, simplify))

    xs = [p[0] for p in cleaned]
    ys = [p[1] for p in cleaned]

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    bw = max(max_x - min_x, 1)
    bh = max(max_y - min_y, 1)

    scale = min((width - 2 * pad) / bw, (height - 2 * pad) / bh)

    ox = (width - bw * scale) / 2 - min_x * scale
    oy = (height - bh * scale) / 2 - min_y * scale

    return [{"x": round2(x * scale + ox), "y": round2(y * scale + oy)} for x, y in cleaned]


def is_closed_loop(points: List[Dict[str, float]]) -> bool:
    if len(points) < 3:
        return False

    first = points[0]
    last = points[-1]

    return math.hypot(first["x"] - last["x"], first["y"] - last["y"]) < 10


def build_line_path(points: List[Dict[str, float]], should_close: bool = True) -> str:
    if not points:
        return ""

    d = f'M {points[0]["x"]} {points[0]["y"]}'

    for point in points[1:]:
        d += f' L {point["x"]} {point["y"]}'

    if should_close and is_closed_loop(points):
        d += " Z"

    return d


def build_smooth_path(points: List[Dict[str, float]], should_close: bool = True) -> str:
    if len(points) < 2:
        return ""

    closed = should_close and is_closed_loop(points)
    pts = points + [points[0]] if closed else points[:]

    d = f'M {pts[0]["x"]} {pts[0]["y"]} '

    for i in range(0, len(pts) - 1):
        p0 = pts[i - 1] if i > 0 else pts[i]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[i + 2] if i + 2 < len(pts) else p2

        c1x = p1["x"] + (p2["x"] - p0["x"]) / 6
        c1y = p1["y"] + (p2["y"] - p0["y"]) / 6
        c2x = p2["x"] - (p3["x"] - p1["x"]) / 6
        c2y = p2["y"] - (p3["y"] - p1["y"]) / 6

        d += f'C {round2(c1x)} {round2(c1y)} {round2(c2x)} {round2(c2y)} {p2["x"]} {p2["y"]} '

    if closed:
        d += "Z"

    return d.strip()


def cumulative_distances(points: List[Dict[str, float]]) -> List[float]:
    distances = [0.0]

    for i in range(1, len(points)):
        prev = points[i - 1]
        curr = points[i]
        distances.append(distances[-1] + math.hypot(curr["x"] - prev["x"], curr["y"] - prev["y"]))

    return distances


def interpolate_at(points: List[Dict[str, float]], distances: List[float], target: float) -> Dict[str, float]:
    for i in range(1, len(distances)):
        if distances[i] >= target:
            prev_d = distances[i - 1]
            span = distances[i] - prev_d or 1
            t = (target - prev_d) / span

            return {
                "x": round2(points[i - 1]["x"] + (points[i]["x"] - points[i - 1]["x"]) * t),
                "y": round2(points[i - 1]["y"] + (points[i]["y"] - points[i - 1]["y"]) * t),
            }

    return {"x": points[-1]["x"], "y": points[-1]["y"]}


def markers_from_distance(points: List[Dict[str, float]]) -> Dict[str, Any]:
    if not points:
        return {
            "startFinish": {"x": 0, "y": 0},
            "sectors": [],
        }

    distances = cumulative_distances(points)
    total = distances[-1] or 1

    return {
        "startFinish": {"x": points[0]["x"], "y": points[0]["y"]},
        "sectors": [
            {"label": "S1", **interpolate_at(points, distances, total * 0.333)},
            {"label": "S2", **interpolate_at(points, distances, total * 0.666)},
            {"label": "S3", **interpolate_at(points, distances, total * 0.86)},
        ],
    }


# ═══════════════════════════════════════════════════════════════
# PREVIEW HTML
# ═══════════════════════════════════════════════════════════════

def html_escape(value: Any) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build_preview_html(tracks: Dict[str, Any], debug: Dict[str, Any]) -> str:
    cards = []

    for track_id, track in tracks.items():
        dbg = debug.get(track_id, {})
        source_line = f'{dbg.get("sourceYear", "")} {dbg.get("sourceSession", "")} • {dbg.get("driver", "")}'.strip()

        sector_html = "".join(
            f'<text x="{s["x"]}" y="{s["y"]}" class="sector">{html_escape(s["label"])}</text>'
            for s in track.get("sectors", [])
        )

        cards.append(
            f"""
            <article class="card">
              <div class="meta">
                <h2>{html_escape(track["circuitName"])}</h2>
                <p>{html_escape(track["raceName"])} • {html_escape(track["location"])}, {html_escape(track["country"])}</p>
                <small>{html_escape(track.get("svgPointsCount", ""))} points • {html_escape(track.get("sourceType", ""))} • {html_escape(source_line)}</small>
              </div>
              <svg viewBox="{track["viewBox"]}" role="img" aria-label="{html_escape(track["circuitName"])} track preview">
                <path d="{track["detailedPath"]}" class="track shadow" />
                <path d="{track["detailedPath"]}" class="track main" />
                <circle cx="{track["startFinish"]["x"]}" cy="{track["startFinish"]["y"]}" r="4" class="start" />
                {sector_html}
              </svg>
            </article>
            """
        )

    failed_cards = []

    for item in CIRCUITS:
        if item["id"] not in tracks:
            dbg = debug.get(item["id"], {})
            failed_cards.append(
                f"""
                <article class="card failed">
                  <div class="meta">
                    <h2>{html_escape(item["circuitName"])}</h2>
                    <p>{html_escape(item["raceName"])} • {html_escape(item["location"])}, {html_escape(item["country"])}</p>
                    <small>Not generated • {html_escape(dbg.get("reason", dbg.get("status", "failed")))}</small>
                  </div>
                  <div class="placeholder">NO FASTF1 TRACK SHAPE YET</div>
                </article>
                """
            )

    all_cards = "\n".join(cards + failed_cards)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PADDOX FastF1 Track Preview</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #070707; color: #fff; font-family: Inter, Arial, sans-serif; padding: 28px; }}
    h1 {{ margin: 0 0 8px; font-size: 34px; letter-spacing: .04em; }}
    .lead {{ color: #aaa; margin: 0 0 24px; max-width: 900px; line-height: 1.6; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }}
    .card {{ border: 1px solid rgba(255,255,255,.1); border-radius: 22px; background: linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.03)); padding: 18px; box-shadow: 0 22px 55px rgba(0,0,0,.45); overflow: hidden; }}
    .card.failed {{ opacity: .72; }}
    .meta h2 {{ font-size: 18px; margin: 0 0 6px; }}
    .meta p {{ margin: 0; color: #c9c9c9; }}
    .meta small {{ display: block; color: #777; margin-top: 6px; }}
    svg {{ width: 100%; height: auto; margin-top: 14px; overflow: visible; background: radial-gradient(circle at 50% 50%, rgba(225,6,0,.11), transparent 58%); border-radius: 18px; }}
    .track {{ fill: none; stroke-linecap: round; stroke-linejoin: round; }}
    .track.shadow {{ stroke: #000; stroke-width: 10; opacity: .65; }}
    .track.main {{ stroke: #f4f4f4; stroke-width: 5; }}
    .start {{ fill: #e10600; stroke: white; stroke-width: 1.5; }}
    .sector {{ fill: #e10600; font-size: 12px; font-weight: 800; paint-order: stroke; stroke: #070707; stroke-width: 3px; stroke-linejoin: round; }}
    .placeholder {{ height: 170px; margin-top: 14px; border-radius: 18px; display: grid; place-items: center; color: #666; border: 1px dashed rgba(255,255,255,.16); background: rgba(255,255,255,.03); font-weight: 800; letter-spacing: .08em; }}
  </style>
</head>
<body>
  <h1>PADDOX FastF1 Track Preview</h1>
  <p class="lead">Generated from FastF1 fastest-lap X/Y telemetry. Use this visual QA page before locking the generated tracks into Home Track Mode or Fan Hub Race Calendar.</p>
  <section class="grid">{all_cards}</section>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main() -> int:
    setup_fastf1()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    tracks: Dict[str, Any] = {}
    debug: Dict[str, Any] = {}

    print("PADDOX FastF1 Track Generator")
    print("Output:", OUT_DIR.resolve())
    print("Cache :", CACHE_DIR.resolve())
    print()

    for circuit in CIRCUITS:
        track_id = circuit["id"]
        print(f"{track_id.ljust(22)}")

        try:
            coords, meta = get_track_coordinates(circuit)
            debug[track_id] = {
                **meta,
                "circuitName": circuit["circuitName"],
                "raceName": circuit["raceName"],
            }

            if not coords:
                print(f"  ✗ skipped/failed")
                continue

            svg_points = normalize_points(coords, simplify=circuit.get("simplify", 0.55))
            svg_points_mini = normalize_points(coords, simplify=circuit.get("miniSimplify", 2.1))

            if len(svg_points) < 10:
                raise RuntimeError(f"Not enough normalized SVG points: {len(svg_points)}")

            markers = markers_from_distance(svg_points)

            detailed_path = build_line_path(svg_points, should_close=True)
            smooth_path = build_smooth_path(svg_points, should_close=True)
            mini_path = build_line_path(svg_points_mini, should_close=True)

            tracks[track_id] = {
                "id": track_id,
                "circuitName": circuit["circuitName"],
                "raceName": circuit["raceName"],
                "country": circuit["country"],
                "location": circuit["location"],
                "type": circuit["type"],
                "direction": circuit["direction"],
                "sourceType": "fastf1-telemetry",
                "viewBox": "0 0 300 180",
                "detailedPath": detailed_path,
                "smoothPath": smooth_path,
                "miniPath": mini_path,
                "startFinish": markers["startFinish"],
                "sectors": markers["sectors"],
                "render": {
                    "strokeWidth": 5,
                    "strokeLinecap": "round",
                    "strokeLinejoin": "round",
                },
                "attribution": "Track shape derived from FastF1 telemetry data",
            }

            debug[track_id].update({
                "status": "ok",
                "rawPointCount": len(coords),
                "svgPointsCount": len(svg_points),
                "miniPointsCount": len(svg_points_mini),
                "svgPointsSample": svg_points[:5],
            })

            tracks[track_id]["svgPointsCount"] = len(svg_points)

            print(f"  ✓ raw:{len(coords)} → svg:{len(svg_points)}")

        except Exception as exc:
            debug[track_id] = {
                "status": "error",
                "error": str(exc),
                "trace": traceback.format_exc(limit=2),
            }
            print(f"  ✗ {exc}")

        print()

    clean_tracks = json.loads(json.dumps(tracks))

    for track in clean_tracks.values():
        track.pop("svgPointsCount", None)

    banner = """// AUTO-GENERATED by scripts/buildTracksFastF1.py
// Track shapes are derived from FastF1 telemetry X/Y data where available.

"""

    (OUT_DIR / "paddoxTracks.generated.js").write_text(
        banner + "export const paddoxTracks = " + json.dumps(clean_tracks, indent=2, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )

    (OUT_DIR / "paddoxTracks.debug.json").write_text(
        json.dumps(debug, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    (PREVIEW_DIR / "paddox-tracks-preview.html").write_text(
        build_preview_html(tracks, debug),
        encoding="utf-8",
    )

    print(f"Wrote {len(clean_tracks)}/{len(CIRCUITS)} circuits.")
    print(f"Dataset → {OUT_DIR / 'paddoxTracks.generated.js'}")
    print(f"Debug   → {OUT_DIR / 'paddoxTracks.debug.json'}")
    print(f"Preview → {PREVIEW_DIR / 'paddox-tracks-preview.html'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
