/* Notenberechnung nach § 8 StuPO Wirtschaftsinformatik B.Sc. 2025.
   Reine Funktionen ohne DOM und ohne Zugriff auf den App-Zustand, damit sie einzeln prüfbar sind
   (im Browser als window.GRADES, in Node per require).
   Gerechnet wird durchgehend mit ganzen Zahlen: Noten als Zehntelnoten (23 = 2,3), Summen als
   Zehntelnote × LP. Geteilt wird erst bei der Ausgabe. */
(function () {
  'use strict';

  const VALUES = [10, 13, 17, 20, 23, 27, 30, 33, 37, 40]; // 1,0 bis 4,0
  const PASSED = 'p';       // "bestanden" ohne Note
  const TOTAL_LP = 180;
  // 45 LP gehen nicht in die Note ein: fest 18 LP Wahlbereich und 6 LP Programmierpraktikum,
  // die übrigen 21 LP sind das Budget für die schlechtesten Noten.
  const BUDGET_LP = 21;
  const GRADED_LP = 156;    // 180 − 18 − 6
  const THESIS_ID = 'bachelorarbeit';
  const PRAKTIKUM = 'Programmierpraktikum';
  const STATUS = {
    counts: 'zählt',
    dropped: 'gestrichen (schlechteste Noten)',
    custom: 'zählt nie (Wahlbereich)',
    ungraded: 'zählt nie (unbenotet)',
  };

  const isValue = (v) => v === PASSED || VALUES.includes(v);

  // Reihenfolge beim Streichen: schlechteste Note zuerst, dann mehr LP, dann höheres Semester, dann Titel
  const worstFirst = (a, b) => b.value - a.value || b.lp - a.lp || b.sem - a.sem || a.title.localeCompare(b.title, 'de');

  /* entries: [{ id, title, lp, sem, custom, areas, value }] – ein Eintrag je Modul mit Note.
     Ergebnis:
       rows       die Einträge mit status ('counts' | 'dropped' | 'custom' | 'ungraded')
       passedLp   LP aller Einträge
       allSum/allLp      alle Noten der Studiengangsmodule (ohne eigene Module, ohne "bestanden")
       ungradedLp (U)    LP unbenoteter Module außerhalb von Wahlbereich und Programmierpraktikum
       budget            LP, die gestrichen werden dürfen
       droppedLp (S)     LP, die gestrichen wurden
       countSum/countLp  Module, die in den Zeugnisschnitt eingehen */
  function compute(entries) {
    const rows = entries.filter((e) => isValue(e.value)).map((e) => ({ ...e, lp: e.lp || 0, sem: e.sem || 0, status: 'counts' }));
    const r = { rows, passedLp: 0, allSum: 0, allLp: 0, ungradedLp: 0, budget: 0, droppedLp: 0, countSum: 0, countLp: 0 };

    // Schritt 1 und 2: Einteilung und Streichbudget
    const candidates = [];
    for (const row of rows) {
      r.passedLp += row.lp;
      if (row.custom) { row.status = 'custom'; continue; }
      if (row.value === PASSED) {
        row.status = 'ungraded';
        if (!(row.areas || []).includes(PRAKTIKUM)) r.ungradedLp += row.lp;
        continue;
      }
      r.allSum += row.value * row.lp;
      r.allLp += row.lp;
      if (row.id !== THESIS_ID) candidates.push(row); // die Bachelorarbeit wird nie gestrichen
    }
    r.budget = Math.max(0, BUDGET_LP - r.ungradedLp);

    // Schritt 3: nur ganze Module streichen; beim ersten, das nicht mehr ins Budget passt, ist Schluss
    for (const row of candidates.sort(worstFirst)) {
      if (r.droppedLp + row.lp > r.budget) break;
      row.status = 'dropped';
      r.droppedLp += row.lp;
    }

    // Schritt 4: Zeugnisschnitt
    for (const row of rows) {
      if (row.status !== 'counts') continue;
      r.countSum += row.value * row.lp;
      r.countLp += row.lp;
    }
    return r;
  }

  /* Zielrechner. wish = Wunschschnitt als Zehntelnote (10 bis 40).
     Annahme: Gestrichen bleiben nur die bisher schlechtesten Noten, alle künftigen Noten zählen.
       total (T)  LP, die am Ende in die Note eingehen
       open (R)   noch offene, zählende LP
       kind       'done' | 'impossible' (+ best) | 'safe' | 'need' (+ need)
       need       nötiger Schnitt in den offenen LP als Hundertstelnote, abgerundet (strengere Note)
       best       bester noch erreichbarer Schnitt als Hundertstelnote, aufgerundet */
  function target(r, wish) {
    const total = GRADED_LP - r.ungradedLp - r.droppedLp;
    const open = total - r.countLp;
    if (open <= 0) return { kind: 'done', total, open };
    const rest = wish * total - r.countSum; // Zehntelnote × LP, die die offenen LP zusammen ergeben müssen
    if (rest < 10 * open) return { kind: 'impossible', total, open, best: Math.ceil(((r.countSum + 10 * open) * 10) / total) };
    if (rest > 40 * open) return { kind: 'safe', total, open };
    return { kind: 'need', total, open, need: Math.floor((rest * 10) / open) };
  }

  // sum / lp als Hundertstelnote, kaufmännisch gerundet (2,875 → 288); null ohne LP
  const mean2 = (sum, lp) => (lp > 0 ? Math.floor((20 * sum + lp) / (2 * lp)) : null);
  // sum / lp als Zehntelnote, nach der ersten Nachkommastelle abgeschnitten (2,48 → 24); null ohne LP
  const cut1 = (sum, lp) => (lp > 0 ? Math.floor(sum / lp) : null);

  // Ausgabe mit deutschem Komma: fmt1(23) = "2,3", fmt2(288) = "2,88"
  const fmt1 = (tenths) => `${Math.floor(tenths / 10)},${tenths % 10}`;
  const fmt2 = (hundredths) => `${Math.floor(hundredths / 100)},${String(hundredths % 100).padStart(2, '0')}`;

  // "2,3", "2.3" oder "2" → 23; alles außerhalb von 1,0 bis 4,0 oder mit mehr Stellen → null
  function parseWish(text) {
    const m = /^\s*([1-4])(?:[.,](\d))?\s*$/.exec(String(text ?? ''));
    if (!m) return null;
    const v = Number(m[1]) * 10 + Number(m[2] || 0);
    return v <= 40 ? v : null;
  }

  const api = { VALUES, PASSED, TOTAL_LP, BUDGET_LP, GRADED_LP, THESIS_ID, STATUS, isValue, compute, target, mean2, cut1, fmt1, fmt2, parseWish };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GRADES = api;
})();
