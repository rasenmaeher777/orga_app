/* Uni Organisator – Module, Semester, ToDos und Noten.
   Aufbau:
   1. Zustand (Semester, ToDos, eigene Module, Noten) + Speichern
   2. Darstellung (Filter, Bereiche, Kästchen, Notenübersicht, Detailansicht)
   3. Bedienung (Klicks, Eingaben)
   4. Anmeldung und Firestore-Sync (nur aktiv, wenn js/firebase-config.js ausgefüllt ist;
      dann ist die App erst nach der Anmeldung sichtbar)
   Die Notenberechnung selbst steht als reine Funktionen in js/grades.js (window.GRADES). */
(() => {
  'use strict';

  const MODULES = window.MODULES || [];
  const AREAS = window.AREAS || [];
  const GR = window.GRADES;
  const LS_STATE = 'uniapp-state-v1';
  const LS_OPEN = 'uniapp-open-v1';
  const LS_ALL = 'uniapp-alltodos-v1';
  const LS_GRADES = 'uniapp-grades-v1'; // Notenübersicht aufgeklappt?
  const LS_WISH = 'uniapp-wish-v1';     // Wunschschnitt im Zielrechner (nur in diesem Browser)
  const LS_UID = 'uniapp-uid-v1'; // Konto, zu dem der lokal gespeicherte Stand gehört
  const MAX_SEM = 10;
  const FIREBASE_SDK = '10.12.2';

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- Datum (immer lokale Zeit, nie toISOString/UTC) ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  // gibt "YYYY-MM-DD" zurück, wenn es ein echtes Kalenderdatum ist, sonst ''
  function validDate(v) {
    if (typeof v !== 'string' || !/^2\d{3}-\d{2}-\d{2}$/.test(v)) return '';
    return ymd(fromYmd(v)) === v ? v : '';
  }
  function dayInfo() {
    const n = new Date();
    return { today: ymd(n), tomorrow: ymd(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1)), year: n.getFullYear() };
  }
  let now = dayInfo(); // wird bei jedem Zeichnen aktualisiert
  const fmtLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const fmtShortYear = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  // "Fr., 13.11." – mit Jahreszahl, wenn die Frist nicht im laufenden Jahr liegt
  const dueText = (due) => { const d = fromYmd(due); return (d.getFullYear() === now.year ? fmtShort : fmtShortYear).format(d); };
  // Fristen von heute, morgen und aus der Vergangenheit werden hervorgehoben
  const dueStatus = (due) => (!due ? '' : due < now.today ? 'überfällig' : due === now.today ? 'heute' : due === now.tomorrow ? 'morgen' : '');
  // nach Frist aufsteigend, ohne Frist ans Ende (sort() ist stabil, die Reihenfolge der Eingabe bleibt sonst erhalten)
  const byDue = (a, b) => { const x = a.due || '9', y = b.due || '9'; return x < y ? -1 : x > y ? 1 : 0; };

  /* ---------- 1. Zustand ---------- */

  // sem:    { modulId: 1..10 | 0 }   (0 = bewusst ohne Semester; fehlt der Eintrag, gilt der Studienverlaufsplan)
  // todos:  { modulId: [{ id, text, due? }] }   (due = Frist "YYYY-MM-DD"; ohne Frist fehlt das Feld)
  // custom: { modulId: { title, lp } } (selbst angelegte Module im Wahlbereich)
  // exams:  { modulId: { t1?, t2? } }  (1. und 2. Klausurtermin als "YYYY-MM-DD"; ohne Termin fehlt das Feld)
  // grades: { modulId: 10..40 | 'p' }  (Note als Zehntelnote, 23 = 2,3; 'p' = bestanden ohne Note; ohne Note fehlt der Eintrag)
  const EXAM_KEYS = ['t1', 't2'];
  // Firestore lehnt undefined ab: due wird nur gesetzt, wenn es eine gültige Frist gibt
  function todoItem(id, text, due) {
    const item = { id, text };
    if (validDate(due)) item.due = due;
    return item;
  }
  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const out = { sem: {}, todos: {}, custom: {}, exams: {}, grades: {} };
    for (const [k, v] of Object.entries(s.sem || {})) if (Number.isInteger(v) && v >= 0 && v <= MAX_SEM) out.sem[k] = v;
    for (const [k, v] of Object.entries(s.todos || {})) {
      if (!Array.isArray(v)) continue;
      const list = v.filter((t) => t && typeof t.text === 'string').map((t) => todoItem(String(t.id || uid()), t.text, t.due));
      if (list.length) out.todos[k] = list;
    }
    for (const [k, v] of Object.entries(s.custom || {})) if (v && typeof v.title === 'string') out.custom[k] = { title: v.title, lp: Number(v.lp) || 0 };
    for (const [k, v] of Object.entries(s.exams || {})) {
      const e = {};
      for (const key of EXAM_KEYS) if (v && validDate(v[key])) e[key] = v[key];
      if (Object.keys(e).length) out.exams[k] = e;
    }
    for (const [k, v] of Object.entries(s.grades || {})) if (GR.isValue(v)) out.grades[k] = v;
    return out;
  }
  function loadLocal() {
    try { return normalize(JSON.parse(localStorage.getItem(LS_STATE))); } catch { return normalize(null); }
  }
  function saveLocal() {
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch { /* Speicher nicht verfügbar */ }
  }

  let state = loadLocal();
  // Kennzahlen dieser Sitzung für das Fenster „Über diese App“ (js/about.js); sie werden nirgends gespeichert
  const metrics = { started: Date.now(), renders: 0, lastRenderMs: 0, saves: 0, pushes: 0, snapshots: 0, lastSync: 0 };
  // done: gerade abgehakte ToDos, die noch kurz durchgestrichen zu sehen sind
  const ui = { filter: 'all', q: '', open: new Set(['Pflichtbereich']), allOpen: false, done: new Set(), gradesOpen: false, howOpen: false, wish: '' };
  try { const o = JSON.parse(localStorage.getItem(LS_OPEN)); if (Array.isArray(o)) ui.open = new Set(o); } catch { /* Standard */ }
  try { ui.allOpen = localStorage.getItem(LS_ALL) === '1'; } catch { /* Standard */ }
  try { ui.gradesOpen = localStorage.getItem(LS_GRADES) === '1'; ui.wish = localStorage.getItem(LS_WISH) || ''; } catch { /* Standard */ }

  const customModules = () => Object.entries(state.custom).map(([id, c]) => ({ id, title: c.title, lp: c.lp, kind: 'Wahl', areas: ['Wahlbereich'], custom: true }));
  const allModules = () => MODULES.concat(customModules());
  const semOf = (m) => (m.id in state.sem ? state.sem[m.id] || null : m.defaultSemester || null);
  const todosOf = (id) => state.todos[id] || [];
  const examsOf = (id) => state.exams[id] || {};
  // Nur Module mit Klausur bekommen in der Detailansicht die Klausurtermine. Bei Portfolioprüfungen ist oft
  // ein schriftlicher Test dabei; eigene Module haben keine Angabe zur Prüfungsform und sind deshalb auch dabei.
  const KLAUSUR_FORMS = ['Schriftliche Prüfung', 'Portfolioprüfung'];
  const hasKlausur = (m) => !!m.custom || KLAUSUR_FORMS.includes(m.exam);
  // Noten: benotete Module haben 1,0 bis 4,0, unbenotete nur "bestanden", eigene Module beides.
  // Ein gespeicherter Wert, der zum Modul nicht passt, gilt als nicht eingetragen.
  const gradeOptions = (m) => (m.custom ? GR.VALUES.concat(GR.PASSED) : m.graded === false ? [GR.PASSED] : GR.VALUES);
  const gradeOf = (m) => (gradeOptions(m).includes(state.grades[m.id]) ? state.grades[m.id] : null);
  const gradeText = (v) => (v === GR.PASSED ? 'bestanden' : GR.fmt1(v));
  // Eingabe für die Berechnung in js/grades.js: ein Eintrag je Modul mit Note
  const gradeResult = () => GR.compute(allModules().filter((m) => gradeOf(m) !== null)
    .map((m) => ({ id: m.id, title: m.title, lp: m.lp || 0, sem: semOf(m) || 0, custom: !!m.custom, areas: m.areas, value: gradeOf(m) })));

  /* ---------- 2. Darstellung ---------- */

  function matches(m) {
    if (ui.filter === 'none' && semOf(m) !== null) return false;
    if (typeof ui.filter === 'number' && semOf(m) !== ui.filter) return false;
    if (ui.filter === 'todo' && !todosOf(m.id).length) return false;
    if (ui.q) {
      const hay = [m.title, m.exam, m.moses && m.moses.verantwortlich, m.moses && m.moses.fachgebiet].filter(Boolean).join(' ').toLowerCase();
      if (!ui.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function renderChips() {
    const mods = allModules();
    const lp = {}; let maxSem = 6; let todoCount = 0;
    for (const m of mods) {
      const s = semOf(m);
      if (s) { lp[s] = (lp[s] || 0) + (m.lp || 0); maxSem = Math.max(maxSem, s); }
      todoCount += todosOf(m.id).length;
    }
    const chip = (value, label, extra = '', style = '') =>
      `<button class="chip" data-filter="${value}" aria-pressed="${String(ui.filter) === String(value)}" ${style}>${label}${extra}</button>`;
    let html = chip('all', 'Alle');
    for (let s = 1; s <= maxSem; s++) html += chip(s, `<i></i>${s}. Sem.`, `<small>${lp[s] || 0} LP</small>`, `style="--sem:var(--s${s})"`);
    html += chip('none', 'Ohne Semester');
    html += chip('todo', 'Mit ToDos', `<small>${todoCount}</small>`);
    $('#chips').innerHTML = html;
  }

  function semSelect(m) {
    const cur = semOf(m);
    let opts = `<option value="0"${cur ? '' : ' selected'}>–</option>`;
    for (let s = 1; s <= MAX_SEM; s++) opts += `<option value="${s}"${cur === s ? ' selected' : ''}>${s}</option>`;
    return `<select class="sem" data-sem="${esc(m.id)}" aria-label="Semester für ${esc(m.title)}" title="Semester">${opts}</select>`;
  }

  const ICON_CAL = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';
  const ICON_GEAR = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.83 3.14L7.12 1.46L8.88 1.46L9.17 3.14L10.61 3.74L12.00 2.75L13.25 4.00L12.26 5.39L12.86 6.83L14.54 7.12L14.54 8.88L12.86 9.17L12.26 10.61L13.25 12.00L12.00 13.25L10.61 12.26L9.17 12.86L8.88 14.54L7.12 14.54L6.83 12.86L5.39 12.26L4.00 13.25L2.75 12.00L3.74 10.61L3.14 9.17L1.46 8.88L1.46 7.12L3.14 6.83L3.74 5.39L2.75 4.00L4.00 2.75L5.39 3.74Z"/><circle cx="8" cy="8" r="2.1"/></svg>';
  const ICON_PLUS = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';

  // Fristanzeige eines ToDos. Darüber liegt ein unsichtbares Datumsfeld (siehe .datebtn in style.css),
  // ein Klick oder Tipp öffnet also direkt die Datumsauswahl des Geräts.
  const dueClass = (due) => { const st = dueStatus(due); return `datebtn due${due ? '' : ' none'}${st ? ' urgent' : ''}${st === 'morgen' ? ' soon' : ''}`; };
  const dueInner = (due) => { const st = dueStatus(due); return (st ? `<b class="due-tag">${st}</b>` : ICON_CAL) + (due ? `<span>${esc(dueText(due))}</span>` : ''); };
  // im schmalen Formular "ToDo hinzufügen" ohne Wochentag: "13.11."
  const newDueInner = (due) => ICON_CAL + (due ? `<span>${esc(`${due.slice(8)}.${due.slice(5, 7)}.${due.startsWith(now.year + '-') ? '' : due.slice(0, 4)}`)}</span>` : '');

  function todoRow(m, t, withModule) {
    const done = ui.done.has(t.id);
    const dateBtn = `<span class="${dueClass(t.due)}" data-due-for="${esc(t.id)}" title="${t.due ? 'Frist ändern' : 'Frist festlegen'}"><span class="due-label">${dueInner(t.due)}</span><input type="date" data-due="${esc(t.id)}" value="${esc(t.due || '')}" aria-label="Frist für ${esc(t.text)} ${t.due ? 'ändern' : 'festlegen'}"></span>`;
    const meta = [];
    if (t.due) meta.push(dateBtn, `<button class="due-clear" data-act="clear-due" data-todo-id="${esc(t.id)}" aria-label="Frist für ${esc(t.text)} entfernen" title="Frist entfernen">×</button>`);
    if (withModule) meta.push(`<span class="todo-mod">${esc(m.title)}</span>`);
    return `<li class="${dueStatus(t.due) ? 'urgent' : ''}${done ? ' done' : ''}" data-mod="${esc(m.id)}">
        <label><input type="checkbox" data-todo="${esc(t.id)}"${done ? ' checked disabled' : ''}><span>${esc(t.text)}</span></label>
        ${t.due ? '' : dateBtn}
        ${meta.length ? `<div class="todo-meta">${meta.join('')}</div>` : ''}
      </li>`;
  }

  // Kopfzeile des Inhalts: heutiges Datum und aufklappbare Liste aller offenen ToDos
  function todayHtml() {
    const rows = [];
    for (const m of allModules()) for (const t of todosOf(m.id)) rows.push({ m, t });
    rows.sort((a, b) => byDue(a.t, b.t));
    const list = rows.length
      ? `<ul class="todos all-list">${rows.map((r) => todoRow(r.m, r.t, true)).join('')}</ul>`
      : '<p class="note">Keine offenen ToDos.</p>';
    return `
      <section class="today">
        <div class="today-row">
          <time class="today-date" datetime="${now.today}">${esc(fmtLong.format(new Date()))}</time>
          <div class="today-btns">
            <button class="all-toggle" data-act="toggle-all" data-focus="all-toggle" aria-expanded="${ui.allOpen}"><span class="chev"></span>Alle ToDos (${rows.length})</button>
            <button class="all-toggle" data-act="toggle-grades" data-focus="grades-toggle" aria-expanded="${ui.gradesOpen}"><span class="chev"></span>Noten</button>
            <button class="all-toggle icon-only" data-act="about" data-focus="about-btn" aria-label="Über diese App" title="Über diese App">${ICON_GEAR}</button>
          </div>
        </div>
        ${ui.allOpen ? `<div class="all-panel">${list}</div>` : ''}
        ${ui.gradesOpen ? gradesHtml() : ''}
      </section>`;
  }

  // Notenübersicht: Kennzahlen, Zielrechner, Tabelle aller Module mit Note, Erklärtext
  function gradesHtml() {
    const r = gradeResult();
    const how = `<button class="how-toggle" data-act="toggle-how" data-focus="how-toggle" aria-expanded="${ui.howOpen}"><span class="chev"></span>So wird gerechnet</button>${ui.howOpen ? howHtml(r) : ''}`;
    if (!r.rows.length) {
      return `<div class="all-panel grades"><p class="note">Noch keine Noten eingetragen. Tippe auf einen Modultitel und wähle in der Detailansicht unter „Note“ deine Note aus.</p>${how}</div>`;
    }
    const avgAll = GR.mean2(r.allSum, r.allLp);
    const avg = GR.mean2(r.countSum, r.countLp);
    const stat = (label, value, sub = '') => `<div><dt>${label}</dt><dd>${value}</dd>${sub}</div>`;
    const stats = stat('Bestandene LP', `${r.passedLp} <small>/ ${GR.TOTAL_LP}</small>`)
      + stat('Schnitt aller Noten', avgAll === null ? '–' : GR.fmt2(avgAll))
      + stat('Zeugnisschnitt nach § 8 StuPO', avg === null ? '–' : GR.fmt2(avg),
        avg === null ? '' : `<dd class="sub">voraussichtliche Zeugnisnote ${GR.fmt1(GR.cut1(r.countSum, r.countLp))}</dd>`)
      + stat('Gezählte LP', r.countLp);
    const rows = r.rows.slice().sort((a, b) => (a.sem || 99) - (b.sem || 99) || a.title.localeCompare(b.title, 'de')).map((row) => {
      const status = GR.STATUS[row.status];
      return `<tr class="${row.status}">
          <td><button class="row-title" data-act="grade-detail" data-id="${esc(row.id)}" title="Details anzeigen">${esc(row.title)}</button>
            <span class="row-sub">${row.sem ? `${row.sem}. Sem. · ` : ''}${row.lp} LP · ${status}</span></td>
          <td class="hide-s">${row.sem || '–'}</td><td class="hide-s">${row.lp}</td>
          <td class="grade-val">${gradeText(row.value)}</td><td class="hide-s">${status}</td>
        </tr>`;
    }).join('');
    return `<div class="all-panel grades">
        <dl class="facts stats">${stats}</dl>
        <h3>Zielrechner</h3>
        <div class="goal">
          <label class="goal-field">Wunschschnitt <input class="goal-input" data-focus="wish" inputmode="decimal" autocomplete="off" maxlength="4" placeholder="z. B. 2,0" value="${esc(ui.wish)}"></label>
          <p class="goal-out" role="status">${goalHtml(r)}</p>
        </div>
        <p class="note">Die Bachelorarbeit (12 LP) zählt wie zwei 6-LP-Module.</p>
        <h3>Module mit Note</h3>
        <table class="parts grade-table"><thead><tr><th>Modul</th><th class="hide-s">Semester</th><th class="hide-s">LP</th><th>Note</th><th class="hide-s">Status</th></tr></thead><tbody>${rows}</tbody></table>
        ${how}
      </div>`;
  }

  // Ergebnis des Zielrechners (nur feste Texte und Zahlen, keine Nutzereingaben)
  function goalHtml(r) {
    const wish = GR.parseWish(ui.wish);
    const t = GR.target(r, wish ?? 10);
    if (t.kind === 'done') {
      const avg = GR.mean2(r.countSum, r.countLp);
      return `Alle zählenden Leistungen sind eingetragen.${avg === null ? '' : ` Dein Zeugnisschnitt: <b>${GR.fmt2(avg)}</b>.`}`;
    }
    if (!ui.wish.trim()) return '';
    if (wish === null) return 'Bitte einen Wert von 1,0 bis 4,0 in Schritten von 0,1 eingeben.';
    if (t.kind === 'impossible') return `Mit den bisherigen Noten nicht mehr erreichbar. Bester noch erreichbarer Schnitt: <b>${GR.fmt2(t.best)}</b>.`;
    if (t.kind === 'safe') return 'Bereits sicher, sofern du alle offenen Module bestehst.';
    return `Du brauchst in den noch offenen ${t.open} LP im Schnitt <b>${GR.fmt2(t.need)}</b>.`;
  }
  // Zielrechner an Ort und Stelle aktualisieren, ohne neu zu zeichnen (das Eingabefeld behält den Fokus)
  function paintGoal() {
    const out = $('#main .goal-out');
    if (out) out.innerHTML = goalHtml(gradeResult());
  }

  function howHtml(r) {
    const t = GR.target(r, 10);
    return `<ul class="how">
        <li><b>Schnitt aller Noten:</b> alle eingetragenen Noten, gewichtet nach LP. Eigene Module aus dem Wahlbereich und „bestanden“ ohne Note zählen dabei nicht mit.</li>
        <li><b>Zeugnisschnitt (§ 8 StuPO):</b> Von den 180 LP gehen 45 LP nicht in die Note ein: 18 LP Wahlbereich, 6 LP Programmierpraktikum und 21 LP mit deinen schlechtesten Noten. Hast du weitere unbenotete Module bestanden, werden deren LP von den 21 LP abgezogen.</li>
        <li><b>Streichen:</b> Die schlechteste Note fällt zuerst weg, dann die nächstschlechtere (bei gleicher Note zuerst das Modul mit mehr LP, dann das im höheren Semester). Es fallen nur ganze Module weg. Passt das nächste Modul nicht mehr in die verbleibenden LP, ist Schluss; kleinere Module mit besserer Note werden nicht vorgezogen.</li>
        <li><b>Bachelorarbeit:</b> zählt immer und wird nie gestrichen.</li>
        <li><b>Rechnung:</b> Summe aus Note × LP der gezählten Module, geteilt durch deren LP, kaufmännisch auf zwei Nachkommastellen gerundet.</li>
        <li><b>Voraussichtliche Zeugnisnote:</b> Annahme nach üblicher Praxis: Der Schnitt wird nach der ersten Nachkommastelle abgeschnitten, nicht gerundet (2,48 wird 2,4).</li>
        <li><b>Zielrechner:</b> Annahme: Gestrichen bleiben nur die bisher schlechtesten Noten, alle künftigen Noten zählen. Das Ergebnis ist dadurch nie zu optimistisch. Die nötige Note wird abgerundet (also strenger), der beste erreichbare Schnitt aufgerundet.</li>
        ${r.rows.length ? `<li><b>Dein Stand:</b> ${r.ungradedLp} LP weitere unbenotete Module, damit ${r.budget} LP zum Streichen, davon ${r.droppedLp} LP gestrichen. Am Ende gehen 156 − ${r.ungradedLp} − ${r.droppedLp} = ${t.total} LP in die Note ein, ${Math.max(0, t.open)} LP davon sind noch offen.</li>` : ''}
      </ul>
      <p class="note">Orientierungswert. Verbindlich ist die Berechnung des Prüfungsamts.</p>`;
  }

  function cardHtml(m, secIdx) {
    const s = semOf(m);
    const todos = todosOf(m.id).slice().sort(byDue);
    const meta = [`<span class="kind">${esc(m.kind)}</span>`];
    if (m.lp) meta.push(`<span class="sep">${m.lp} LP</span>`);
    if (m.exam) meta.push(`<span class="sep">${esc(m.exam)}</span>`);
    // Note, ohne dass sich das Kästchen verändert: Eine Zahl steht als kleines Schild an der Ecke des Semesterfelds
    // (siehe .grade-badge). "bestanden" steht in der Metazeile; bei unbenoteten Modulen ersetzt es "unbenotet" und
    // belegt genau dessen Breite (unsichtbarer Platzhalter), damit die Zeile nicht anders umbricht.
    const grade = gradeOf(m);
    if (m.graded === false) meta.push(grade === null ? '<span class="sep">unbenotet</span>' : '<span class="sep grade swap"><i>unbenotet</i><span>bestanden</span></span>');
    else if (grade === GR.PASSED) meta.push('<span class="sep grade">bestanden</span>');
    return `
      <article class="card${s ? ' has-sem' : ''}" data-id="${esc(m.id)}"${s ? ` style="--sem:var(--s${s});--on-sem:var(--on-s${s})"` : ''}>
        <div class="card-head">
          <button class="card-title" data-act="detail" title="Details anzeigen">${esc(m.title)}</button>
          ${semSelect(m)}
        </div>
        <div class="meta">${meta.join('')}</div>
        ${typeof grade === 'number' ? `<span class="grade-badge" title="Note">${gradeText(grade)}</span>` : ''}
        ${todos.length ? `<ul class="todos">${todos.map((t) => todoRow(m, t, false)).join('')}</ul>` : ''}
        <form class="todo-add" data-act="add-todo">
          <input name="text" data-focus="todo:${esc(m.id)}:${secIdx}" placeholder="ToDo hinzufügen …" aria-label="ToDo für ${esc(m.title)} hinzufügen" autocomplete="off" enterkeyhint="done" maxlength="300">
          <span class="datebtn new" title="Frist (optional)"><span class="due-label">${ICON_CAL}</span><input type="date" name="due" data-focus="tododue:${esc(m.id)}:${secIdx}" aria-label="Frist für das neue ToDo (optional)"></span>
          <button type="button" class="due-clear" data-act="clear-new-due" aria-label="Frist wieder entfernen" title="Frist entfernen">×</button>
          <button class="add-btn" aria-label="ToDo hinzufügen" title="ToDo hinzufügen">${ICON_PLUS}</button>
        </form>
        ${m.custom ? '<button class="remove" data-act="remove-custom">Modul entfernen</button>' : ''}
      </article>`;
  }

  function sortModules(list) {
    return list.slice().sort((a, b) => (semOf(a) || 99) - (semOf(b) || 99) || a.title.localeCompare(b.title, 'de'));
  }

  // Solange ein Datumsfeld den Fokus hat (Datumsauswahl offen), wird nicht neu gezeichnet:
  // sonst würde die Auswahl mitten in der Bedienung geschlossen. Nachgeholt wird beim Verlassen des Feldes.
  let renderPending = false;
  const dateBusy = () => { const a = document.activeElement; return !!a && a.tagName === 'INPUT' && a.type === 'date'; };
  function refresh() {
    if (dateBusy()) { renderPending = true; return; }
    render();
  }

  // Anmeldesperre: Solange gesperrt ist, wird nichts gezeichnet. Im Dokument stehen dann weder Module noch ToDos,
  // zu sehen ist nur der einfarbige Hintergrund mit der Anmeldung (#gate). Gesteuert wird sie in Abschnitt 4.
  let locked = document.documentElement.classList.contains('locked');
  function setLocked(on) {
    if (on === locked) return;
    locked = on;
    document.documentElement.classList.toggle('locked', on);
    if (!on) { render(); return; }
    renderPending = false;
    $('#main').innerHTML = '';
    $('#chips').innerHTML = '';
    const dlg = $('#detail');
    if (dlg.open) dlg.close();
    dlg.innerHTML = '';
    if (window.ABOUT) window.ABOUT.close();
    clearTimeout(toastTimer);
    $('#toast').hidden = true;
  }

  function render() {
    if (locked) return;
    const t0 = performance.now();
    metrics.renders++;
    queueMicrotask(() => { metrics.lastRenderMs = performance.now() - t0; }); // läuft direkt nach dem Zeichnen
    renderPending = false;
    now = dayInfo();
    // Fokus und angefangene Eingaben merken, damit beim Neuzeichnen (z. B. durch Sync) nichts verloren geht
    const active = document.activeElement;
    const keep = active && active.dataset && active.dataset.focus ? { key: active.dataset.focus, pos: active.selectionStart } : null;
    const drafts = [...document.querySelectorAll('#main input[data-focus]')].filter((el) => el.value).map((el) => [el.dataset.focus, el.value]);

    renderChips();
    const filtering = ui.filter !== 'all' || !!ui.q;
    const custom = customModules();
    let html = todayHtml();
    let shown = 0;

    AREAS.forEach((area, idx) => {
      const base = area.custom ? custom : area.match === 'Pflicht' ? MODULES.filter((m) => m.kind === 'Pflicht') : MODULES.filter((m) => m.areas.includes(area.name));
      const list = sortModules(base.filter(matches));
      if (filtering && !list.length) return;
      shown += list.length;
      const open = filtering || ui.open.has(area.name);
      const planned = base.filter((m) => semOf(m));
      const plannedLp = planned.reduce((sum, m) => sum + (m.lp || 0), 0);
      const count = filtering ? `${list.length} von ${base.length}` : `${base.length} ${base.length === 1 ? 'Modul' : 'Module'}`;
      const metaParts = [count, `${area.lp} zu belegen`];
      if (area.kind !== 'Pflicht' && planned.length) metaParts.push(`${plannedLp} LP eingeplant`);
      html += `
        <section class="section${open ? ' open' : ''}">
          <button class="sec-head" data-act="toggle" data-area="${esc(area.name)}" aria-expanded="${open}">
            <span class="chev"></span>
            <span class="sec-titles"><h2>${esc(area.name)}</h2><span class="sec-meta">${esc(metaParts.join(' · '))}</span></span>
            <span class="spacer"></span>
            <span class="tag">${esc(area.kind)}</span>
          </button>
          ${open ? `
            ${area.custom && !filtering ? `<form class="add-custom" data-act="add-custom">
              <input name="title" data-focus="custom:title" placeholder="Eigenes Modul, z. B. Sprachkurs" aria-label="Titel des Moduls" maxlength="120" required>
              <input name="lp" data-focus="custom:lp" type="number" min="0" max="30" placeholder="LP" aria-label="Leistungspunkte" inputmode="numeric">
              <button class="btn primary">Hinzufügen</button>
            </form>` : ''}
            ${list.length ? `<div class="grid">${list.map((m) => cardHtml(m, idx)).join('')}</div>` : ''}` : ''}
        </section>`;
    });

    if (!shown && filtering) html += '<p class="empty">Keine Module für diese Auswahl.</p>';
    $('#main').innerHTML = html;
    paintExams(); // falls die Detailansicht offen ist und ein Termin z. B. per Sync kam
    paintGrade();

    for (const [key, value] of drafts) {
      const el = document.querySelector(`[data-focus="${CSS.escape(key)}"]`);
      if (el) { el.value = value; if (el.type === 'date') paintNewDue(el); }
    }
    if (keep) {
      const el = document.querySelector(`[data-focus="${CSS.escape(keep.key)}"]`);
      if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.pos, keep.pos); } catch { /* Felder ohne Textcursor */ } }
    }
  }

  // Anzeige neben dem Datumsfeld im Formular "ToDo hinzufügen" aktualisieren
  function paintNewDue(input) {
    const due = validDate(input.value);
    const box = input.parentElement;
    box.classList.toggle('has', !!due);
    $('.due-label', box).innerHTML = newDueInner(due);
  }
  // Fristanzeige eines ToDos an Ort und Stelle aktualisieren (in allen sichtbaren Kopien), ohne neu zu zeichnen
  function paintDue(todoId, due) {
    document.querySelectorAll(`[data-due-for="${CSS.escape(todoId)}"]`).forEach((box) => {
      box.className = dueClass(due);
      $('.due-label', box).innerHTML = dueInner(due);
      box.closest('li').classList.toggle('urgent', !!dueStatus(due));
    });
  }

  const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value || '–')}</dd></div>`;
  const bullets = (items) => (Array.isArray(items) ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<p>${esc(items)}</p>`);
  // Lernergebnisse beginnen oft mit einem Einleitungssatz ("Die Studierenden können:"), dem die übrigen Punkte
  // untergeordnet sind. Er steht dann über der Aufzählung, statt selbst ein Punkt zu sein.
  const isIntro = (text, next) => /:$/.test(text)
    || (text.length <= 70 && (/(…|\.\.\.)$/.test(text) || (!/[.,;!?]$/.test(text) && /^[a-zäöü]/.test(next))));
  function outcomes(items) {
    if (!Array.isArray(items)) return bullets(items);
    const i = items.findIndex((text, k) => k < items.length - 1 && isIntro(text, items[k + 1]));
    if (i < 0) return bullets(items);
    const rest = bullets(items.slice(i + 1));
    if (i === 0) return `<p>${esc(items[0])}</p>${rest}`;
    return `<ul>${items.slice(0, i).map((t) => `<li>${esc(t)}</li>`).join('')}<li>${esc(items[i])}${rest}</li></ul>`;
  }

  // Klausurtermin in der Detailansicht: gleiche Technik wie bei den Fristen (.datebtn)
  const examInner = (date) => ICON_CAL + `<span>${date ? esc(fmtShortYear.format(fromYmd(date))) : 'Termin eintragen'}</span>`;
  function examsHtml(m) {
    const e = examsOf(m.id);
    return `<h3>Klausurtermin</h3><dl class="facts exams">${EXAM_KEYS.map((key, i) => `<div><dt>${i + 1}. Termin</dt><dd>
        <span class="datebtn exam${e[key] ? '' : ' none'}" data-exam-for="${key}" title="Termin ${e[key] ? 'ändern' : 'eintragen'}"><span class="due-label">${examInner(e[key])}</span><input type="date" data-exam="${key}" value="${esc(e[key] || '')}" aria-label="${i + 1}. Klausurtermin für ${esc(m.title)}"></span>
        <button class="due-clear" data-act="clear-exam" data-key="${key}" aria-label="${i + 1}. Klausurtermin entfernen" title="Termin entfernen"${e[key] ? '' : ' hidden'}>×</button>
      </dd></div>`).join('')}</dl>`;
  }
  // Anzeige eines Termins in der geöffneten Detailansicht an Ort und Stelle aktualisieren
  function paintExams() {
    const dlg = $('#detail');
    if (!dlg.open) return;
    const e = examsOf(dlg.dataset.id);
    dlg.querySelectorAll('[data-exam-for]').forEach((box) => {
      const date = e[box.dataset.examFor] || '';
      const input = $('input', box);
      box.classList.toggle('none', !date);
      box.title = `Termin ${date ? 'ändern' : 'eintragen'}`;
      $('.due-label', box).innerHTML = examInner(date);
      box.nextElementSibling.hidden = !date;
      if (document.activeElement !== input) input.value = date;
    });
  }

  // Note in der Detailansicht: Auswahlfeld, "–" entfernt den Eintrag
  function gradeHtml(m) {
    const cur = gradeOf(m);
    const opts = gradeOptions(m).map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v === GR.PASSED && m.custom ? 'bestanden (unbenotet)' : gradeText(v)}</option>`).join('');
    return `<h3>Note</h3><select class="grade-select${cur === null ? ' none' : ''}" data-grade aria-label="Note für ${esc(m.title)}"><option value="">–</option>${opts}</select>`;
  }
  // Auswahlfeld in der geöffneten Detailansicht auf den aktuellen Stand bringen (z. B. nach Sync)
  function paintGrade() {
    const dlg = $('#detail');
    const sel = dlg.open ? $('select[data-grade]', dlg) : null;
    const m = sel && allModules().find((x) => x.id === dlg.dataset.id);
    if (!m) return;
    const value = String(gradeOf(m) ?? '');
    sel.classList.toggle('none', !value);
    if (sel.value !== value) sel.value = value;
  }

  function openDetail(id) {
    const m = allModules().find((x) => x.id === id);
    if (!m) return;
    const d = m.moses || {};
    const s = semOf(m);
    const dlg = $('#detail');
    const kind = m.custom ? 'Wahlmodul (selbst angelegt)' : `${m.kind}modul laut StuPO · ${m.areas.join(' / ')}`;
    const exam = [d.pruefungsform || m.exam, d.dauer].filter(Boolean).join(', ');
    let body = `<dl class="facts">
        ${fact('Semester', s ? `${s}. Semester` : 'nicht eingeplant')}
        ${fact('Leistungspunkte', m.lp ? `${m.lp} LP` : '')}
        ${fact('Benotung', m.graded === undefined ? d.benotung : m.graded ? 'Benotet' : 'Unbenotet')}
        ${fact('Prüfungsform und Dauer', exam)}
        ${m.custom ? '' : fact('Gültigkeit', d.gueltigkeit) + fact('Sprache', d.sprache) + fact('Lehrsprache', d.lehrsprache)
          + fact('Modulverantwortliche*r', d.verantwortlich) + fact('Fakultät', d.fakultaet) + fact('Institut', d.institut) + fact('Fachgebiet', d.fachgebiet)}
      </dl>`;
    if (hasKlausur(m)) body += examsHtml(m);
    body += gradeHtml(m);
    if (!m.custom) {
      if (!m.moses) body += '<p class="note">Die Details aus Moses (Verantwortliche, Lehrinhalte, Modulbestandteile …) sind für dieses Modul noch nicht hinterlegt.</p>';
      if (d.lernergebnisse && d.lernergebnisse.length) body += `<h3>Lernergebnisse</h3>${outcomes(d.lernergebnisse)}`;
      if (d.lehrinhalte && d.lehrinhalte.length) body += `<h3>Lehrinhalte</h3>${bullets(d.lehrinhalte)}`;
      if (d.bestandteile && d.bestandteile.length) {
        body += `<h3>Modulbestandteile</h3><table class="parts"><thead><tr><th>Art</th><th>Veranstaltung</th><th>SWS</th><th class="hide-s">Turnus</th><th class="hide-s">Sprache</th></tr></thead><tbody>${d.bestandteile.map((b) =>
          `<tr><td class="art">${esc(b.art)}</td><td>${esc(b.name)}${b.wahl ? ' <span class="note">(Wahl)</span>' : ''}</td><td>${esc(b.sws)}</td><td class="hide-s">${esc(b.turnus)}</td><td class="hide-s">${esc(b.sprache)}</td></tr>`).join('')}</tbody></table>`;
      }
      if (d.hinweis) body += `<p class="note" style="margin-top:14px">${esc(d.hinweis)}</p>`;
      if (d.url) body += `<a class="moses-link" href="${esc(d.url)}" target="_blank" rel="noopener">Modulbeschreibung in Moses öffnen ↗</a>`;
    }
    dlg.innerHTML = `<div class="detail-inner"${s ? ` style="--sem:var(--s${s})"` : ''}>
        <div class="detail-head"><h2>${esc(m.title)}<span class="sub">${esc(kind)}</span></h2><button class="close" data-act="close" aria-label="Schließen">×</button></div>
        <div class="detail-body">${body}</div>
      </div>`;
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
    $('.detail-body', dlg).scrollTop = 0;
  }

  let toastTimer;
  function toast(text, undo) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button>Rückgängig</button>' : ''}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
    if (undo) $('button', el).onclick = () => { el.hidden = true; undo(); };
  }

  /* ---------- 3. Bedienung ---------- */

  // Änderung übernehmen: lokal speichern, neu zeichnen, an Firestore schicken
  function commit(patch) {
    metrics.saves++;
    saveLocal();
    refresh();
    sync.push(patch);
  }
  function setTodos(id, list) {
    if (list.length) state.todos[id] = list; else delete state.todos[id];
    commit({ todos: { [id]: list } });
  }
  // Klausurtermin setzen (date = "YYYY-MM-DD") oder entfernen (date = ''); key ist 't1' oder 't2'
  function setExam(id, key, date) {
    const cur = { ...examsOf(id) };
    if ((cur[key] || '') === date) return;
    if (date) cur[key] = date; else delete cur[key];
    if (Object.keys(cur).length) state.exams[id] = cur; else delete state.exams[id];
    commit({ exams: { [id]: { [key]: date || sync.DELETE } } });
  }
  // Note setzen (Zehntelnote oder 'p') oder entfernen (value = null)
  function setGrade(id, value) {
    if ((state.grades[id] ?? null) === value) return;
    if (value === null) delete state.grades[id]; else state.grades[id] = value;
    commit({ grades: { [id]: value === null ? sync.DELETE : value } });
  }
  // Frist eines ToDos setzen (due = "YYYY-MM-DD") oder entfernen (due = '')
  function setDue(modId, todoId, due) {
    const before = todosOf(modId);
    const old = before.find((x) => x.id === todoId);
    if (!old || (old.due || '') === due) return;
    paintDue(todoId, due);
    setTodos(modId, before.map((x) => (x === old ? todoItem(x.id, x.text, due) : x)));
  }

  const main = $('#main');

  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const card = el.closest('.card');
    if (el.dataset.act === 'toggle') {
      const a = el.dataset.area;
      if (ui.filter !== 'all' || ui.q) return; // beim Filtern sind alle Treffer sichtbar
      ui.open.has(a) ? ui.open.delete(a) : ui.open.add(a);
      try { localStorage.setItem(LS_OPEN, JSON.stringify([...ui.open])); } catch { /* egal */ }
      render();
    } else if (el.dataset.act === 'toggle-all') {
      ui.allOpen = !ui.allOpen;
      try { localStorage.setItem(LS_ALL, ui.allOpen ? '1' : '0'); } catch { /* egal */ }
      render();
    } else if (el.dataset.act === 'toggle-grades') {
      ui.gradesOpen = !ui.gradesOpen;
      try { localStorage.setItem(LS_GRADES, ui.gradesOpen ? '1' : '0'); } catch { /* egal */ }
      render();
    } else if (el.dataset.act === 'about') {
      if (window.ABOUT) window.ABOUT.open();
    } else if (el.dataset.act === 'toggle-how') {
      ui.howOpen = !ui.howOpen;
      render();
    } else if (el.dataset.act === 'grade-detail') {
      openDetail(el.dataset.id);
    } else if (el.dataset.act === 'clear-due') {
      const modId = el.closest('[data-mod]').dataset.mod;
      const todoId = el.dataset.todoId;
      const old = todosOf(modId).find((x) => x.id === todoId);
      if (!old || !old.due) return;
      setDue(modId, todoId, '');
      toast('Frist entfernt', () => setDue(modId, todoId, old.due));
    } else if (el.dataset.act === 'clear-new-due') {
      const input = el.closest('form').elements.due;
      input.value = '';
      paintNewDue(input);
    } else if (el.dataset.act === 'detail' && card) {
      openDetail(card.dataset.id);
    } else if (el.dataset.act === 'remove-custom' && card) {
      const id = card.dataset.id;
      const backup = { c: state.custom[id], s: state.sem[id], t: state.todos[id], e: state.exams[id], g: state.grades[id] };
      delete state.custom[id]; delete state.sem[id]; delete state.todos[id]; delete state.exams[id]; delete state.grades[id];
      commit({ custom: { [id]: sync.DELETE }, sem: { [id]: sync.DELETE }, todos: { [id]: sync.DELETE }, exams: { [id]: sync.DELETE }, grades: { [id]: sync.DELETE } });
      toast('Modul entfernt', () => {
        state.custom[id] = backup.c;
        if (backup.s !== undefined) state.sem[id] = backup.s;
        if (backup.t) state.todos[id] = backup.t;
        if (backup.e) state.exams[id] = backup.e;
        if (backup.g !== undefined) state.grades[id] = backup.g;
        commit({ custom: { [id]: backup.c }, sem: { [id]: backup.s ?? 0 }, todos: { [id]: backup.t || [] }, exams: { [id]: backup.e || sync.DELETE }, grades: { [id]: backup.g ?? sync.DELETE } });
      });
    }
  });

  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('select.sem')) {
      const id = t.dataset.sem;
      state.sem[id] = Number(t.value);
      commit({ sem: { [id]: state.sem[id] } });
    } else if (t.matches('input[data-due]')) {
      // Frist eines bestehenden ToDos geändert. Leer = Frist entfernt (z. B. "Zurücksetzen" in der Datumsauswahl).
      // Unfertige Zwischenstände beim Tippen (Jahr "0002") werden übersprungen.
      if (t.value && !validDate(t.value)) return;
      setDue(t.closest('[data-mod]').dataset.mod, t.dataset.due, t.value);
    } else if (t.matches('.todo-add input[type="date"]')) {
      paintNewDue(t);
    } else if (t.matches('.goal-input')) {
      // Feld verlassen: gültige Eingabe einheitlich schreiben ("2.3" wird "2,3")
      const wish = GR.parseWish(t.value);
      if (wish !== null) setWish(t, GR.fmt1(wish));
    } else if (t.matches('input[data-todo]')) {
      const id = t.closest('[data-mod]').dataset.mod;
      const todoId = t.dataset.todo;
      // in allen sichtbaren Kopien (Kästchen und Gesamtliste) ausblenden, dann entfernen
      ui.done.add(todoId);
      document.querySelectorAll(`input[data-todo="${CSS.escape(todoId)}"]`).forEach((cb) => { cb.checked = true; cb.disabled = true; cb.closest('li').classList.add('done'); });
      setTimeout(() => {
        ui.done.delete(todoId);
        const before = todosOf(id);
        const index = before.findIndex((x) => x.id === todoId);
        if (index < 0) return;
        const item = before[index];
        setTodos(id, before.filter((x) => x.id !== todoId));
        toast(`Erledigt: ${item.text}`, () => {
          const cur = todosOf(id).slice();
          cur.splice(Math.min(index, cur.length), 0, item);
          setTodos(id, cur);
        });
      }, 320);
    }
  });

  main.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.act === 'add-todo') {
      const text = form.elements.text.value.trim();
      if (!text) { form.elements.text.focus(); return; }
      const id = form.closest('.card').dataset.id;
      const due = form.elements.due.value;
      if (document.activeElement === form.elements.due) form.elements.text.focus({ preventScroll: true }); // Enter im Datumsfeld
      form.reset();
      setTodos(id, todosOf(id).concat(todoItem(uid(), text, due)));
    } else if (form.dataset.act === 'add-custom') {
      const title = form.elements.title.value.trim();
      if (!title) return;
      const id = 'x-' + uid();
      state.custom[id] = { title, lp: Math.max(0, Math.min(30, parseInt(form.elements.lp.value, 10) || 0)) };
      form.reset();
      commit({ custom: { [id]: state.custom[id] } });
    }
  });

  // Zielrechner: Wunschschnitt merken (nur in diesem Browser) und das Ergebnis sofort anzeigen
  function setWish(input, text) {
    if (input.value !== text) input.value = text;
    ui.wish = text;
    try { localStorage.setItem(LS_WISH, text); } catch { /* egal */ }
    paintGoal();
  }
  main.addEventListener('input', (e) => { if (e.target.matches('.goal-input')) setWish(e.target, e.target.value); });
  // Pfeiltasten ändern den Wunschschnitt in Schritten von 0,1
  main.addEventListener('keydown', (e) => {
    if (!e.target.matches('.goal-input') || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const wish = GR.parseWish(e.target.value);
    if (wish === null) return;
    e.preventDefault();
    setWish(e.target, GR.fmt1(Math.max(10, Math.min(40, wish + (e.key === 'ArrowUp' ? 1 : -1)))));
  });

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    const v = b.dataset.filter;
    const next = /^\d+$/.test(v) ? Number(v) : v;
    ui.filter = ui.filter === next ? 'all' : next; // erneutes Antippen hebt den Filter auf
    render();
    window.scrollTo({ top: 0 });
  });

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { ui.q = e.target.value.trim(); render(); }, 120);
  });

  const dlg = $('#detail');
  dlg.addEventListener('click', (e) => {
    const clear = e.target.closest('[data-act="clear-exam"]');
    if (clear) { setExam(dlg.dataset.id, clear.dataset.key, ''); paintExams(); }
    else if (e.target === dlg || e.target.closest('[data-act="close"]')) dlg.close();
  });
  // Note oder Klausurtermin in der Detailansicht geändert.
  // Termin: leer = entfernt; unfertige Zwischenstände beim Tippen überspringen.
  dlg.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('select[data-grade]')) {
      const m = allModules().find((x) => x.id === dlg.dataset.id);
      const value = t.value === GR.PASSED ? GR.PASSED : t.value ? Number(t.value) : null;
      if (m && (value === null || gradeOptions(m).includes(value))) setGrade(m.id, value);
      paintGrade();
      return;
    }
    if (!t.matches('input[data-exam]') || (t.value && !validDate(t.value))) return;
    setExam(dlg.dataset.id, t.dataset.exam, t.value);
    paintExams();
  });

  // Datumsfeld verlassen: aufgeschobenes Neuzeichnen nachholen. Kurz warten, damit der Klick,
  // der das Feld verlassen hat, noch sein Ziel trifft (die Liste wird beim Zeichnen neu sortiert).
  document.addEventListener('focusout', (e) => {
    if (renderPending && e.target.matches('input[type="date"]')) setTimeout(() => { if (renderPending) refresh(); }, 300);
  });
  // Sicherheitsnetz fürs iPhone: Tipp neben ein noch fokussiertes Datumsfeld gibt den Fokus frei
  document.addEventListener('pointerdown', (e) => {
    const a = document.activeElement;
    if (dateBusy() && a !== e.target) a.blur();
  }, true);

  // Änderungen aus einem anderen Tab desselben Browsers übernehmen
  window.addEventListener('storage', (e) => { if (e.key === LS_STATE) { state = loadLocal(); refresh(); } });

  // Tageswechsel: Seite bleibt über Mitternacht offen oder kommt wieder in den Vordergrund
  const checkDay = () => { if (ymd(new Date()) !== now.today) refresh(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
  window.addEventListener('pageshow', checkDay);
  window.addEventListener('focus', checkDay);
  setInterval(checkDay, 30000);

  /* ---------- 4. Anmeldung und Firestore-Sync ---------- */

  const sync = (() => {
    const cfg = window.FIREBASE_CONFIG || {};
    const el = $('#sync');
    const gate = $('#gate');
    const DELETE = { __delete: true }; // Platzhalter, wird beim Senden durch deleteField() ersetzt
    let fb = null, ref = null, user = null, unsub = null, status = cfg.apiKey ? 'loading' : 'local';

    function draw() {
      // Anmeldesperre: Ist Firebase eingerichtet, bleibt die App gesperrt, bis jemand angemeldet ist.
      // Beim Verbinden ist die Seite leer; danach steht dort die Anmeldung oder ein Hinweis, falls sie nicht erreichbar ist.
      setLocked(!!cfg.apiKey && !user);
      // Überschrift der Anmeldeseite; beim Verbinden bleibt die Seite leer, damit sie bei angemeldeten Personen nicht kurz aufblitzt
      const gateHead = '<img class="gate-logo" src="Logo.png" alt="" width="512" height="512"><h1 class="gate-title">Uni Organisator</h1><p class="gate-sub">Aufgaben, Noten, Module organisieren</p>';
      gate.innerHTML = status === 'out' ? gateHead + '<button class="btn primary" data-sync="in">Mit Google anmelden</button>'
        : status === 'error' ? gateHead + '<p>Die Anmeldung ist gerade nicht erreichbar.</p><button class="btn" data-sync="retry">Neu laden</button>'
        : '';
      if (status === 'local') el.innerHTML = '<span class="dot"></span><span title="Daten liegen nur in diesem Browser. Sync: siehe README.">Nur auf diesem Gerät</span>';
      else if (status === 'loading') el.innerHTML = '<span class="dot"></span><span>Verbinde …</span>';
      else if (status === 'out') el.innerHTML = '<button class="btn primary" data-sync="in">Mit Google anmelden</button>';
      else if (status === 'in') el.innerHTML = `<span class="dot on"></span><span title="Synchronisiert${user.email ? ' · ' + esc(user.email) : ''}">Sync.</span><button class="btn ghost" data-sync="out">Abmelden</button>`;
      else el.innerHTML = '<span class="dot err"></span><span title="Sync nicht erreichbar">Sync-Fehler</span><button class="btn ghost" data-sync="retry">Neu laden</button>';
    }

    function prepare(patch) {
      // {__delete:true} → deleteField(); undefined entfernen
      const out = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === DELETE) out[k] = fb.deleteField();
        else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = prepare(v);
        else if (v !== undefined) out[k] = v;
      }
      return out;
    }

    function push(patch) {
      if (!ref) return;
      metrics.pushes++;
      fb.setDoc(ref, prepare(patch), { merge: true }).then(() => { metrics.lastSync = Date.now(); }).catch((err) => { console.error('Sync fehlgeschlagen', err); status = 'error'; draw(); });
    }

    async function init() {
      try {
        const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK}/`;
        const [app, auth, fs] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
        fb = { ...auth, ...fs };
        const fbApp = app.initializeApp(cfg);
        const a = auth.getAuth(fbApp);
        const db = fs.getFirestore(fbApp);
        fb.auth = a;
        auth.onAuthStateChanged(a, (u) => {
          user = u;
          if (unsub) { unsub(); unsub = null; }
          ref = null;
          if (!u) { status = 'out'; draw(); return; }
          // Der lokal gespeicherte Stand gehört dem zuletzt angemeldeten Konto. Meldet sich in diesem Browser
          // ein anderes Konto an, beginnt es leer, statt fremde ToDos zu sehen oder als eigene hochzuladen.
          try {
            const owner = localStorage.getItem(LS_UID);
            if (owner && owner !== u.uid) { state = normalize(null); saveLocal(); }
            localStorage.setItem(LS_UID, u.uid);
          } catch { /* Speicher nicht verfügbar */ }
          ref = fs.doc(db, 'users', u.uid, 'state', 'main');
          status = 'in'; draw();
          const failed = (err) => { console.error('Sync-Fehler', err); status = 'error'; draw(); };
          unsub = fs.onSnapshot(ref, (snap) => {
            if (snap.metadata.hasPendingWrites) return; // eigene, noch nicht bestätigte Änderung
            metrics.snapshots++;
            metrics.lastSync = Date.now();
            if (!snap.exists()) { fs.setDoc(ref, state).catch(failed); return; } // erste Anmeldung: lokalen Stand hochladen
            state = normalize(snap.data());
            saveLocal();
            refresh();
            if (status !== 'in') { status = 'in'; draw(); }
          }, failed);
        });
      } catch (err) {
        console.error('Firebase konnte nicht geladen werden', err);
        status = 'error'; draw();
      }
    }

    // Die Knöpfe stehen im Kopfbereich (#sync) oder, solange gesperrt ist, auf der leeren Seite (#gate)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sync]');
      if (!b) return;
      if (b.dataset.sync === 'in') fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider()).catch((err) => { if (err.code !== 'auth/popup-closed-by-user') toast('Anmeldung fehlgeschlagen'); console.error(err); });
      else if (b.dataset.sync === 'out') fb.signOut(fb.auth);
      else location.reload();
    });

    draw();
    if (cfg.apiKey) init();
    return { push, DELETE, status: () => status };
  })();

  // Lesender Zugriff für das Fenster „Über diese App“ (js/about.js). Bewusst ohne Konto, Kennungen und Schlüssel.
  window.UNIAPP = {
    info() {
      const todos = Object.values(state.todos).flat();
      const stateJson = JSON.stringify(state);
      return {
        sync: sync.status(),
        firebaseSdk: FIREBASE_SDK,
        metrics: { ...metrics },
        stateBytes: new Blob([stateJson]).size,
        counts: {
          todos: todos.length,
          todosDue: todos.filter((t) => t.due).length,
          grades: Object.keys(state.grades).length,
          exams: Object.values(state.exams).reduce((n, e) => n + Object.keys(e).length, 0),
          custom: Object.keys(state.custom).length,
          planned: allModules().filter((m) => semOf(m)).length,
        },
      };
    },
  };

  render();
})();
