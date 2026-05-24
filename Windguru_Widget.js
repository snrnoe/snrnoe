// ═══════════════════════════════════════════════════════════════════════════
// WINDGURU / WINDY KITE WIDGET für Scriptable — Sardinien & Holland
// Spots: La Cinta, Porto Pino, La Caletta, Chia, Porto Pollo
// Größenabhängiges Layout:
//   • Small             → Standort + aktueller Wert + Kompass + 3h-Forecast
//   • Medium            → nächste 4h, stündlich
//   • Large             → Tagesübersicht 7–19 Uhr, 2h-Raster
//   • accessoryCircular → Sperrbildschirm: Kompass-Ring mit Richtungs-Punkt,
//                         Tages-Peak (09–17 Uhr) als Zahl in der Mitte
// Datenquelle (pro Spot per Lat/Lon):
//   • Italien/Sardinien → Windy Point Forecast API (ECMWF; Key aus Keychain)
//   • Niederlande       → Windguru iapi.php (GFS → ICON → Zephr-HD Fallback)
//   • sonst             → Windguru als Default
// ═══════════════════════════════════════════════════════════════════════════

// ─── VERSIONIERUNG ──────────────────────────────────────────────────────────
// Semantic Versioning: MAJOR.MINOR.PATCH
const WIDGET_VERSION = "2.9.2";
const WIDGET_BUILD   = "2026-05-24";

// Maschinenlesbare Metadaten (für automatische Auswertung der Frontend-Lösung).
// Kann von Tools per JSON.parse(WIDGET_META) ausgewertet werden.
const WIDGET_META = JSON.stringify({
  name: "Windguru/Windy Kite Widget",
  version: WIDGET_VERSION,
  build: WIDGET_BUILD,
  platform: "scriptable",
  sizes: ["small", "medium", "large", "accessoryCircular"],
  dataSources: {
    windguru: { endpoint: "windguru.cz/int/iapi.php", models: [3, 45, 64] },
    windy:    { endpoint: "api.windy.com/api/point-forecast/v2", model: "ecmwf" }
  },
  sourceRouting: "per-spot by lat/lon (IT→windy, NL→windguru)",
  features: [
    "size-adaptive-layout",
    "wind-color-coding",
    "kitebar-indicator",
    "compass-vane",
    "offline-cache",
    "tap-to-open",
    "stale-indicator",
    "lockscreen-circular",
    "multi-source-routing",
    "auto-coord-resolution",
    "arbitrary-spot-id-via-parameter",
    "gps-location-mode"
  ],
  windColorScale: { blue: "<9kn", green: "9-15kn", yellow: "15-25kn", red: ">25kn" },
  dayWindow: { start: 7, end: 19 },
  lockWindow: { start: 9, end: 17 }
});

// Changelog (Kurzform):
//   2.9.2  Default-Windy-Model auf "gfs" (Free-Tier-kompatibel; ECMWF nur Premium). HTTP-Status in Diagnose.
//   2.9.1  Diagnose: Error-State zeigt die konkrete Fehlermeldung pro Quelle (Key-Status, errorMsg, Request-Fehler)
//   2.9.0  GPS-Modus: Parameter "auto" → nächster bekannter Spot oder Ad-hoc per Reverse-Geocoding. "here"/"gps" → exakte Position. Villasimius zu SPOTS.
//   2.8.0  Coord-Auto-Resolver: Spots brauchen nur noch { id, name }; lat/lon werden von Windguru geholt + gecached. Widget-Parameter akzeptiert beliebige Spot-IDs.
//   2.7.0  Multi-Source: Windy Point Forecast API für Sardinien (ECMWF), Windguru für NL; Routing per Spot-Lat/Lon
//   2.6.0  Sperrbildschirm-Widget (accessoryCircular): Kompass-Ring + Richtungs-Punkt + Tages-Peak (09–17 Uhr) mittig
//   2.5.2  Cleanup: unused helpers entfernt (windTrend, dayPeak, nextInWindow, fixedCellRight)
//   2.5.1  Kompass: Nadel auf Ring, blauer Ring fix, rote Nadel, nur N/O/S/W
//   2.5.0  Windrose-Kompass: klassisches Marine-Design
//   2.4.2  Kitefenster: Wind ≥ 10kn, Böen ≤ 30kn
//   2.4.0  Layout-Entschlackung: alle Höhenbudgets kalibriert
//   2.3.0  Footer: bestes Kitefenster (11–17 kn, min. Böen-Spreizung) statt nächste 3h
//   2.2.0  Header: Spot+Zeit links gestapelt, Kompass ganz rechts; Main: Labels unter Zahlen
//   2.1.0  Layout-Fix Small: Header 1-zeilig, Kompass 44px, Footer-Spalten
//   2.0.0  Apple-Style Redesign: Glow-BG, Hero-Wind, Kompass in Ecke, Versionierung
//   1.x    Stack-Layouts, Kompass-Windfahne, Offline-Cache, Multi-Spot


// ─── DEINE SPOTS ────────────────────────────────────────────────────────────
// Spots brauchen mindestens { id, name }. lat/lon sind optional — fehlen sie,
// holt sie der Coord-Resolver beim ersten Lauf von Windguru und cached sie.
//   • Spot-ID steht in der windguru.cz-URL, z.B. windguru.cz/49159
//   • lat/lon (optional) sparen den ersten Netzwerk-Call und sind Override
//   • source: "windy" | "windguru" (optional) überschreibt die Auto-Wahl
const SPOTS = [
  { id: 49159,         name: "La Cinta",     lat: 40.7775, lon: 9.7203 },
  { id: 208230,        name: "Porto Pino",   lat: 38.9419, lon: 8.7806 },
  { id: 501232,        name: "La Caletta",   lat: 40.6094, lon: 9.7547 },
  { id: 1522,          name: "Chia",         lat: 38.8856, lon: 8.8964 },
  { id: 278,           name: "Porto Pollo",  lat: 41.1819, lon: 9.3458 },
  { id: "villasimius", name: "Villasimius",  lat: 39.1393, lon: 9.5172 },
];

// Quellen-Routing: aus den Spot-Koordinaten ableiten, welche API zuständig ist.
// • Italien (inkl. Sardinien) → Windy   (besseres ECMWF im Mittelmeer)
// • Niederlande               → Windguru
// • alles andere              → Windguru als Default
function pickSource(spot) {
  if (spot.source === "windy" || spot.source === "windguru") return spot.source;
  const { lat, lon } = spot;
  if (lat == null || lon == null) return "windguru";
  // Italien-Bounding-Box (inkl. Sardinien, Sizilien)
  if (lat >= 35.5 && lat <= 47.2 && lon >= 6.6 && lon <= 18.6) return "windy";
  // Niederlande-Bounding-Box
  if (lat >= 50.7 && lat <= 53.8 && lon >= 3.2 && lon <= 7.4) return "windguru";
  return "windguru";
}

