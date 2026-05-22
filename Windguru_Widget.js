// ═══════════════════════════════════════════════════════════════════════════
// WINDGURU WIDGET für Scriptable — Sardinien
// Spots: La Cinta, Porto Pino, La Caletta, Chia, Porto Pollo
// Größenabhängiges Layout:
//   • Small             → Standort + aktueller Wert + Kompass + 3h-Forecast
//   • Medium            → nächste 4h, stündlich
//   • Large             → Tagesübersicht 7–19 Uhr, 2h-Raster
//   • accessoryCircular → Sperrbildschirm: Kompass-Ring mit Richtungs-Punkt,
//                         Tages-Peak (09–17 Uhr) als Zahl in der Mitte
// Datenquelle: iapi.php?q=forecast (GFS → ICON → Zephr-HD Fallback)
// ═══════════════════════════════════════════════════════════════════════════

// ─── VERSIONIERUNG ──────────────────────────────────────────────────────────
// Semantic Versioning: MAJOR.MINOR.PATCH
const WIDGET_VERSION = "2.6.0";
const WIDGET_BUILD   = "2026-05-22";

// Maschinenlesbare Metadaten (für automatische Auswertung der Frontend-Lösung).
// Kann von Tools per JSON.parse(WIDGET_META) ausgewertet werden.
const WIDGET_META = JSON.stringify({
  name: "Windguru Kite Widget",
  version: WIDGET_VERSION,
  build: WIDGET_BUILD,
  platform: "scriptable",
  sizes: ["small", "medium", "large", "accessoryCircular"],
  dataSource: "windguru.cz/int/iapi.php",
  models: [3, 45, 64],
  features: [
    "size-adaptive-layout",
    "wind-color-coding",
    "kitebar-indicator",
    "compass-vane",
    "offline-cache",
    "tap-to-open",
    "stale-indicator",
    "lockscreen-circular"
  ],
  windColorScale: { blue: "<9kn", green: "9-15kn", yellow: "15-25kn", red: ">25kn" },
  dayWindow: { start: 7, end: 19 },
  lockWindow: { start: 9, end: 17 }
});

// Changelog (Kurzform):
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
// Neue Spots ergänzen: { id: <Spot-ID>, name: "<Anzeigename>" }
// Spot-ID steht in der windguru.cz-URL, z.B. windguru.cz/49159
const SPOTS = [
  { id: 49159,   name: "La Cinta" },
  { id: 208230,  name: "Porto Pino" },
  { id: 501232,  name: "La Caletta" },
  { id: 1522,    name: "Chia" },
  { id: 278,     name: "Porto Pollo" },
];

// Spot-Auswahl per Widget-Parameter (Index 0..4, Name oder ID). Standard = erster.
function pickSpot() {
  const param = (typeof args !== "undefined" && args.widgetParameter)
    ? String(args.widgetParameter).trim() : null;
  if (param) {
    const asNum = parseInt(param, 10);
    if (!isNaN(asNum) && asNum >= 0 && asNum < SPOTS.length) return SPOTS[asNum];
    const byName = SPOTS.find(s => s.name.toLowerCase() === param.toLowerCase());
    if (byName) return byName;
    const byId = SPOTS.find(s => String(s.id) === param);
    if (byId) return byId;
  }
  return SPOTS[0];
}

const MODELS = [3, 45, 64]; // GFS 13km → ICON 13km → Zephr-HD
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

// ─── Daten laden (mit Offline-Cache) ─────────────────────────────────────────
function cachePath(spotId) {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.cacheDirectory(), "windguru_cache");
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  return fm.joinPath(dir, "spot_" + spotId + ".json");
}

function saveCache(spotId, result) {
  try {
    const fm = FileManager.local();
    const payload = { savedAt: Date.now(), model: result.model, data: result.data };
    fm.writeString(cachePath(spotId), JSON.stringify(payload));
  } catch(e) { /* Cache optional */ }
}

function loadCache(spotId) {
  try {
    const fm = FileManager.local();
    const p = cachePath(spotId);
    if (!fm.fileExists(p)) return null;
    const obj = JSON.parse(fm.readString(p));
    return { data: obj.data, model: obj.model, fromCache: true, savedAt: obj.savedAt };
  } catch(e) { return null; }
}

async function fetchForecast(spotId) {
  for (const m of MODELS) {
    const url = "https://www.windguru.cz/int/iapi.php?q=forecast&id_spot="
      + spotId + "&id_model=" + m + "&lang=de";
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
        const result = { data: json, model: m };
        saveCache(spotId, result);
        return result;
      }
    } catch(e) { /* nächstes Modell */ }
  }
  // Online fehlgeschlagen → Cache versuchen
  return loadCache(spotId);
}


// Forecast in handliche Zeitreihe umwandeln
function parseSeries(result) {
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
  const ringW   = size * 0.045;
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
function renderMedium(widget, spot, series, modelName, stale) {
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
  foot(widget, modelName);
}

// ─── LARGE: Tagesübersicht 7–18 Uhr, 2h-Raster ──────────────────────────────
function renderLarge(widget, spot, series, modelName, stale) {
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
  foot(widget, modelName);
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

function foot(widget, modelName) {
  const f = widget.addText("windguru.cz · " + modelName + " · v" + WIDGET_VERSION);
  f.textColor = new Color("#2e4858");
  f.font = Font.systemFont(8);
  f.centerAlignText();
}

// ─── Hauptablauf ──────────────────────────────────────────────────────────────
async function buildWidget() {
  const spot = pickSpot();
  const result = await fetchForecast(spot.id);
  const widget = new ListWidget();

  if (!result) {
    makeBase(widget, spot, 12);
    addTitle(widget, spot, true);
    widget.addSpacer(8);
    const e = widget.addText("⚠️ Keine Daten verfügbar");
    e.textColor = new Color("#ff8a65");
    e.font = Font.boldSystemFont(12);
    widget.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
    return widget;
  }

  const series = parseSeries(result);
  const modelName = result.data.wgmodel ? result.data.wgmodel.model_name : ("Modell " + result.model);
  const family = config.widgetFamily; // "small" | "medium" | "large" | "accessoryCircular" | undefined
  const stale = !!result.fromCache;

  if (family === "accessoryCircular") {
    renderAccessoryCircular(widget, series);
  } else if (family === "small") {
    renderSmall(widget, spot, series, stale);
  } else if (family === "large") {
    renderLarge(widget, spot, series, modelName, stale);
  } else {
    // medium (und Fallback bei manuellem Start)
    renderMedium(widget, spot, series, modelName, stale);
  }

  // Tap aufs Widget → Windguru-Seite des Spots öffnen
  widget.url = "https://www.windguru.cz/" + spot.id;

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
