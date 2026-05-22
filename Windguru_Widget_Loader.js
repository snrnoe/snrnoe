// ═══════════════════════════════════════════════════════════════════════════
// WINDGURU WIDGET — Remote Loader (Bootstrap)
// ──────────────────────────────────────────────────────────────────────────────
// Einmal in Scriptable einfügen → das Widget zieht seinen Code automatisch
// bei jedem Refresh vom GitHub-Repo. Updates am Code = einfach git push, fertig.
//
// Bei Netzfehler greift der lokale Cache, sodass das Widget offline weiterläuft.
//
// Widget-Parameter (Spotname/Index/ID) werden 1:1 an das geladene Widget
// durchgereicht — Scriptable übergibt `args.widgetParameter` automatisch.
//
// Wenn der Code-Branch wechselt (z.B. nach Merge auf main),
// nur die Konstante SOURCE_URL anpassen.
// ═══════════════════════════════════════════════════════════════════════════

const SOURCE_URL =
  "https://raw.githubusercontent.com/snrnoe/snrnoe/claude/iphone-widget-dev-NWu1l/Windguru_Widget.js";
const CACHE_FILE    = "windguru_remote_widget.js";
const FETCH_TIMEOUT = 15; // Sekunden

async function loadCode() {
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.cacheDirectory(), CACHE_FILE);
  let code = null;

  // 1) Online versuchen (Cache-Bust gegen GitHub-CDN)
  try {
    const req = new Request(SOURCE_URL + "?_=" + Date.now());
    req.timeoutInterval = FETCH_TIMEOUT;
    req.headers = { "Cache-Control": "no-cache" };
    const fresh = await req.loadString();
    if (fresh && fresh.length > 500) {
      fm.writeString(cachePath, fresh);
      code = fresh;
    }
  } catch (e) { /* offline → Fallback */ }

  // 2) Fallback: lokaler Cache (letzter erfolgreicher Download)
  if (!code && fm.fileExists(cachePath)) {
    code = fm.readString(cachePath);
  }
  return code;
}

function errorWidget(msg) {
  const w = new ListWidget();
  const bg = new LinearGradient();
  bg.colors = [new Color("#0a1622"), new Color("#15314a")];
  bg.locations = [0, 1];
  w.backgroundGradient = bg;
  w.setPadding(12, 14, 12, 14);
  const t = w.addText("⚠️ Loader");
  t.textColor = Color.white();
  t.font = Font.boldSystemFont(13);
  const e = w.addText(msg);
  e.textColor = new Color("#ff8a65");
  e.font = Font.systemFont(10);
  w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
  return w;
}

const code = await loadCode();
if (!code) {
  const w = errorWidget("Widget-Code nicht ladbar");
  if (config.runsInWidget) Script.setWidget(w);
  else w.presentSmall();
  Script.complete();
} else {
  // Geladenen Code im selben Scriptable-Kontext ausführen — so erbt er
  // Zugriff auf args, config, ListWidget, DrawContext, FileManager, Request, …
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(code)();
}
