# Studienplan – Wirtschaftsinformatik B.Sc. (TU Berlin)

Web-App für Module, Semesterplanung und ToDos. Reines HTML/CSS/JavaScript ohne Build-Schritt, läuft auf GitHub Pages und ist für MacBook und iPhone ausgelegt.

## Was die App kann

- Alle Module der StuPO vom 13.10.2025 als Kästchen: 16 Pflichtmodule (inkl. Bachelorarbeit) und 168 Wahlpflichtmodule, gruppiert nach Bereich. Die Wahlpflichtbereiche sind einklappbar.
- Semesterfeld pro Modul (oben rechts im Kästchen). Das Kästchen wird in der Semesterfarbe eingefärbt. Pflichtmodule starten mit dem Semester aus dem Studienverlaufsplan.
- „Sortieren": Filter nach Semester, nach „Ohne Semester" und nach „Mit ToDos". Jeder Semester-Chip zeigt die eingeplanten LP.
- ToDos pro Modul: Text eingeben, Enter. Abhaken lässt das ToDo verschwinden (5 Sekunden lang „Rückgängig" möglich).
- Klick auf den Modultitel öffnet die Detailansicht.
- Wahlbereich: eigene Module (z. B. Sprachkurse) mit Titel und LP anlegen.
- Suche über alle Module.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seitengerüst |
| `css/style.css` | Layout und Farben (Semesterfarben stehen ganz oben als `--s1` bis `--s10`) |
| `js/app.js` | Logik: Zustand, Darstellung, Bedienung, Sync |
| `js/firebase-config.js` | Firebase-Zugangsdaten für den Sync (anfangs leer) |
| `data/modules.js` | Alle Moduldaten, fest im Quellcode |

## Lokal ansehen

Im Projektordner im Terminal:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Ohne Firebase-Konfiguration läuft die App im lokalen Modus („Nur auf diesem Gerät").

## Auf GitHub Pages veröffentlichen

1. Auf github.com ein neues, leeres Repository anlegen, z. B. `UniApp`.
2. Im Projektordner im Terminal (oder im IntelliJ-Terminal):

   ```bash
   git init
   git add .
   git commit -m "Studienplan-App"
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
7. Committen und pushen. In der App erscheint oben rechts „Mit Google anmelden". Auf beiden Geräten mit demselben Google-Konto anmelden.

Gut zu wissen:

- Die Werte in `firebase-config.js` sind keine Geheimnisse und dürfen im öffentlichen Repository stehen. Den Schutz übernehmen die Regeln aus Schritt 5.
- Bei der ersten Anmeldung wird der lokale Stand dieses Geräts hochgeladen. Existiert in Firestore schon ein Stand, ersetzt er den lokalen.
- Gespeichert wird ein Dokument unter `users/<deine-uid>/state/main` mit Semestern, ToDos und eigenen Modulen.

## Anpassen (z. B. mit Claude Code)

- **Semesterfarben:** `css/style.css`, Variablen `--s1` … `--s10` (hell und dunkel getrennt).
- **Moduldaten korrigieren:** `data/modules.js`. Jedes Modul hat `title`, `lp`, `exam`, `graded`, `kind`, `areas`, `defaultSemester` und optional `moses` mit den Detailfeldern.
- **Standard-Semester:** Feld `defaultSemester` im jeweiligen Modul.

## Datenquellen

- Studien- und Prüfungsordnung B.Sc. Wirtschaftsinformatik vom 13.10.2025 (AMBl. TU 04/2026): Modulliste, LP, Prüfungsform, Benotung, Pflicht/Wahlpflicht, Studienverlaufsplan.
- Moses-Modulverzeichnis der TU Berlin: Detailangaben je Modul.

Verbindlich ist immer die aktuelle Modulbeschreibung in Moses.