// Spot-Auswahl per Widget-Parameter. Akzeptiert:
//   • Index 0..N-1 (kleine Zahl im SPOTS-Bereich)
//   • Name aus SPOTS (Groß-/Kleinschreibung egal)
//   • Bekannte Windguru-Spot-ID aus SPOTS
//   • BELIEBIGE Windguru-Spot-ID (auch nicht in SPOTS) — Coords werden
//     dann beim ersten Lauf via resolveCoords() automatisch geholt
//   • Format "<id>:<Name>" um eine ad-hoc Bezeichnung mitzugeben
//   • "auto" / "nearby" → GPS-Standort, dann nächster bekannter Spot (≤ 25 km),
//                         sonst Ad-hoc-Spot an deiner Position (mit Ortsnamen)
//   • "here" / "gps"     → IMMER Ad-hoc-Spot an deiner exakten GPS-Position
function pickSpot() {
  const param = (typeof args !== "undefined" && args.widgetParameter)
    ? String(args.widgetParameter).trim() : null;
  if (!param) return SPOTS[0];

  // Standort-Modi (echte Auflösung passiert async in buildWidget)
  const low = param.toLowerCase();
  if (low === "auto" || low === "nearby")  return { __auto: true, mode: "nearby" };
  if (low === "here" || low === "gps")     return { __auto: true, mode: "here" };

  // "<id>:<Name>" — ad-hoc Spot mit Wunschnamen
  const labeled = param.match(/^(\d{2,8})\s*[:|]\s*(.+)$/);
  if (labeled) {
    const id = parseInt(labeled[1], 10);
    const known = SPOTS.find(s => s.id === id);
    return known ? { ...known, name: labeled[2].trim() } : { id, name: labeled[2].trim() };
  }

  // Reine Index-Zahl (< SPOTS.length) → in SPOTS picken
  const asNum = parseInt(param, 10);
  if (!isNaN(asNum) && /^\d+$/.test(param)) {
    if (asNum >= 0 && asNum < SPOTS.length && param.length <= 2) return SPOTS[asNum];
    // Größere Zahl = Windguru-Spot-ID; aus SPOTS oder ad-hoc
    const byId = SPOTS.find(s => s.id === asNum);
    if (byId) return byId;
    return { id: asNum, name: "Spot " + asNum };
  }

  const byName = SPOTS.find(s => s.name.toLowerCase() === param.toLowerCase());
  if (byName) return byName;
  return SPOTS[0];
}

// ─── GPS-Standort-Modus ─────────────────────────────────────────────────────
// Cached die letzte GPS-Position 10 Min, damit nicht jeder Refresh den GPS-Chip
// weckt (Akku + Permission-Prompts).
const LOCATION_TTL_MS = 10 * 60 * 1000;
const LOCATION_CACHE_FILE = "last_location.json";
const NEAREST_MAX_KM = 25; // näher dran → bekannten Spot nehmen, sonst Ad-hoc

function locationCachePath() {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.cacheDirectory(), "windguru_cache");
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  return fm.joinPath(dir, LOCATION_CACHE_FILE);
}

async function getCurrentLocation() {
  const fm = FileManager.local();
  const p = locationCachePath();
  // Frischer Cache vorhanden?
  try {
    if (fm.fileExists(p)) {
      const j = JSON.parse(fm.readString(p));
      if (j && Date.now() - j.ts < LOCATION_TTL_MS) {
        return { latitude: j.lat, longitude: j.lon, fromCache: true };
      }
    }
  } catch (e) {}
  // GPS fragen (kann Permission-Prompt auslösen oder am Lockscreen schweigen)
  try {
    if (Location.setAccuracyToThreeKilometers) Location.setAccuracyToThreeKilometers();
    const loc = await Location.current();
    if (loc && loc.latitude != null) {
      try { fm.writeString(p, JSON.stringify({ lat: loc.latitude, lon: loc.longitude, ts: Date.now() })); } catch (e) {}
      return loc;
    }
  } catch (e) { /* permission denied / no signal / lockscreen */ }
  // Notnagel: alten Cache verwenden
  try {
    if (fm.fileExists(p)) {
      const j = JSON.parse(fm.readString(p));
      return { latitude: j.lat, longitude: j.lon, fromCache: true, stale: true };
    }
  } catch (e) {}
  return null;
}

