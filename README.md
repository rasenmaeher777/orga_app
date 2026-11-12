# Uni Organisator – Wirtschaftsinformatik B.Sc. (TU Berlin)

Web-App für Module, Semesterplanung und ToDos. Reines HTML/CSS/JavaScript ohne Build-Schritt, läuft auf GitHub Pages und ist für MacBook und iPhone ausgelegt.

## Was die App kann

- Anmeldesperre: Ohne Anmeldung zeigt die Seite nur einen einfarbigen Hintergrund mit dem Knopf „Mit Google anmelden". Module, ToDos und Kopfbereich erscheinen erst nach der Anmeldung; nach dem Abmelden ist die Seite wieder leer.
- Alle Module der StuPO vom 13.10.2025 als Kästchen: 16 Pflichtmodule (inkl. Bachelorarbeit) und 177 Wahlpflichtmodule (168 aus der Modulliste der StuPO, 9 weitere aus der Moses-Modulliste zur StuPO 2025), gruppiert nach Bereich. Die Wahlpflichtbereiche sind einklappbar.
- Semesterfeld pro Modul (oben rechts im Kästchen). Das Kästchen wird in der Semesterfarbe eingefärbt. Pflichtmodule starten mit dem Semester aus dem Studienverlaufsplan.
- „Sortieren": Filter nach Semester, nach „Ohne Semester" und nach „Mit ToDos". Jeder Semester-Chip zeigt die eingeplanten LP.
- ToDos pro Modul: Text eingeben, Enter. Abhaken lässt das ToDo verschwinden (5 Sekunden lang „Rückgängig" möglich).
- ToDos mit Frist: Beim Anlegen über das Kalendersymbol neben dem Textfeld ein Datum wählen (optional). Die Frist steht klein unter dem ToDo, z. B. „Fr., 13.11."; ein Tipp darauf ändert sie, das × daneben entfernt sie. ToDos ohne Frist haben rechts ein Kalendersymbol zum Nachtragen. Im Kästchen sind die ToDos nach Frist sortiert, ToDos ohne Frist stehen am Ende.
- Oben steht das heutige Datum. Daneben klappt „Alle ToDos (Anzahl)" eine Liste aller offenen ToDos aller Module auf, sortiert nach Frist, mit Modultitel und zum Abhaken. Ob die Liste offen ist, merkt sich der Browser.
- ToDos, die morgen oder heute fällig oder überfällig sind, werden rot hervorgehoben und tragen das Label „morgen", „heute" oder „überfällig". Gerechnet wird in der Ortszeit des Geräts; nach Mitternacht oder wenn die App wieder in den Vordergrund kommt, aktualisiert sich die Anzeige.
- Link „StuPO (PDF)" im Kopfbereich lädt die Studien- und Prüfungsordnung herunter.
- Klick auf den Modultitel öffnet die Detailansicht.
- Klausurtermine: In der Detailansicht stehen unter „Klausurtermin" der 1. und 2. Termin. Ein Tipp auf das Feld öffnet die Datumsauswahl, das × daneben entfernt den Termin. Den Abschnitt gibt es nur bei Modulen mit schriftlicher Prüfung oder Portfolioprüfung und bei selbst angelegten Modulen, also z. B. nicht bei der Bachelorarbeit.
- Wahlbereich: eigene Module (z. B. Sprachkurse) mit Titel und LP anlegen.
- Suche über alle Module.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seitengerüst |
| `css/style.css` | Layout und Farben (Semesterfarben stehen ganz oben als `--s1` bis `--s10`) |
| `js/app.js` | Logik: Zustand, Darstellung, Bedienung, Anmeldung und Sync |
| `js/firebase-config.js` | Firebase-Zugangsdaten für Anmeldung und Sync |
| `data/modules.js` | Alle Moduldaten, fest im Quellcode |
| `docs/StuPo.pdf` | Studien- und Prüfungsordnung für den Download-Link (Dateiname mit genau dieser Groß-/Kleinschreibung, GitHub Pages unterscheidet sie) |

## Lokal ansehen

Im Projektordner im Terminal:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen und anmelden (`localhost` ist bei Firebase von Haus aus als Domain zugelassen). Ist `apiKey` in `js/firebase-config.js` leer, läuft die App im lokalen Modus ohne Anmeldung („Nur auf diesem Gerät").

## Auf GitHub Pages veröffentlichen

1. Auf github.com ein neues, leeres Repository anlegen, z. B. `UniApp`.
2. Im Projektordner im Terminal (oder im IntelliJ-Terminal):

   ```bash
   git init
   git add .
   git commit -m "Uni Organisator"
   git branch -M main
   git remote add origin https://github.com/DEIN-NAME/UniApp.git
   git push -u origin main
   ```

3. Im Repository unter **Settings → Pages**: Source „Deploy from a branch", Branch `main`, Ordner `/ (root)`, speichern.
4. Nach etwa einer Minute ist die App unter `https://DEIN-NAME.github.io/UniApp/` erreichbar.
5. Am iPhone in Safari öffnen und über „Teilen → Zum Home-Bildschirm" ablegen.

Spätere Änderungen: `git add . && git commit -m "…" && git push`.

Hinweis: Mit einem kostenlosen GitHub-Konto muss das Repository für Pages öffentlich sein. Die App enthält keine persönlichen Daten; deine ToDos liegen im Browser bzw. in Firestore.

## Firestore-Sync einrichten (MacBook und iPhone synchron)

Einmalig, etwa 10 Minuten. Die Bezeichnungen in der Firebase-Konsole können leicht abweichen.

1. <https://console.firebase.google.com> öffnen, **Projekt erstellen** (Google Analytics wird nicht gebraucht).
2. **Build → Authentication → Sign-in method**: Anbieter **Google** aktivieren.
3. **Authentication → Settings → Authorized domains**: `DEIN-NAME.github.io` hinzufügen.
4. **Build → Firestore Database → Datenbank erstellen**: Produktionsmodus, Standort z. B. `eur3 (Europe)`.
5. Im Tab **Regeln** diese Regeln einfügen und veröffentlichen. Damit kann jede angemeldete Person nur ihre eigenen Daten lesen und schreiben:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

6. **Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps → Web-App hinzufügen (`</>`)**. Die angezeigten Werte `apiKey`, `authDomain`, `projectId` und `appId` in `js/firebase-config.js` eintragen.
7. Committen und pushen. Die App zeigt jetzt nur noch eine leere Seite mit dem Knopf „Mit Google anmelden". Auf beiden Geräten mit demselben Google-Konto anmelden.

Gut zu wissen:

- Die Anmeldesperre ist eine Sichtsperre im Browser. Deine eigenen Daten (Semester, ToDos, Termine) schützen die Firestore-Regeln aus Schritt 5. Die Moduldaten (`data/modules.js`) und die StuPO-PDF liegen dagegen als Dateien im öffentlichen Repository und bleiben über ihre direkte Adresse abrufbar.
- Anmelden kann sich jedes Google-Konto; jedes Konto sieht nur seine eigenen Daten. Meldet sich in einem Browser ein anderes Konto an als zuvor, beginnt es mit leerem Stand.
- Ohne Internetverbindung ist keine Anmeldung möglich, die Seite bleibt dann leer („Die Anmeldung ist gerade nicht erreichbar").
- Die Werte in `firebase-config.js` sind keine Geheimnisse und dürfen im öffentlichen Repository stehen. Den Schutz übernehmen die Regeln aus Schritt 5.
- Bei der ersten Anmeldung wird der lokale Stand dieses Geräts hochgeladen. Existiert in Firestore schon ein Stand, ersetzt er den lokalen.
- Gespeichert wird ein Dokument unter `users/<deine-uid>/state/main` mit Semestern, ToDos und eigenen Modulen. Ein ToDo hat die Felder `id`, `text` und optional `due` (Frist als `"YYYY-MM-DD"`; ohne Frist fehlt das Feld). Klausurtermine liegen unter `exams` als `{ modulId: { t1, t2 } }`, ebenfalls als `"YYYY-MM-DD"` und nur, wenn ein Termin eingetragen ist.

## Anpassen (z. B. mit Claude Code)

- **Semesterfarben:** `css/style.css`, Variablen `--s1` … `--s10` (hell und dunkel getrennt).
- **Farbe für fällige ToDos:** `css/style.css`, Variablen `--due` und `--due-on` (hell und dunkel getrennt).
- **StuPO austauschen:** neue PDF unter `docs/StuPo.pdf` ablegen. Bei anderem Dateinamen den Link in `index.html` anpassen.
- **Moduldaten korrigieren:** `data/modules.js`. Jedes Modul hat `title`, `lp`, `exam`, `graded`, `kind`, `areas`, `defaultSemester` und optional `moses` mit den Detailfeldern.
- **Standard-Semester:** Feld `defaultSemester` im jeweiligen Modul.
- **Welche Module Klausurtermine haben:** `js/app.js`, Liste `KLAUSUR_FORMS` (Prüfungsformen aus dem Feld `exam`).

## Datenquellen

- Studien- und Prüfungsordnung B.Sc. Wirtschaftsinformatik vom 13.10.2025 (AMBl. TU 04/2026): Modulliste, LP, Prüfungsform, Benotung, Pflicht/Wahlpflicht, Studienverlaufsplan.
- Moses-Modulverzeichnis der TU Berlin: Detailangaben je Modul.

Verbindlich ist immer die aktuelle Modulbeschreibung in Moses.
