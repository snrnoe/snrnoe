# Windguru Kite Widget — Claude Code Projektgedächtnis

## Projektübersicht

Scriptable-Widget für iPhone Homescreen. Zeigt Windguru-Forecast für Kitespots
in Sardinien. Drei Größen: Small / Medium / Large.

**Aktuelle Version:** 2.5.2
**Hauptdatei:** `Windguru_Widget.js` → kopieren nach Scriptable App auf dem iPhone

-----

## Architektur

```
Windguru_Widget.js
├── KONFIGURATION          Spots, Modelle, Tagesfenster (7–19 Uhr)
├── HILFSFUNKTIONEN        windColor, kiteStatus, windTrend, dirLabel, ...
├── drawCompass()          Windrose-Kompass via DrawContext
├── makeGlowBase()         Apple-Style Hintergrund (Glow-Effekt)
├── bestKiteWindow()       Algorithmus: bestes Kitefenster des Tages
├── renderSmall()          Small-Widget Layout
├── renderMedium()         Medium-Widget Layout
├── renderLarge()          Large-Widget Layout
└── buildWidget()          Haupt-Entry-Point
```

-----

## Technische Entscheidungen

### API

- Endpunkt: `https://www.windguru.cz/int/iapi.php?q=forecast&id_spot=<ID>&id_model=<M>`
- Modell-Fallback: GFS 13km (3) → ICON 13km (45) → Zephr-HD (64)
- Windfeld: `WINDSPD`, Böen: `GUST`, Richtung: `WINDDIR`
- Login nicht nötig; User-Agent + Referer-Header erforderlich

### Offline-Cache

- `FileManager.local()` → `cacheDirectory()/windguru_cache/spot_<ID>.json`
- Bei Netzfehler: letzter Cache wird geladen, ⚠︎ im Header angezeigt

### Windfarben (unveränderlich, nach Wind — nie Böen)

|Bereich |Farbe|Hex    |
|--------|-----|-------|
|< 9 kn  |Blau |#4fa3ff|
|9–15 kn |Grün |#00e676|
|15–25 kn|Gelb |#ffd400|
|> 25 kn |Rot  |#ef5350|

### Kitefenster-Algorithmus (`bestKiteWindow`)

- Kriterien: Wind ≥ 10 kn **UND** Böen ≤ 30 kn, heute, 7–19 Uhr
- Gruppenbildung: zusammenhängende Stunden (max. 2h Lücke)
- Scoring: niedrigste Böen-Spreizung gewinnt, Länge als Tiebreaker

### Kompass (`drawCompass`)

- Ring: immer `#4fa3ff` (Blau, fix — kein Windfarben-Wechsel)
- Nadel: immer `#ef5350` (Rot), sitzt auf dem Außenring, rotiert dort
- Windrose: 8 Zacken (N/O/S/W hell, Diagonalen grau)
- Labels: nur N / O / S / W
- Nordmarkierung: türkises Dreieck außen oben

-----

## Spots

```js
const SPOTS = [
  { id: 49159,  name: "La Cinta"    },
  { id: 208230, name: "Porto Pino"  },
  { id: 501232, name: "La Caletta"  },
  { id: 1522,   name: "Chia"        },
  { id: 278,    name: "Porto Pollo" },
];
```

Spot per Widget-Parameter wählen: Index (0–4), Name oder ID.

-----

## Widget-Größen

### Small (~170×170pt)

- Header: 🪁 Spotname + Zeit (links) | Kompass 35px (rechts)
- Main: Wind (38pt) + Böen (25pt), Labels WIND/BÖEN darunter
- Footer: bestes Kitefenster (Zusammenfassung + 2 Slots) oder Fallback 2h
- Padding: 12px, Kompass intern 220px gerendert

### Medium

- Nächste 4h stündlich, Tabelle: Zeit / Wind / Böen / Richtung

### Large

- Tagesübersicht 7–19 Uhr, 2h-Raster, Tagestrenner

-----

## Versionierung

```
2.5.2  Bugfix: orphaned code fragment nach drawCompass entfernt
2.5.1  Kompass: Nadel auf Ring, blauer Ring fix, rote Nadel, nur N/O/S/W
2.5.0  Windrose-Kompass: klassisches Marine-Design
2.4.2  Kitefenster: Wind ≥ 10kn, Böen ≤ 30kn
2.4.0  Layout-Entschlackung: alle Höhenbudgets kalibriert
2.3.0  Footer: bestes Kitefenster statt nächste 3h
2.2.0  Header: Spot+Zeit links gestapelt, Kompass rechts
2.0.0  Apple-Style Redesign, Versionierung, WIDGET_META
1.x    Stack-Layouts, Offline-Cache, Multi-Spot
```

-----

## Bekannte Einschränkungen

- Rating-Feld fehlt in GFS-Daten → zeigt "–"
- `Font.monospacedSystemFont` nicht verfügbar in Scriptable → boldSystemFont
- `widget.backgroundImage` überschreibt `backgroundGradient` → Small nutzt backgroundImage

-----

## Deployment

1. `Windguru_Widget.js` in Scriptable App kopieren (iCloud oder direkt)
2. Widget auf Homescreen: Größe wählen → Parameter = Spotname oder Index
3. Preview in Scriptable: Play-Button → öffnet Small-Vorschau

-----

## Maschinenlesbare Metadaten

Beim manuellen Start wird `WIDGET_META=<JSON>` in die Konsole geloggt.
Enthält: version, features, windColorScale, dayWindow, dataSource.