async function reverseGeocodeName(lat, lon) {
  try {
    const r = await Location.reverseGeocode(lat, lon, "de-DE");
    if (Array.isArray(r) && r.length > 0) {
      const a = r[0] || {};
      return a.locality || a.subLocality || a.subAdministrativeArea || a.name || null;
    }
  } catch (e) {}
  return null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function spotByLocation(mode) {
  // Lockscreen-Widget: Location ist dort meist nicht verfügbar — auf SPOTS[0]
  // zurückfallen, ohne den Refresh zu verschlucken.
  if (typeof config !== "undefined" && config.widgetFamily === "accessoryCircular") {
    return SPOTS[0];
  }
  const loc = await getCurrentLocation();
  if (!loc) return SPOTS[0];
  const lat = loc.latitude, lon = loc.longitude;

  // "here"/"gps": IMMER exakte Position als Ad-hoc-Spot
  if (mode === "here") {
    const name = (await reverseGeocodeName(lat, lon)) || "Hier";
    return { id: "here", name, lat, lon };
  }

  // "nearby"/"auto": nächsten bekannten Spot suchen, sonst Ad-hoc
  let nearest = null, minKm = Infinity;
  for (const s of SPOTS) {
    if (s.lat == null || s.lon == null) continue;
    const d = haversineKm(lat, lon, s.lat, s.lon);
    if (d < minKm) { minKm = d; nearest = s; }
  }
  if (nearest && minKm <= NEAREST_MAX_KM) return nearest;
  const name = (await reverseGeocodeName(lat, lon)) || "Hier";
  return { id: "here", name, lat, lon };
}

const MODELS = [3, 45, 64]; // Windguru: GFS 13km → ICON 13km → Zephr-HD
// Windy-Modell. ACHTUNG: Free-Tier-Keys können NUR "gfs" abrufen.
// Premium-Tier kann zusätzlich "ecmwf", "iconEu", "arome" — bei bezahltem Plan
// hier auf "ecmwf" umstellen für deutlich bessere Vorhersagen im Mittelmeer.
const WINDY_MODEL = "gfs";
const WINDY_KEYCHAIN = "WINDY_API_KEY"; // Keychain-Schlüssel; per Setup-Script gefüllt
const MS_TO_KN = 1.9438;
const HOUR_START = 7;       // Tagesfenster Beginn (7–19 Uhr)
const HOUR_END   = 19;      // Tagesfenster Ende (7–19 Uhr)
const LARGE_STEP = 2;       // Large: 2h-Raster
const LOCK_HOUR_START = 9;  // Sperrbildschirm: Peak-Fenster Beginn
const LOCK_HOUR_END   = 17; // Sperrbildschirm: Peak-Fenster Ende


// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
const DIR_LABELS = ["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
function degToCompass(deg) { return DIR_LABELS[((Math.round(deg / 22.5) % 16) + 16) % 16]; }
const ARROWS = ["↓","↙","←","↖","↑","↗","→","↘"]; // wohin der Wind weht
function dirArrow(deg) { return ARROWS[((Math.round(deg / 45) % 8) + 8) % 8]; }
function dirLabel(deg) { return dirArrow(deg) + " " + degToCompass(deg); }

// Kitebar-Status: nutzt denselben Wind-Farbcode wie der Pfeil
function kiteStatus(kn) {
  if (kn < 9)  return { color: windColor(kn), label: "zu wenig" };
  if (kn < 15) return { color: windColor(kn), label: "Leichtwind" };
  if (kn < 25) return { color: windColor(kn), label: "kitebar" };
  return { color: windColor(kn), label: "zu stark" };
}

// Farbcode nach Wind (immer der Wind ist der Indikator):
//   blau  < 9 kn   – wenig
//   grün  9–15 kn  – Leichtwind
//   gelb  15–25 kn – kräftig
//   rot   > 25 kn  – stark
function windColor(kn) {
  if (kn < 9)  return new Color("#4fa3ff");
  if (kn < 15) return new Color("#00e676");
  if (kn < 25) return new Color("#ffd400");
  return new Color("#ef5350");
}

// ─── Kompass zeichnen ─────────────────────────────────────────────────────────
function drawCompass(deg, size, accentColor) {
  const dc = new DrawContext();
  dc.size = new Size(size, size);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const c      = size / 2;
  const rOuter = size * 0.46;
  const rInner = size * 0.38;
  const rRose  = size * 0.28;
  const rRoseS = size * 0.17;
  const rRoseIn= size * 0.06;
  const BLUE   = new Color("#4fa3ff");  // Ring immer blau, fix
  const RED    = new Color("#ef5350");  // Nadel immer rot

  // Hintergrundkreis
  const bgC = new Path();
  bgC.addEllipse(new Rect(c-rOuter, c-rOuter, rOuter*2, rOuter*2));
  dc.setFillColor(new Color("#111820"));
  dc.addPath(bgC); dc.fillPath();

  // Innerer Ring
  dc.setStrokeColor(new Color("#2a3a48"));
  dc.setLineWidth(size * 0.015);
  const ir = new Path();
  ir.addEllipse(new Rect(c-rInner, c-rInner, rInner*2, rInner*2));
  dc.addPath(ir); dc.strokePath();

  // Äußerer Ring — immer blau
  dc.setStrokeColor(BLUE);
  dc.setLineWidth(size * 0.022);
  const or = new Path();
  or.addEllipse(new Rect(c-rOuter, c-rOuter, rOuter*2, rOuter*2));
  dc.addPath(or); dc.strokePath();

  // Tick-Marks
  for (let i = 0; i < 32; i++) {
    const ang    = (i / 32) * 2 * Math.PI - Math.PI/2;
    const isMain = i % 8 === 0;
    const isSub  = i % 4 === 0;
    const tLen   = isMain ? size*0.055 : (isSub ? size*0.038 : size*0.022);
    const r1 = rOuter - size*0.004, r2 = r1 - tLen;
    dc.setStrokeColor(isMain ? new Color("#5a7d96") : new Color("#2e4555"));
    dc.setLineWidth(isMain ? size*0.018 : size*0.010);
    const t = new Path();
    t.move(new Point(c + r1*Math.cos(ang), c + r1*Math.sin(ang)));
    t.addLine(new Point(c + r2*Math.cos(ang), c + r2*Math.sin(ang)));
    dc.addPath(t); dc.strokePath();
  }

  // Nur N / O / S / W
  const CARD = [{l:"N",a:0},{l:"O",a:90},{l:"S",a:180},{l:"W",a:270}];
  dc.setTextAlignedCenter();
  for (const {l, a} of CARD) {
    const ang = (a - 90) * Math.PI / 180;
    const lr  = rInner - size * 0.072;
    const x   = c + lr * Math.cos(ang);
    const y   = c + lr * Math.sin(ang);
    const bs  = size * 0.14;
    dc.setTextColor(new Color("#cfd8dc"));
    dc.setFont(Font.boldSystemFont(size * 0.082));
    dc.drawTextInRect(l, new Rect(x-bs/2, y-bs/2-size*0.01, bs, bs));
  }

  // Windrose (8 Zacken)
  function rosePetal(angDeg, tipR, fillColor) {
    const ang  = (angDeg - 90) * Math.PI / 180;
    const angL = ang - Math.PI * 0.09, angR = ang + Math.PI * 0.09;
    const p = new Path();
    p.move(new Point(c + tipR*Math.cos(ang), c + tipR*Math.sin(ang)));
    p.addLine(new Point(c + rRoseIn*1.6*Math.cos(angL), c + rRoseIn*1.6*Math.sin(angL)));
    p.addLine(new Point(c + rRoseIn*Math.cos(ang+Math.PI), c + rRoseIn*Math.sin(ang+Math.PI)));
    p.addLine(new Point(c + rRoseIn*1.6*Math.cos(angR), c + rRoseIn*1.6*Math.sin(angR)));
    p.closeSubpath();
    dc.setFillColor(fillColor);
    dc.addPath(p); dc.fillPath();
  }
  for (const a of [0,90,180,270]) {
    rosePetal(a,     rRose,  new Color("#dce8ee"));
    rosePetal(a+180, rRose,  new Color("#2a3a4a"));
  }
  for (const a of [45,135,225,315]) {
    rosePetal(a,     rRoseS, new Color("#4a6070"));
    rosePetal(a+180, rRoseS, new Color("#1e2d3a"));
  }

  if (deg == null || isNaN(deg)) return dc.getImage();

  // ── Nadel: sitzt auf dem Ring und rotiert dort ──
  // Richtung wohin Wind weht
  const blowTo = (deg + 180) % 360;
  const rad    = (blowTo - 90) * Math.PI / 180;
  const fx = Math.cos(rad), fy = Math.sin(rad);
  const px = Math.cos(rad + Math.PI/2), py = Math.sin(rad + Math.PI/2);

  // Nadelmittelpunkt liegt auf dem Außenring
  const nCX = c + rOuter * fx;
  const nCY = c + rOuter * fy;
  const nLen = size * 0.10;   // halbe Nadellänge
  const nW   = size * 0.035;  // Nagelbreite

  // Rote Spitze (nach außen zeigend)
  const tipX  = nCX + nLen * fx,   tipY  = nCY + nLen * fy;
  const tailX = nCX - nLen * fx,   tailY = nCY - nLen * fy;
  const needleRed = new Path();
  needleRed.move(new Point(tipX, tipY));
  needleRed.addLine(new Point(nCX + px*nW, nCY + py*nW));
  needleRed.addLine(new Point(tailX, tailY));
  needleRed.addLine(new Point(nCX - px*nW, nCY - py*nW));
  needleRed.closeSubpath();
  dc.setFillColor(RED);
  dc.addPath(needleRed); dc.fillPath();

  // Kleiner weißer Kreis in der Nadelmitte
  const nDotR = size * 0.025;
  const nDot = new Path();
  nDot.addEllipse(new Rect(nCX-nDotR, nCY-nDotR, nDotR*2, nDotR*2));
  dc.setFillColor(new Color("#ffffff"));
  dc.addPath(nDot); dc.fillPath();

  // Zentrum-Punkt
  const dotR = size * 0.042;
  const dot = new Path();
  dot.addEllipse(new Rect(c-dotR, c-dotR, dotR*2, dotR*2));
  dc.setFillColor(new Color("#0b0e12"));
  dc.addPath(dot); dc.fillPath();
  dc.setStrokeColor(BLUE);
  dc.setLineWidth(size * 0.018);
  dc.addPath(dot); dc.strokePath();

  return dc.getImage();
}

// ─── Spot-Koordinaten auto-resolven ──────────────────────────────────────────
// Ein Spot braucht nur { id, name } — lat/lon werden beim ersten Lauf von
// Windguru geholt (mehrere Endpunkte als Fallback) und persistent gecached.
// Hardcoded lat/lon in SPOTS hat Vorrang (zero-network, instant).

const COORDS_CACHE_FILE = "spot_coords.json";

function coordsCachePath() {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.cacheDirectory(), "windguru_cache");
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  return fm.joinPath(dir, COORDS_CACHE_FILE);
}

function loadCoordsCache() {
  try {
    const fm = FileManager.local();
    const p = coordsCachePath();
    if (!fm.fileExists(p)) return {};
    return JSON.parse(fm.readString(p)) || {};
  } catch (e) { return {}; }
}

function saveCoordsCache(cache) {
  try {
    FileManager.local().writeString(coordsCachePath(), JSON.stringify(cache));
  } catch (e) { /* optional */ }
}

// Reicht in einem unbekannten JSON-Objekt nach (lat, lon) — versucht alle
// üblichen Schlüssel-Schreibweisen und prüft Plausibilität.
function extractLatLon(obj) {
  if (!obj || typeof obj !== "object") return null;
  const latKeys = ["lat", "latitude", "geo_lat", "gp_lat", "spot_lat"];
  const lonKeys = ["lon", "lng", "long", "longitude", "geo_lon", "gp_lon", "spot_lon"];
  let lat = null, lon = null;
  for (const k of latKeys) if (obj[k] != null) { lat = parseFloat(obj[k]); break; }
  for (const k of lonKeys) if (obj[k] != null) { lon = parseFloat(obj[k]); break; }
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

// Sucht in beliebigen API-Antworten nach den Coords eines bestimmten Spots.
function findLatLonInResponse(json, spotId) {
  if (!json) return null;
  const sid = String(spotId);
  // Direkt auf Top-Level
  let v = extractLatLon(json);
  if (v) return v;
  // Object, gekeyt nach spot.id
  if (json[sid]) {
    v = extractLatLon(json[sid]);
    if (v) return v;
  }
  // Container-Felder mit Array/Objekt von Spots
  for (const key of ["spots", "data", "result", "items", "list"]) {
    const inner = json[key];
    if (!inner) continue;
    if (Array.isArray(inner)) {
      const match = inner.find(s => Number(s.id_spot ?? s.id ?? s.spot_id) === Number(spotId));
      if (match) { v = extractLatLon(match); if (v) return v; }
    } else if (typeof inner === "object") {
      if (inner[sid]) { v = extractLatLon(inner[sid]); if (v) return v; }
    }
  }
  // Spot-Info-Feld direkt im Forecast-Response
  if (json.spot)    { v = extractLatLon(json.spot);    if (v) return v; }
  if (json.station) { v = extractLatLon(json.station); if (v) return v; }
  return null;
}

// Sucht Coords im HTML der Spot-Seite (JSON-LD oder Inline-Variablen).
function findLatLonInHtml(html, spotId) {
  if (!html || typeof html !== "string") return null;
  // JSON-LD: "latitude": 40.77, "longitude": 9.72
  const ld = html.match(/"latitude"\s*:\s*(-?\d+\.\d+)[^}]*?"longitude"\s*:\s*(-?\d+\.\d+)/);
  if (ld) {
    const lat = parseFloat(ld[1]), lon = parseFloat(ld[2]);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }
  // Inline Windguru-Vars: spot_lat = 40.77; spot_lon = 9.72;
  const sl = html.match(/spot_lat\s*[:=]\s*(-?\d+\.\d+)[^]*?spot_lon\s*[:=]\s*(-?\d+\.\d+)/);
  if (sl) {
    const lat = parseFloat(sl[1]), lon = parseFloat(sl[2]);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
  }
  // Generisches "lat":40.77,"lon":9.72 in der Nähe der spotId
  const idx = html.indexOf(String(spotId));
  if (idx >= 0) {
    const slice = html.substring(Math.max(0, idx - 200), idx + 1000);
    const m = slice.match(/"lat"\s*:\s*(-?\d+\.\d+)[^}]*?"lon"\s*:\s*(-?\d+\.\d+)/);
    if (m) {
      const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
  }
  return null;
}

const WG_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
  "Referer": "https://www.windguru.cz/",
  "Accept": "*/*"
};

