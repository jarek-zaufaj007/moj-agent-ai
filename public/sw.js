// Minimalny service worker (Lekcja 11 / Warsztat 4).
//
// Jest tu z jednego powodu: Chrome uznaje aplikację za instalowalną dopiero
// wtedy, gdy ma zarejestrowany service worker z obsługą zdarzenia "fetch".
// Bez niego zdarzenie beforeinstallprompt nigdy nie poleci i nie ma jak
// pokazać systemowego monitu o instalację.
//
// Celowo NIE cache'uje niczego. Aplikacja jest w całości dynamiczna — dane
// są per użytkownik, odpowiedzi AI lecą strumieniem — a cache app-shella
// potrafiłby po deployu serwować starą wersję i to jest znacznie gorszy
// problem niż brak trybu offline.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Świadomie pusto: bez respondWith żądanie idzie normalną drogą do sieci.
});
