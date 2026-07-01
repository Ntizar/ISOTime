export const CONFIG = {
  ORS_BASE: 'https://api.openrouteservice.org/v2',
  NOMINATIM_BASE: 'https://nominatim.openstreetmap.org',
  PROFILES: { walking: 'foot-walking', car: 'driving-car' },
  OSRM_PROFILES: { walking: 'foot', car: 'driving' },
  SPEEDS: { walking: 5, car: 50 },
  COLORS: { walking: '#2563eb', car: '#f97316' },
  MODES: { walking: 'Andando', car: 'Coche' },
  MODE_ICONS: { walking: '🚶', car: '🚗' },
  MIN_TIME: 5,
  MAX_TIME: 90,
  DEFAULT_TIME: 30,
  DEFAULT_MODE: 'car',
  STORAGE_KEY: 'isotime_ors_key',
  PRESETS: [5, 10, 15, 30, 45, 60, 90],
  ORS_TIMEOUT: 15000,
  OSRM_BASE: 'https://router.project-osrm.org',
  OSRM_TIMEOUT: 12000,
  TILES_URL: 'https://www.ign.es/wmts/ign-base?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=IGNBaseTodo&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/jpeg',
  TILES_ATTRIBUTION: '&copy; Instituto Geográfico Nacional',
  NOMINATIM_USER_AGENT: 'ISOTime/1.0',

  // ═══════════════════════════════════════════════
  // Motor Dijkstra Local — grafos pre-calculados
  // ═══════════════════════════════════════════════
  // Ciudades con grafo viario disponible para cálculo offline.
  // El frontend detecta automáticamente la ciudad más cercana al punto.
  GRAPH_CITIES: [
    { name: 'madrid',      lat: 40.4168,  lng: -3.7038, radius: 12 },
    { name: 'barcelona',   lat: 41.3851,  lng:  2.1734, radius: 15 },
    { name: 'valencia',    lat: 39.4699,  lng: -0.3763, radius: 15 },
    { name: 'sevilla',     lat: 37.3891,  lng: -5.9845, radius: 15 },
    { name: 'zaragoza',    lat: 41.6488,  lng: -0.8891, radius: 15 },
    { name: 'malaga',      lat: 36.7213,  lng: -4.4214, radius: 15 },
    { name: 'murcia',      lat: 37.9922,  lng: -1.1307, radius: 15 },
    { name: 'palma',       lat: 39.5696,  lng:  2.6502, radius: 12 },
    { name: 'bilbao',      lat: 43.2630,  lng: -2.9350, radius: 12 },
    { name: 'alicante',    lat: 38.3452,  lng: -0.4810, radius: 12 },
    { name: 'cordoba',     lat: 37.8882,  lng: -4.7794, radius: 12 },
    { name: 'valladolid',  lat: 41.6523,  lng: -4.7245, radius: 12 },
    { name: 'granada',     lat: 37.1773,  lng: -3.5986, radius: 12 },
    { name: 'oviedo',      lat: 43.3623,  lng: -5.8484, radius: 12 },
    { name: 'pamplona',    lat: 42.8125,  lng: -1.6458, radius: 12 },
    { name: 'santander',   lat: 43.4623,  lng: -3.8090, radius: 12 },
    { name: 'almeria',     lat: 36.8381,  lng: -2.4597, radius: 12 },
    { name: 'sansebastian',lat: 43.3183,  lng: -1.9812, radius: 12 },
    { name: 'burgos',      lat: 42.3439,  lng: -3.6969, radius: 12 },
    { name: 'logrono',     lat: 42.4627,  lng: -2.4449, radius: 12 },
  ]
};