// Probiert mehrere Windguru-Endpunkte + HTML-Scrape. Erstes Treffer-Coord wins.
async function lookupCoordsFromWindguru(spotId) {
  const jsonEndpoints = [
    "https://www.windguru.cz/int/iapi.php?q=forecast_spots&id_spots=" + spotId,
    "https://www.windguru.cz/int/iapi.php?q=spot&id_spot=" + spotId,
    "https://www.windguru.cz/int/iapi.php?q=spot_info&id_spot=" + spotId,
    // Reuse der bekannten Forecast-Antwort — manche Versionen liefern hier spot.
    "https://www.windguru.cz/int/iapi.php?q=forecast&id_spot=" + spotId + "&id_model=3"
  ];
  for (const url of jsonEndpoints) {
    try {
      const req = new Request(url);
      req.headers = WG_HEADERS;
      req.timeoutInterval = 12;
      const json = await req.loadJSON();
      const hit = findLatLonInResponse(json, spotId);
      if (hit) return { ...hit, via: "iapi" };
    } catch (e) { /* nächster Endpunkt */ }
  }
  // HTML-Fallback
  try {
    const req = new Request("https://www.windguru.cz/" + spotId);
    req.headers = WG_HEADERS;
    req.timeoutInterval = 12;
    const html = await req.loadString();
    const hit = findLatLonInHtml(html, spotId);
    if (hit) return { ...hit, via: "html" };
  } catch (e) { /* hard fail */ }
  return null;
}

// Hauptfunktion: enriched einen Spot mit lat/lon, sofern fehlend.
async function resolveCoords(spot) {
  if (spot.lat != null && spot.lon != null) return spot;
  const cache = loadCoordsCache();
  const sid = String(spot.id);
  if (cache[sid] && cache[sid].lat != null && cache[sid].lon != null) {
    return { ...spot, lat: cache[sid].lat, lon: cache[sid].lon };
  }
  const hit = await lookupCoordsFromWindguru(spot.id);
  if (hit) {
    cache[sid] = {
      lat: hit.lat, lon: hit.lon, via: hit.via,
      name: spot.name, resolvedAt: Date.now()
    };
    saveCoordsCache(cache);
    return { ...spot, lat: hit.lat, lon: hit.lon };
  }
  return spot; // unauflösbar → pickSource() fällt auf Windguru-Default zurück
}

// ─── Daten laden (Offline-Cache pro Spot + Quelle) ──────────────────────────
function cachePath(spotId, source) {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.cacheDirectory(), "windguru_cache");
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  return fm.joinPath(dir, "spot_" + spotId + "_" + source + ".json");
}

function saveCache(spotId, result) {
  try {
    const fm = FileManager.local();
    const payload = {
      savedAt: Date.now(),
      source:  result.source,
      model:   result.model,
      data:    result.data
    };
    fm.writeString(cachePath(spotId, result.source), JSON.stringify(payload));
  } catch(e) { /* Cache optional */ }
}

function loadCache(spotId, source) {
  try {
    const fm = FileManager.local();
    const p = cachePath(spotId, source);
    if (!fm.fileExists(p)) return null;
    const obj = JSON.parse(fm.readString(p));
    return {
      data: obj.data, model: obj.model, source: obj.source || source,
      fromCache: true, savedAt: obj.savedAt
    };
  } catch(e) { return null; }
}

// ── Diagnose: letzter Fehler pro Quelle, damit der Error-State im Widget
// genau sagt, woran es scheitert (key fehlt? falscher key? netzwerk? format?).
const DIAG = { windy: null, windguru: null };

