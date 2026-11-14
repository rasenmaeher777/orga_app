/* Fenster „Über diese App“: wie die App entstanden ist, wie sie funktioniert, technische Daten und Live-Werte.
   Eigenständige Datei: Sie liest nur über window.UNIAPP.info() (siehe js/app.js) und aus window.MODULES/AREAS.
   Angezeigt werden bewusst keine Kontodaten, Kennungen oder Schlüssel.
   Texte ändern: Abschnitt „Inhalte“. Die Zahlen werden beim Öffnen gemessen und stehen nirgends fest im Text. */
(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = new Intl.NumberFormat('de-DE');
  const dec1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
  const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function bytes(n) {
    if (n == null || isNaN(n)) return '–';
    if (n < 1024) return `${num.format(n)} B`;
    if (n < 1024 * 1024) return `${dec1.format(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${dec1.format(n / 1024 / 1024)} MB`;
    return `${dec1.format(n / 1024 / 1024 / 1024)} GB`;
  }
  function ago(ts) {
    if (!ts) return 'noch nicht in dieser Sitzung';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 5) return 'gerade eben';
    if (s < 60) return `vor ${s} s`;
    if (s < 3600) return `vor ${Math.floor(s / 60)} min`;
    return `um ${timeFmt.format(new Date(ts))} Uhr`;
  }
  function duration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
    return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  }

  /* ---------- Inhalte ---------- */

  // Dateien der App. link: false = wird aufgelistet, aber nicht zum Öffnen verlinkt.
  const FILES = [
    { path: 'index.html', what: 'Seitengerüst' },
    { path: 'css/style.css', what: 'Layout und Farben' },
    { path: 'js/app.js', what: 'Zustand, Darstellung, Bedienung, Sync' },
    { path: 'js/grades.js', what: 'Notenberechnung nach § 8 StuPO' },
    { path: 'js/about.js', what: 'Dieses Fenster' },
    { path: 'js/firebase-config.js', what: 'Verbindungsdaten zu Firebase', link: false },
    { path: 'manifest.webmanifest', what: 'Angaben für die Installation als App' },
    { path: 'data/modules.js', what: 'Moduldaten aus StuPO und Moses', data: true },
  ];

  const STEPS = [
    ['Eine Beschreibung in normaler Sprache',
      'Am Anfang stand kein Pflichtenheft, sondern ein Absatz: Module als Kästchen, Semesterfarben, ToDos, nutzbar auf MacBook und iPhone. Claude hat dazu die 19 Seiten der Studien- und Prüfungsordnung gelesen und drei Rückfragen gestellt, bevor eine Zeile Code entstand.'],
    ['Daten aus zwei Quellen',
      'Die Modulliste hat Claude aus der PDF der Studienordnung ausgelesen. Danach hat es im Moses-Modulverzeichnis der TU Berlin {moses} Modulbeschreibungen geöffnet, die Angaben vereinheitlicht und die Lehrinhalte in {bullets} Stichpunkten zusammengefasst. Beim Abgleich fielen neun Module auf, die nur in Moses stehen, und neun, die dort fehlen.'],
    ['Das Grundgerüst',
      'HTML, CSS und JavaScript ohne Framework und ohne Build-Schritt. Bevor die erste Version übergeben wurde, hat Claude sie in einem automatisierten Browser in Desktop- und iPhone-Größe durchgeklickt: ToDos anlegen, Semester ändern, filtern, neu laden.'],
    ['Ausbau mit Claude Code',
      'Fristen, die Gesamtliste, Klausurtermine, das Farbschema und der Notenrechner kamen danach dazu. Für die größeren Schritte hat Claude genaue Arbeitsaufträge geschrieben, Claude Code hat sie direkt in der Entwicklungsumgebung umgesetzt. Die Notenlogik musste zwei durchgerechnete Beispiele exakt treffen, bevor sie als fertig galt.'],
    ['Veröffentlichen und Benutzen',
      'Das Repository auf GitHub, die Freischaltung von GitHub Pages und das Firebase-Projekt hat der Mensch selbst eingerichtet, Schritt für Schritt nach Anleitung. Seitdem läuft die App im Alltag, und was dort auffällt, wird im nächsten Gespräch geändert.'],
  ];

  const HUMAN = [
    'Idee, Anforderungen und jede Richtungsentscheidung',
    'Konten bei GitHub und Firebase angelegt und verbunden',
    'Anmeldung bei Moses (das Passwort hat die KI nie gesehen)',
    'Im Alltag getestet, Fehler bemerkt und zurückgemeldet',
    'Jede Änderung selbst veröffentlicht',
  ];
  const AI = [
    'Studienordnung gelesen und in eine Modulliste übersetzt',
    'Modulbeschreibungen ausgewertet und zusammengefasst',
    'Architektur, Code und Gestaltung',
    'Prüfungsregeln (§ 8) in nachprüfbare Rechenlogik gegossen',
    'Eigene Tests im Browser und Fehlersuche im Projekt',
  ];

  /* ---------- Messen ---------- */

  let fileStats = null;      // { pfad: { lines, bytes } } nach dem ersten Öffnen
  let storageEstimate = null;
  let timer = null;
  let ticks = 0;

  async function measureFiles() {
    const out = {};
    await Promise.all(FILES.map(async (f) => {
      try {
        const res = await fetch(f.path);
        if (!res.ok) return;
        const text = await res.text();
        out[f.path] = { lines: text.split('\n').length, bytes: new Blob([text]).size };
      } catch { /* Datei nicht lesbar: Zeile bleibt leer */ }
    }));
    fileStats = out;
    paintFiles();
  }

  function moduleFacts() {
    const mods = window.MODULES || [];
    const areas = window.AREAS || [];
    return {
      total: mods.length,
      moses: mods.filter((m) => m.moses && m.moses.nummer).length,
      bullets: mods.reduce((n, m) => n + ((m.moses && m.moses.lehrinhalte) || []).length, 0),
      pflicht: mods.filter((m) => m.kind === 'Pflicht').length,
      byArea: areas.filter((a) => !a.custom && a.match !== 'Pflicht').map((a) => [a.name, mods.filter((m) => m.areas.includes(a.name)).length]),
    };
  }

  function localBytes() {
    let n = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('uniapp-')) n += new Blob([k + localStorage.getItem(k)]).size;
      }
    } catch { return null; }
    return n;
  }

  function browserName() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return os ? `${br} auf ${os}` : br;
  }

  const SYNC_TEXT = { local: 'Nur auf diesem Gerät (kein Sync eingerichtet)', loading: 'Verbindet …', in: 'Verbunden mit Firestore', out: 'Abgemeldet', error: 'Nicht erreichbar' };

  function liveValues() {
    const info = window.UNIAPP ? window.UNIAPP.info() : null;
    const m = info ? info.metrics : {};
    const c = info ? info.counts : {};
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const transferred = (nav ? nav.transferSize || 0 : 0) + res.reduce((n, r) => n + (r.transferSize || 0), 0);
    const conn = navigator.connection;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const docLimit = 1048576; // Firestore: höchstens 1 MiB je Dokument
    const share = info ? info.stateBytes / docLimit : 0;
    return {
      online: navigator.onLine ? 'Online' : 'Offline',
      conn: conn && conn.effectiveType ? `${String(conn.effectiveType).toUpperCase()}${conn.downlink ? `, ca. ${dec1.format(conn.downlink)} Mbit/s` : ''}` : 'vom Browser nicht angegeben',
      sync: info ? SYNC_TEXT[info.sync] || info.sync : '–',
      lastSync: info && info.sync !== 'local' ? ago(m.lastSync) : '–',
      pushes: info ? num.format(m.pushes) : '–',
      snapshots: info ? num.format(m.snapshots) : '–',
      stateBytes: info ? `${bytes(info.stateBytes)} (${share < 0.001 ? 'unter 0,1' : dec1.format(share * 100)} % der Grenze)` : '–',
      stateBar: Math.max(share > 0 ? 1 : 0, Math.min(100, share * 100)),
      local: bytes(localBytes()),
      quota: storageEstimate && storageEstimate.quota ? `${bytes(storageEstimate.usage || 0)} belegt, ${bytes(storageEstimate.quota)} verfügbar` : 'vom Browser nicht angegeben',
      todos: info ? `${num.format(c.todos)} offen, davon ${num.format(c.todosDue)} mit Frist` : '–',
      grades: info ? num.format(c.grades) : '–',
      exams: info ? num.format(c.exams) : '–',
      planned: info ? num.format(c.planned) : '–',
      custom: info ? num.format(c.custom) : '–',
      session: info ? duration(Date.now() - m.started) : '–',
      renders: info ? `${num.format(m.renders)}-mal, zuletzt in ${dec1.format(m.lastRenderMs)} ms` : '–',
      saves: info ? num.format(m.saves) : '–',
      load: nav && nav.domContentLoadedEventEnd ? `${num.format(Math.round(nav.domContentLoadedEventEnd))} ms` : '–',
      transferred: transferred ? bytes(transferred) : 'aus dem Zwischenspeicher geladen',
      viewport: `${window.innerWidth} × ${window.innerHeight} px, Pixeldichte ${dec1.format(window.devicePixelRatio || 1)}`,
      scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'Dunkel' : 'Hell',
      installed: standalone ? 'Ja, läuft im eigenen Fenster' : 'Nein, läuft im Browser',
      browser: browserName(),
      clock: timeFmt.format(new Date()),
    };
  }

  /* ---------- Darstellen ---------- */

  const dlg = () => document.getElementById('about');
  const row = (label, key) => `<div><dt>${esc(label)}</dt><dd data-live="${key}">–</dd></div>`;
  const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

  function html() {
    const f = moduleFacts();
    const info = window.UNIAPP ? window.UNIAPP.info() : null;
    const fill = (t) => esc(t).replace('{moses}', num.format(f.moses)).replace('{bullets}', num.format(f.bullets));
    const tiles = [
      [num.format(f.total), 'Module in der App'],
      [num.format(f.moses), 'Modulbeschreibungen von der KI gelesen'],
      ['<span data-file-total="lines">…</span>', 'Zeilen Code, live gezählt'],
      ['0', 'Frameworks, kein Build-Schritt'],
    ];
    return `<div class="detail-inner">
      <div class="detail-head"><h2>Über diese App<span class="sub">Wie sie entstanden ist, wie sie funktioniert und was sie gerade tut</span></h2><button class="close" data-about="close" aria-label="Schließen">×</button></div>
      <div class="detail-body about-body">

        <p class="about-lead">Diese App wurde nicht in einer Agentur gebaut und nicht von einem Entwicklerteam. Sie ist in Gesprächen zwischen einem Studenten und <b>Claude</b> entstanden, einem KI-Modell von Anthropic.</p>
        <blockquote class="about-quote">„Ich möchte eine Web-App bauen, die mir bei der Strukturierung meiner Module/ToDo’s hilft.“<cite>Der erste Satz, 11. November 2026</cite></blockquote>

        <div class="about-tiles">${tiles.map(([n, t]) => `<div><b>${n}</b><span>${esc(t)}</span></div>`).join('')}</div>

        <h3>So ist sie entstanden</h3>
        <ol class="about-steps">${STEPS.map(([title, text], i) => `<li style="--dot:var(--s${i + 1})"><b>${esc(title)}</b><p>${fill(text)}</p></li>`).join('')}</ol>

        <h3>So funktioniert sie</h3>
        <div class="about-arch" role="img" aria-label="Aufbau: GitHub Pages liefert die Dateien an den Browser. Der Browser rechnet und zeichnet und tauscht die persönlichen Daten mit Firebase aus.">
          <div class="arch-box"><b>GitHub Pages</b><span>liefert nur Dateien aus und rechnet nichts</span></div>
          <div class="arch-link"><span>HTML, CSS, JavaScript</span><i>→</i></div>
          <div class="arch-box main"><b>Dein Browser</b><span>zeichnet, rechnet und behält eine Kopie deiner Daten</span></div>
          <div class="arch-link"><span>Anmeldung, deine Daten</span><i>⇄</i></div>
          <div class="arch-box"><b>Firebase</b><span>Google-Anmeldung und ein Dokument pro Konto</span></div>
        </div>
        <ul class="about-points">
          <li><b>Kein eigener Server.</b> Es gibt keinen Programmcode, der irgendwo im Hintergrund läuft. Alles, was die App kann, passiert in deinem Browser, auch die Notenberechnung.</li>
          <li><b>Moduldaten stecken im Code.</b> Die Angaben zu allen Modulen werden einmal mit der Seite geladen und nicht bei jedem Aufruf neu von der Uni geholt.</li>
          <li><b>Deine Daten liegen an zwei Orten.</b> Semester, ToDos, Termine und Noten stehen im Speicher deines Browsers und, wenn du angemeldet bist, in Firestore. Nach den eingerichteten Regeln darf dort jedes Konto nur sein eigenes Dokument lesen und schreiben.</li>
          <li><b>Zwei Geräte, ein Stand.</b> Ändert sich das Dokument, schickt Firestore die Änderung an alle geöffneten Geräte, meist innerhalb weniger Sekunden.</li>
        </ul>

        <h3>Wer hat was gemacht</h3>
        <div class="about-split">
          <div><h4>Mensch</h4>${list(HUMAN)}</div>
          <div><h4>KI</h4>${list(AI)}</div>
        </div>

        <h3>Was das zeigt und was nicht</h3>
        <p>Eine einzelne Person kann heute in wenigen Tagen eine synchronisierte App für zwei Geräte bauen, mit eigenen Daten, Tests und einer Rechenlogik nach Prüfungsordnung. Die Arbeit verschiebt sich dabei vom Schreiben des Codes zum genauen Beschreiben, Entscheiden und Prüfen.</p>
        <p class="about-gap">Fehlerfrei lief es nicht: Einmal blieb die veröffentlichte Seite leer, weil eine neue Datei nie hochgeladen wurde. Zwei Regeln im Notenrechner sind Annahmen, weil die Ordnung sie offen lässt. Und verbindlich bleibt, was Moses und das Prüfungsamt sagen. Die KI hat die Arbeit beschleunigt, das Urteil hat sie nicht ersetzt.</p>

        <details class="about-more">
          <summary>Technische Daten</summary>
          <dl class="facts">
            ${fact('Architektur', 'Statische Web-App, läuft vollständig im Browser')}
            ${fact('Sprachen', 'HTML, CSS, JavaScript')}
            ${fact('Frameworks und Build', 'Keine. Die Dateien werden so ausgeliefert, wie sie geschrieben sind.')}
            ${fact('Hosting', 'GitHub Pages, veröffentlicht direkt aus dem Git-Repository')}
            ${fact('Anmeldung', 'Firebase Authentication mit Google-Konto')}
            ${fact('Datenbank', 'Cloud Firestore, ein Dokument je Konto')}
            ${fact('Firebase-SDK', info ? `Version ${esc(info.firebaseSdk)}, wird erst bei Bedarf nachgeladen` : '–')}
            ${fact('Datenmodell', 'Fünf Felder: Semester, ToDos, eigene Module, Klausurtermine, Noten')}
            ${fact('Zugriffsschutz', 'Firestore-Regel: Lesen und Schreiben nur für das eigene Konto')}
            ${fact('Ohne Netz', 'Für die Anmeldung ist eine Verbindung nötig; eine Kopie der Daten liegt zusätzlich im Browser')}
            ${fact('Installierbar', 'Als Web-App auf Home-Bildschirm oder Dock, mit eigenem Symbol')}
            ${fact('Datenquellen', 'Studien- und Prüfungsordnung vom 13.10.2025; Moses-Modulliste WiSe 2026/27')}
          </dl>

          <h4>Dateien <span class="note">beim Öffnen dieses Fensters gemessen</span></h4>
          <table class="about-files">
            <thead><tr><th>Datei</th><th class="hide-s">Aufgabe</th><th>Zeilen</th><th>Größe</th></tr></thead>
            <tbody>${FILES.map((file) => `<tr data-file="${esc(file.path)}">
              <td>${file.link === false ? `<code>${esc(file.path)}</code>` : `<a href="${esc(file.path)}" target="_blank" rel="noopener"><code>${esc(file.path)}</code></a>`}<span class="row-what">${esc(file.what)}</span></td>
              <td class="hide-s">${esc(file.what)}</td><td data-col="lines">…</td><td data-col="bytes">…</td></tr>`).join('')}</tbody>
            <tfoot>
              <tr><td>Code ohne Moduldaten</td><td class="hide-s"></td><td data-file-total="lines">…</td><td data-file-total="bytes">…</td></tr>
            </tfoot>
          </table>
          <p class="note">Der Quelltext ist offen: Ein Klick auf eine Datei zeigt sie so, wie dein Browser sie ausführt.</p>

          <h4>Moduldaten</h4>
          <dl class="facts">
            ${fact('Module gesamt', num.format(f.total))}
            ${fact('Pflichtmodule', num.format(f.pflicht))}
            ${f.byArea.map(([name, n]) => fact(name, num.format(n))).join('')}
            ${fact('Mit Daten aus Moses', num.format(f.moses))}
            ${fact('Zusammengefasste Stichpunkte', num.format(f.bullets))}
          </dl>
        </details>

        <details class="about-more">
          <summary>Live: Verbindung, Speicher, Aktivität</summary>
          <p class="note about-clock">Aktualisiert sich jede Sekunde. Stand: <span data-live="clock">–</span> Uhr</p>

          <h4>Verbindung</h4>
          <dl class="facts">
            ${row('Netz', 'online')}${row('Verbindungsart', 'conn')}${row('Sync', 'sync')}${row('Letzter Abgleich', 'lastSync')}
            ${row('Änderungen gesendet', 'pushes')}${row('Stände empfangen', 'snapshots')}
          </dl>

          <h4>Speicher</h4>
          <dl class="facts">
            <div class="wide"><dt>Größe deines Datenstands (Firestore erlaubt 1 MB je Dokument)</dt><dd data-live="stateBytes">–</dd><div class="about-bar"><i data-live-bar="stateBar"></i></div></div>
            ${row('Kopie in diesem Browser', 'local')}${row('Speicher des Browsers für diese Seite', 'quota')}
          </dl>

          <h4>Deine Daten</h4>
          <dl class="facts">
            ${row('ToDos', 'todos')}${row('Eingetragene Noten', 'grades')}${row('Klausurtermine', 'exams')}
            ${row('Module mit Semester', 'planned')}${row('Eigene Module', 'custom')}
          </dl>

          <h4>Diese Sitzung</h4>
          <dl class="facts">
            ${row('Geöffnet seit', 'session')}${row('Seite neu gezeichnet', 'renders')}${row('Änderungen gespeichert', 'saves')}
            ${row('Seite geladen in', 'load')}${row('Übertragene Daten', 'transferred')}
          </dl>

          <h4>Gerät</h4>
          <dl class="facts">
            ${row('Browser', 'browser')}${row('Fenster', 'viewport')}${row('Farbschema', 'scheme')}${row('Als App installiert', 'installed')}
          </dl>
          <p class="note">Kontodaten, Kennungen und Schlüssel werden hier bewusst nicht angezeigt. Die Werte dieser Liste verlassen dein Gerät nicht.</p>
        </details>
      </div>
    </div>`;
  }

  function paintLive() {
    const d = dlg();
    if (!d || !d.open) return;
    const v = liveValues();
    d.querySelectorAll('[data-live]').forEach((el) => { const t = v[el.dataset.live]; if (el.textContent !== t) el.textContent = t; });
    d.querySelectorAll('[data-live-bar]').forEach((el) => { el.style.width = `${v[el.dataset.liveBar]}%`; });
  }

  function paintFiles() {
    const d = dlg();
    if (!d || !fileStats) return;
    let lines = 0, size = 0, complete = true;
    for (const file of FILES) {
      const s = fileStats[file.path];
      const tr = d.querySelector(`tr[data-file="${file.path}"]`);
      if (tr) {
        tr.querySelector('[data-col="lines"]').textContent = s ? num.format(s.lines) : '–';
        tr.querySelector('[data-col="bytes"]').textContent = s ? bytes(s.bytes) : '–';
      }
      if (file.data) continue;
      if (s) { lines += s.lines; size += s.bytes; } else complete = false;
    }
    d.querySelectorAll('[data-file-total="lines"]').forEach((el) => { el.textContent = lines ? (complete ? '' : 'mind. ') + num.format(lines) : '–'; });
    d.querySelectorAll('[data-file-total="bytes"]').forEach((el) => { el.textContent = size ? bytes(size) : '–'; });
  }

  function tick() {
    // Speicherabfrage ist asynchron und ändert sich selten: nur alle zehn Sekunden
    if (ticks % 10 === 0 && navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then((e) => { storageEstimate = e; }).catch(() => {});
    }
    ticks++;
    paintLive();
  }

  function open() {
    const d = dlg();
    if (!d) return;
    d.innerHTML = html();
    if (!d.open) d.showModal();
    d.querySelector('.detail-body').scrollTop = 0;
    paintFiles();
    if (!fileStats) measureFiles();
    ticks = 0;
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  }

  function close() {
    const d = dlg();
    if (d && d.open) d.close();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const d = dlg();
    if (!d) return;
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-about="close"]')) d.close(); });
    // Beim Schließen (auch per Esc) die Aktualisierung anhalten und den Inhalt entfernen
    d.addEventListener('close', () => { clearInterval(timer); timer = null; d.innerHTML = ''; });
  });

  window.ABOUT = { open, close };
})();
