// Firebase-Konfiguration für die Synchronisation zwischen MacBook und iPhone.
//
// Solange apiKey leer ist, läuft die App im lokalen Modus: Semester und ToDos
// werden nur im Browser dieses Geräts gespeichert.
//
// Einrichtung: siehe README.md, Abschnitt "Firestore-Sync einrichten".
// Die Werte findest du in der Firebase-Konsole unter
// Projekteinstellungen → Allgemein → Meine Apps → SDK-Konfiguration.
// Sie sind nicht geheim und dürfen im öffentlichen Repository stehen;
// geschützt werden deine Daten durch die Firestore-Regeln.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAm3IZJEpOAXgSMJrZxYeEKupbDO_9NtOM",
  authDomain: "orgaapp-13d22.firebaseapp.com",
  projectId: "orgaapp-13d22",
  appId: "1:901810419540:web:5a49d42f9847feef973ac1"
};