// Dispatcher: wählt die richtige API und übergibt einheitliches Result-Shape
//   { data, model, source, fromCache?, savedAt? }
async function fetchForecast(spot) {
  DIAG.windy = null; DIAG.windguru = null;
  const source = pickSource(spot);
  if (source === "windy") {
    const r = await fetchForecastWindy(spot);
    if (r) return r;
    // Notfall-Fallback: Windguru, falls Windy hart scheitert
    return await fetchForecastWindguru(spot);
  }
  return await fetchForecastWindguru(spot);
}

// ── Windguru: iapi.php?q=forecast (mehrere Modelle als Fallback-Kette) ──
async function fetchForecastWindguru(spot) {
  let lastErr = null;
  for (const m of MODELS) {
    const url = "https://www.windguru.cz/int/iapi.php?q=forecast&id_spot="
      + spot.id + "&id_model=" + m + "&lang=de";
    const req = new Request(url);
    req.headers = {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      "Referer": "https://www.windguru.cz/",
      "Accept": "*/*"
    };
    req.timeoutInterval = 15;
    try {
      const json = await req.loadJSON();
      if (json && !json.return && json.fcst) {
        const result = { data: json, model: m, source: "windguru" };
        saveCache(spot.id, result);
        return result;
      }
      lastErr = "Modell " + m + ": " +
        (json && (json.return || json.error || json.errorMsg) || "leere Antwort");
    } catch(e) {
      lastErr = "Modell " + m + ": " + (e && e.message ? e.message : String(e));
    }
  }
  DIAG.windguru = lastErr || "alle Modelle fehlgeschlagen";
  return loadCache(spot.id, "windguru");
}

// ── Windy Point Forecast API ──
//   POST https://api.windy.com/api/point-forecast/v2
//   { lat, lon, model, parameters: [wind, windGust], levels: [surface], key }
//   Antwort: { ts[], wind_u-surface[], wind_v-surface[], gust-surface[], units… }
async function fetchForecastWindy(spot) {
  const apiKey = getWindyKey();
  if (!apiKey) { DIAG.windy = "Kein API-Key im Keychain"; return null; }
  if (spot.lat == null || spot.lon == null) { DIAG.windy = "Keine Koordinaten"; return null; }

  const req = new Request("https://api.windy.com/api/point-forecast/v2");
  req.method = "POST";
  req.headers = { "Content-Type": "application/json" };
  req.body = JSON.stringify({
    lat: spot.lat,
    lon: spot.lon,
    model: WINDY_MODEL,
    parameters: ["wind", "windGust"],
    levels: ["surface"],
    key: apiKey
  });
  req.timeoutInterval = 15;
  // loadString statt loadJSON: behält Response auch bei 4xx/5xx und gibt uns
  // sowohl Body als auch req.response.statusCode für eine präzise Diagnose.
  try {
    const text = await req.loadString();
    const status = (req.response && req.response.statusCode) || -1;
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* nicht-JSON body */ }
    if (status >= 200 && status < 300 && json && Array.isArray(json.ts) && json.ts.length > 0) {
      const result = { data: json, model: WINDY_MODEL, source: "windy" };
      saveCache(spot.id, result);
      return result;
    }
    const detail = (json && (json.message || json.errorMsg || json.error))
                || (text ? text.slice(0, 120) : "leere Antwort");
    DIAG.windy = "HTTP " + status + " (" + WINDY_MODEL + "): " + String(detail).slice(0, 140);
  } catch (e) {
    DIAG.windy = "Request: " + (e && e.message ? e.message : String(e)).slice(0, 140);
  }
  return loadCache(spot.id, "windy");
}

function getWindyKey() {
  try {
    if (typeof Keychain !== "undefined" && Keychain.contains(WINDY_KEYCHAIN)) {
      const k = Keychain.get(WINDY_KEYCHAIN);
      return (k && k.length > 0) ? k : null;
    }
  } catch (e) { /* keychain unavailable */ }
  return null;
}

// ── m/s + u/v-Vektor → Knoten & meteorologische Richtung (woher der Wind kommt)
function uvToKn(u, v)  { return Math.sqrt(u*u + v*v) * MS_TO_KN; }
function uvToDir(u, v) { return (180 + Math.atan2(u, v) * 180 / Math.PI + 360) % 360; }


// Forecast in handliche Zeitreihe umwandeln — Dispatcher nach Quelle
function parseSeries(result) {
  return result.source === "windy"
    ? parseSeriesWindy(result)
    : parseSeriesWindguru(result);
}

function parseSeriesWindguru(result) {
  const data = result.data, fcst = data.fcst;
  const wind  = fcst.WINDSPD || [];
  const gust  = fcst.GUST    || [];
  const dir   = fcst.WINDDIR || fcst.SMER || fcst.DIRECTION || fcst.DIR || [];
  const hours = fcst.hours   || [];
  let initDate;
  if (fcst.initstamp)      initDate = new Date(fcst.initstamp * 1000);
  else if (data.initstamp) initDate = new Date(data.initstamp * 1000);
  else                     initDate = new Date(data.initdate || Date.now());

  const series = [];
  for (let i = 0; i < hours.length; i++) {
    series.push({
      time: new Date(initDate.getTime() + hours[i] * 3600 * 1000),
      wind: wind[i] != null ? Math.round(wind[i]) : null,
      gust: gust[i] != null ? Math.round(gust[i]) : null,
      dir:  (dir[i] != null && !isNaN(dir[i])) ? dir[i] : null,
    });
  }
  return series;
}

function parseSeriesWindy(result) {
  const d = result.data;
  const ts = d.ts || [];
  const u  = d["wind_u-surface"] || [];
  const v  = d["wind_v-surface"] || [];
  const g  = d["gust-surface"]   || [];

  const series = [];
  for (let i = 0; i < ts.length; i++) {
    const ui = u[i], vi = v[i], gi = g[i];
    const haveUV = (ui != null && vi != null && !isNaN(ui) && !isNaN(vi));
    series.push({
      time: new Date(ts[i]),
      wind: haveUV ? Math.round(uvToKn(ui, vi)) : null,
      gust: (gi != null && !isNaN(gi)) ? Math.round(gi * MS_TO_KN) : null,
      dir:  haveUV ? uvToDir(ui, vi) : null,
    });
  }
  return series;
}

// Gemeinsamer Hintergrund + Titelzeile
function makeBase(widget, spot, pad) {
  const grad = new LinearGradient();
  grad.colors = [new Color("#0a1622"), new Color("#15314a")];
  grad.locations = [0, 1];
  widget.backgroundGradient = grad;
  widget.setPadding(pad, pad + 2, pad, pad + 2);
}

// Apple-Style Hintergrund: tiefes Anthrazit + dezenter Akzent-Glow oben links
function makeGlowBase(widget, accent, pad) {
  const W = 340, H = 340; // gerendert in 2× Auflösung relativ zu ~170pt
  const dc = new DrawContext();
  dc.size = new Size(W, H);
  dc.opaque = true;
  dc.respectScreenScale = false;
  // Grundfläche
  const bg = new Path();
  bg.addRect(new Rect(0, 0, W, H));
  dc.setFillColor(new Color("#0b0e12"));
  dc.addPath(bg);
  dc.fillPath();
  // weicher Glow oben links
  const cx = W * 0.16, cy = H * 0.12, steps = 7;
  for (let i = steps; i >= 1; i--) {
    const r = (W * 0.5) * (i / steps);
    const alpha = 0.06 * (1 - i / steps) + 0.012;
    const g = new Path();
    g.addEllipse(new Rect(cx - r, cy - r, r * 2, r * 2));
    dc.setFillColor(new Color(accent.hex, alpha));
    dc.addPath(g);
    dc.fillPath();
  }
  widget.backgroundImage = dc.getImage();
  widget.setPadding(pad, pad + 2, pad, pad + 2);
}

