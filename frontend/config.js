// Konfiguration der Website. Diese Datei enthält KEINE Geheimnisse – sie ist öffentlich lesbar.
//
// apiBase: Adresse des Ändy-Backends, z. B. "https://aendy-backend.onrender.com".
//   - Leer lassen ("") wenn das Backend die Website selbst ausliefert (gleicher Server).
//   - Bei GitHub Pages wird der Wert beim Deployment automatisch aus der Repository-Variable
//     AENDY_API_BASE eingetragen (siehe .github/workflows/pages.yml und docs/DEPLOYMENT.md).
//   - Nutzer können die Adresse außerdem in den Einstellungen unter „Verbindung“ ändern.
window.AENDY_CONFIG = {
  apiBase: '',
};