function addTitle(widget, spot, big, stale) {
  const titleStack = widget.addStack();
  titleStack.layoutHorizontally();
  titleStack.centerAlignContent();
  const ttl = titleStack.addText((!big && stale ? "⚠︎ " : "🪁 ") + spot.name);
  ttl.textColor = Color.white();
  ttl.font = Font.boldSystemFont(big ? 17 : 14);
  ttl.lineLimit = 1;
  ttl.minimumScaleFactor = 0.6;
  if (big) {
    titleStack.addSpacer();
    const now = new Date();
    const tStr = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const upd = titleStack.addText((stale ? "⚠︎ " : "⟳ ") + tStr);
    upd.textColor = stale ? new Color("#ffa726") : new Color("#5a7d96");
    upd.font = Font.systemFont(10);
  }
}

// Bestes Kitefenster: zusammenhängende Stunden mit 11–17 kn,
// minimale Böen-Spreizung (max(gust) – min(wind) als Qualitätsmaß).
// Gibt { slots, avgWind, avgGust, spread, dir } oder null zurück.
function bestKiteWindow(series) {
  const KITE_WIND_MIN  = 10;  // mind. Wind
  const KITE_GUST_MAX  = 30;  // max. Böen
  const nowMs = Date.now();

  // Kandidaten: heute, 7–19 Uhr, Wind ≥ 10kn UND Böen ≤ 30kn
  const candidates = series.filter(p => {
    if (p.wind == null) return false;
    const hh = p.time.getHours();
    if (hh < HOUR_START || hh > HOUR_END) return false;
    if (p.time.toDateString() !== new Date().toDateString()) return false;
    const gust = p.gust || p.wind;
    return p.wind >= KITE_WIND_MIN && gust <= KITE_GUST_MAX;
  });

  if (candidates.length === 0) return null;

  // Zusammenhängende Blöcke bilden (max 2h Lücke)
  const blocks = [];
  let block = [candidates[0]];
  for (let i = 1; i < candidates.length; i++) {
    const gap = (candidates[i].time - candidates[i-1].time) / 3600000;
    if (gap <= 2) {
      block.push(candidates[i]);
    } else {
      blocks.push(block);
      block = [candidates[i]];
    }
  }
  blocks.push(block);

  // Besten Block nach: geringste Spreizung, dann längster Zeitraum
  let best = null;
  for (const bl of blocks) {
    const winds = bl.map(p => p.wind);
    const gusts = bl.map(p => p.gust || p.wind);
    const spread = Math.max(...gusts) - Math.min(...winds);
    const avgWind = Math.round(winds.reduce((a,b) => a+b, 0) / winds.length);
    const avgGust = Math.round(gusts.reduce((a,b) => a+b, 0) / gusts.length);
    // mittlere Richtung (Modus der 16-stufigen Kompasskategorien)
    const dirs = bl.filter(p => p.dir != null).map(p => p.dir);
    const dir = dirs.length > 0 ? dirs[Math.floor(dirs.length / 2)] : null;
    const score = spread * 10 - bl.length; // niedrig = gut
    if (!best || score < best.score) {
      best = { slots: bl, avgWind, avgGust, spread, dir, score };
    }
  }
  return best;
}

// Tages-Peak (heute) im übergebenen Stundenfenster
function dayPeakInRange(series, hStart, hEnd) {
  const today = new Date().toDateString();
  let best = null;
  for (const p of series) {
    if (p.wind == null) continue;
    if (p.time.toDateString() !== today) continue;
    const hh = p.time.getHours();
    if (hh < hStart || hh > hEnd) continue;
    if (!best || p.wind > best.wind) best = p;
  }
  return best;
}

// ─── Sperrbildschirm: accessoryCircular ─────────────────────────────────────
// Ring + N-Marker + Punkt an Windrichtung (wohin der Wind weht) + Peak-Zahl mittig.
// iOS tönt das Bild auf dem Lockscreen meist einfarbig ein → nur Weiß + Alphas.
function drawLockCircle(dir, peakKn, size) {
  const dc = new DrawContext();
  dc.size = new Size(size, size);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const c       = size / 2;
  const rRing   = size * 0.46;
  const ringW   = size * 0.022;
  const tickLen = size * 0.06;
  const dotR    = size * 0.085;

  // Hauptring
  dc.setStrokeColor(new Color("#ffffff", 0.55));
  dc.setLineWidth(ringW);
  const ring = new Path();
  ring.addEllipse(new Rect(c - rRing, c - rRing, rRing * 2, rRing * 2));
  dc.addPath(ring);
  dc.strokePath();

  // N-Marker oben
  dc.setStrokeColor(new Color("#ffffff", 0.9));
  dc.setLineWidth(size * 0.035);
  const tick = new Path();
  tick.move(new Point(c, c - rRing - tickLen * 0.5));
  tick.addLine(new Point(c, c - rRing + tickLen * 0.5));
  dc.addPath(tick);
  dc.strokePath();

  // Windrichtungs-Punkt auf dem Ring (wohin der Wind weht — wie die rote Nadel)
  if (dir != null && !isNaN(dir)) {
    const blowTo = (dir + 180) % 360;
    const rad    = (blowTo - 90) * Math.PI / 180;
    const dx = c + rRing * Math.cos(rad);
    const dy = c + rRing * Math.sin(rad);

    // weißer Punkt mit dunklem Stoßrand (für Kontrast in Vollfarb-Modus)
    const dot = new Path();
    dot.addEllipse(new Rect(dx - dotR, dy - dotR, dotR * 2, dotR * 2));
    dc.setFillColor(Color.white());
    dc.addPath(dot);
    dc.fillPath();
  }

  // Peak-Wind in der Mitte
  dc.setTextAlignedCenter();
  if (peakKn != null) {
    dc.setTextColor(Color.white());
    dc.setFont(Font.boldSystemFont(size * 0.36));
    const txtH = size * 0.42;
    dc.drawTextInRect(String(peakKn), new Rect(0, c - txtH * 0.58, size, txtH));

    dc.setTextColor(new Color("#ffffff", 0.7));
    dc.setFont(Font.semiboldSystemFont(size * 0.13));
    dc.drawTextInRect("kn", new Rect(0, c + size * 0.10, size, size * 0.16));
  } else {
    dc.setTextColor(new Color("#ffffff", 0.6));
    dc.setFont(Font.boldSystemFont(size * 0.28));
    dc.drawTextInRect("—", new Rect(0, c - size * 0.18, size, size * 0.36));
  }

  return dc.getImage();
}

function renderAccessoryCircular(widget, series) {
  widget.setPadding(0, 0, 0, 0);
  widget.backgroundColor = new Color("#000000", 0);

  const peak = dayPeakInRange(series, LOCK_HOUR_START, LOCK_HOUR_END);
  const dir  = peak ? peak.dir : null;
  const kn   = peak ? peak.wind : null;

  const img = drawLockCircle(dir, kn, 234);
  const imgView = widget.addImage(img);
  imgView.applyFittingContentMode();
}


function renderSmall(widget, spot, series, stale) {
  const nowMs = Date.now();
  const cur = series.find(p => p.time.getTime() >= nowMs - 1800 * 1000 && p.wind != null);
  const accent = cur ? windColor(cur.wind) : new Color("#4fa3ff");

  makeGlowBase(widget, accent, 12);

  // ── Kopf: Spot + Zeit links | Kompass rechts (~35px) ──────────── ~35px
  const head = widget.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const headLeft = head.addStack();
  headLeft.layoutVertically();
  headLeft.spacing = 0;
  const ttl = headLeft.addText("🪁 " + spot.name);
  ttl.textColor = Color.white();
  ttl.font = Font.boldSystemFont(13);
  ttl.lineLimit = 1;
  ttl.minimumScaleFactor = 0.7;
  const upd = headLeft.addText(new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + (stale ? " ⚠︎" : ""));
  upd.textColor = stale ? new Color("#ffa726") : new Color("#5a7d96");
  upd.font = Font.systemFont(9);
  head.addSpacer();
  if (cur) {
    const cImg = head.addImage(drawCompass(cur.dir, 220, accent));
    cImg.imageSize = new Size(35, 35);
  }

  if (!cur) {
    widget.addSpacer(6);
    const e = widget.addText("Keine Daten");
    e.textColor = new Color("#6b7785");
    e.font = Font.systemFont(12);
    return;
  }

  widget.addSpacer(4);

  // ── Main: Wind + Böen nebeneinander, Labels darunter ─────────── ~52px
  const WIND_SIZE = 38;
  const GUST_SIZE = Math.round(WIND_SIZE / 1.5); // 25pt
  const main = widget.addStack();
  main.layoutHorizontally();
  main.bottomAlignContent();

  const wCol = main.addStack();
  wCol.layoutVertically();
  wCol.spacing = 0;
  const wNum = wCol.addStack();
  wNum.layoutHorizontally();
  wNum.bottomAlignContent();
  const wTxt = wNum.addText(String(cur.wind));
  wTxt.textColor = windColor(cur.wind);
  wTxt.font = Font.boldSystemFont(WIND_SIZE);
  const wu = wNum.addText(" kn");
  wu.textColor = new Color("#9fb3c0");
  wu.font = Font.systemFont(11);
  const wLbl = wCol.addText("WIND");
  wLbl.textColor = new Color("#5a7d96");
  wLbl.font = Font.semiboldSystemFont(8);

  main.addSpacer(12);

  const gCol = main.addStack();
  gCol.layoutVertically();
  gCol.spacing = 0;
  const gNum = gCol.addStack();
  gNum.layoutHorizontally();
  gNum.spacing = 2;
  gNum.bottomAlignContent();
  const gTxt = gNum.addText(String(cur.gust));
  gTxt.textColor = windColor(cur.gust);
  gTxt.font = Font.boldSystemFont(GUST_SIZE);
  const gu = gNum.addText("kn");
  gu.textColor = new Color("#7e8893");
  gu.font = Font.systemFont(10);
  const gLbl = gCol.addText("BÖEN");
  gLbl.textColor = new Color("#5a7d96");
  gLbl.font = Font.semiboldSystemFont(8);

  main.addSpacer();
  widget.addSpacer(5);

  // ── Footer: Kitefenster-Zusammenfassung (1 Zeile) + max 2 Slots ─ ~52px
  const window = bestKiteWindow(series);
  const foot = widget.addStack();
  foot.layoutVertically();
  foot.spacing = 3;

  if (!window) {
    // Fallback: nur 2 nächste Stunden
    const next2 = [];
    for (const p of series) {
      if (next2.length >= 2) break;
      if (p.time.getTime() <= nowMs + 1800 * 1000) continue;
      if (p.wind == null) continue;
      const hh = p.time.getHours();
      if (hh < HOUR_START || hh > HOUR_END) continue;
      next2.push(p);
    }
    const noWind = foot.addText("Kein Kitefenster heute");
    noWind.textColor = new Color("#5a7d96");
    noWind.font = Font.systemFont(10);
    for (const p of next2) footRow(foot, p);
  } else {
    // Kitefenster: 1 kompakte Zusammenfassungszeile
    const sumRow = foot.addStack();
    sumRow.layoutHorizontally();
    sumRow.centerAlignContent();
    const from = window.slots[0].time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const to   = window.slots[window.slots.length-1].time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const sumT = sumRow.addText(from + "–" + to + "  Ø " + window.avgWind + " kn  ±" + window.spread);
    sumT.textColor = windColor(window.avgWind);
    sumT.font = Font.semiboldSystemFont(10);
    sumRow.addSpacer();
    if (window.dir != null) {
      const dirT = sumRow.addText(degToCompass(window.dir));
      dirT.textColor = new Color("#aebfca");
      dirT.font = Font.systemFont(10);
    }
    // Max 2 Einzelstunden
    for (const p of window.slots.slice(0, 2)) footRow(foot, p);
  }
}

// Zelle mit fester Breite, Inhalt linksbündig
function fixedCell(rowStack, width, build) {
  const cell = rowStack.addStack();
  cell.size = new Size(width, 16);
  cell.centerAlignContent();
  build(cell);
  cell.addSpacer();
}

// Kompakte Footer-Zeile: ● | Zeit | Wind | Richtung
function footRow(stack, p) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  fixedCell(row, 10, (cell) => {
    const d = cell.addText("●");
    d.textColor = kiteStatus(p.wind).color;
    d.font = Font.systemFont(7);
  });
  fixedCell(row, 44, (cell) => {
    const t = cell.addText(p.time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
    t.textColor = new Color("#8499a8");
    t.font = Font.systemFont(10);
  });
  fixedCell(row, 38, (cell) => {
    const v = cell.addText(p.wind + " kn");
    v.textColor = windColor(p.wind);
    v.font = Font.semiboldSystemFont(10);
  });
  row.addSpacer();
  if (p.dir != null) {
    const ds = row.addStack();
    ds.size = new Size(48, 13);
    const dir = ds.addText(dirLabel(p.dir));
    dir.textColor = new Color("#aebfca");
    dir.font = Font.systemFont(10);
    dir.lineLimit = 1;
    dir.minimumScaleFactor = 0.8;
  }
}

// ─── MEDIUM: nächste 4h, stündlich ───────────────────────────────────────────
function renderMedium(widget, spot, series, src, modelName, stale) {
  makeBase(widget, spot, 10);
  addTitle(widget, spot, true, stale);
  widget.addSpacer(6);

  const nowMs = Date.now();
  // stündlich ab jetzt, die nächsten 4 Stunden
  const future = series.filter(p => p.time.getTime() >= nowMs - 1800 * 1000);
  const picks = [];
  let lastHour = -99;
  for (const p of future) {
    const ah = Math.floor(p.time.getTime() / 3600000);
    if (lastHour > -99 && (ah - lastHour) < 1) continue;
    picks.push(p); lastHour = ah;
    if (picks.length >= 4) break;
  }

  // Spalten-Header
  const COL = { time: 70, wind: 60, gust: 60, dir: 80 };
  const ch = widget.addStack(); ch.layoutHorizontally();
  const hC = new Color("#5a7d96"), hF = Font.semiboldSystemFont(9);
  cell(ch, "ZEIT", COL.time, hC, hF);
  cell(ch, "WIND", COL.wind, hC, hF);
  cell(ch, "BÖE",  COL.gust, hC, hF);
  cell(ch, "RICHTUNG", COL.dir, hC, hF);
  widget.addSpacer(5);

  for (const p of picks) {
    const row = widget.addStack(); row.layoutHorizontally(); row.centerAlignContent();
    cell(row, p.time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), COL.time, new Color("#aebfca"), Font.systemFont(13));
    cell(row, p.wind + "kn", COL.wind, windColor(p.wind), Font.boldSystemFont(13));
    cell(row, p.gust + "kn", COL.gust, windColor(p.gust), Font.systemFont(13));
    cell(row, p.dir != null ? dirLabel(p.dir) : "–", COL.dir, new Color("#cfd8dc"), Font.systemFont(13));
    widget.addSpacer(5);
  }

  widget.addSpacer(2);
  foot(widget, src, modelName);
}

// ─── LARGE: Tagesübersicht 7–18 Uhr, 2h-Raster ──────────────────────────────
function renderLarge(widget, spot, series, src, modelName, stale) {
  makeBase(widget, spot, 12);
  addTitle(widget, spot, true, stale);
  widget.addSpacer(4);
  const accent = widget.addStack();
  accent.backgroundColor = new Color("#1f5a7a");
  accent.size = new Size(44, 3);
  accent.cornerRadius = 2;
  widget.addSpacer(7);

  const COL = { time: 64, wind: 52, gust: 52, dir: 78 };
  const ch = widget.addStack(); ch.layoutHorizontally();
  const hC = new Color("#5a7d96"), hF = Font.semiboldSystemFont(9);
  cell(ch, "ZEIT", COL.time, hC, hF);
  cell(ch, "WIND", COL.wind, hC, hF);
  cell(ch, "BÖE",  COL.gust, hC, hF);
  cell(ch, "RICHTUNG", COL.dir, hC, hF);
  widget.addSpacer(5);

  const nowMs = Date.now();
  let shown = 0, lastDay = null, lastHour = -99;
  for (const p of series) {
    if (shown >= 7) break;
    if (p.time.getTime() < nowMs - 3600 * 1000) continue;
    const hh = p.time.getHours();
    if (hh < HOUR_START || hh > HOUR_END) continue;
    const ah = Math.floor(p.time.getTime() / 3600000);
    if (lastHour > -99 && (ah - lastHour) < LARGE_STEP) continue;
    lastHour = ah;

    const dayKey = p.time.toLocaleDateString("de-DE", { weekday: "short" });
    if (dayKey !== lastDay) {
      if (lastDay !== null) widget.addSpacer(5);
      const dl = widget.addText(p.time.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit" }));
      dl.textColor = new Color("#3d6378");
      dl.font = Font.boldSystemFont(9);
      widget.addSpacer(3);
      lastDay = dayKey;
    }

    const row = widget.addStack(); row.layoutHorizontally(); row.centerAlignContent();
    cell(row, p.time.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), COL.time, new Color("#aebfca"), Font.systemFont(12));
    cell(row, p.wind + "kn", COL.wind, windColor(p.wind), Font.boldSystemFont(12));
    cell(row, p.gust + "kn", COL.gust, windColor(p.gust), Font.systemFont(12));
    cell(row, p.dir != null ? dirLabel(p.dir) : "–", COL.dir, new Color("#cfd8dc"), Font.systemFont(12));
    widget.addSpacer(4);
    shown++;
  }

  widget.addSpacer(3);
  foot(widget, src, modelName);
}

// Hilfs-Zelle mit fester Breite (linksbündig)
function cell(rowStack, text, width, color, font) {
  const c = rowStack.addStack();
  c.size = new Size(width, 18);
  c.centerAlignContent();
  const t = c.addText(text);
  t.textColor = color; t.font = font; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  c.addSpacer();
}

function foot(widget, sourceLabel, modelName) {
  const f = widget.addText(sourceLabel + " · " + modelName + " · v" + WIDGET_VERSION);
  f.textColor = new Color("#2e4858");
  f.font = Font.systemFont(8);
  f.centerAlignText();
}

// Anzeige-Bezeichnung pro Quelle für den Footer + Tap-Ziel
function sourceLabel(result) {
  return result.source === "windy" ? "windy.com" : "windguru.cz";
}
function modelLabel(result) {
  if (result.source === "windy") return WINDY_MODEL.toUpperCase();
  if (result.data && result.data.wgmodel) return result.data.wgmodel.model_name;
  return "Modell " + result.model;
}
function tapUrl(spot, result) {
  if (result.source === "windy") {
    return "https://www.windy.com/?" + spot.lat + "," + spot.lon + ",10";
  }
  return "https://www.windguru.cz/" + spot.id;
}

// ─── Hauptablauf ──────────────────────────────────────────────────────────────
async function buildWidget() {
  let spot = pickSpot();
  if (spot && spot.__auto) spot = await spotByLocation(spot.mode);
  spot = await resolveCoords(spot);
  const result = await fetchForecast(spot);
  const widget = new ListWidget();

  if (!result) {
    makeBase(widget, spot, 10);
    addTitle(widget, spot, true);
    widget.addSpacer(6);
    const e = widget.addText("⚠️ Keine Daten");
    e.textColor = new Color("#ff8a65");
    e.font = Font.boldSystemFont(13);
    widget.addSpacer(3);
    const src = widget.addText("Quelle: " + pickSource(spot));
    src.textColor = new Color("#cfd8dc");
    src.font = Font.systemFont(9);
    // Diagnose-Zeilen — wichtig zum Debuggen warum nichts da ist
    if (DIAG.windy) {
      const t = widget.addText("Windy: " + DIAG.windy);
      t.textColor = new Color("#ffa726");
      t.font = Font.systemFont(8);
      t.lineLimit = 3; t.minimumScaleFactor = 0.7;
    }
    if (DIAG.windguru) {
      const t = widget.addText("Windguru: " + DIAG.windguru);
      t.textColor = new Color("#ffa726");
      t.font = Font.systemFont(8);
      t.lineLimit = 3; t.minimumScaleFactor = 0.7;
    }
    widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
    return widget;
  }

  const series = parseSeries(result);
  const src    = sourceLabel(result);
  const model  = modelLabel(result);
  const family = config.widgetFamily; // "small" | "medium" | "large" | "accessoryCircular" | undefined
  const stale  = !!result.fromCache;

  if (family === "accessoryCircular") {
    renderAccessoryCircular(widget, series);
  } else if (family === "small") {
    renderSmall(widget, spot, series, stale);
  } else if (family === "large") {
    renderLarge(widget, spot, series, src, model, stale);
  } else {
    // medium (und Fallback bei manuellem Start)
    renderMedium(widget, spot, series, src, model, stale);
  }

  widget.url = tapUrl(spot, result);
  widget.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);
  return widget;
}

// ─── Start ────────────────────────────────────────────────────────────────────
const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // Maschinenlesbare Metadaten ausgeben (für automatische Auswertung)
  console.log("WIDGET_META=" + WIDGET_META);
  // Preview: Small als Standard — für andere Größen fam manuell setzen
  const fam = config.widgetFamily;
  if (fam === "medium") widget.presentMedium();
  else if (fam === "large") widget.presentLarge();
  else if (fam === "accessoryCircular") widget.presentAccessoryCircular();
  else widget.presentSmall();
}
Script.complete();
