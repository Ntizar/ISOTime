/**
 * Graph Loader — ISOTime Motor Local
 * ===================================
 * Gestiona el Web Worker de Dijkstra: carga de grafos, cache,
 * detección de ciudad más cercana, y API para calcular isocronas.
 */

import { CONFIG } from './config.js';

let worker = null;
let currentCity = null;
let loadPromise = null;

// ═══════════════════════════════════════════════
// Inicializar worker (lazy)
// ═══════════════════════════════════════════════
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./dijkstra-worker.js', import.meta.url));
  }
  return worker;
}

// ═══════════════════════════════════════════════
// Detectar ciudad más cercana al punto
// ═══════════════════════════════════════════════
export function findNearestCity(lat, lng) {
  let nearest = null;
  let minDist = Infinity;
  const cosLat = Math.cos(lat * Math.PI / 180);

  for (const city of CONFIG.GRAPH_CITIES) {
    const dLat = (city.lat - lat) * 111320;
    const dLng = (city.lng - lng) * 111320 * cosLat;
    const distKm = Math.sqrt(dLat * dLat + dLng * dLng) / 1000;
    if (distKm < city.radius && distKm < minDist) {
      minDist = distKm;
      nearest = city;
    }
  }
  return nearest;
}

// ═══════════════════════════════════════════════
// Cargar grafo de una ciudad en el worker
// ═══════════════════════════════════════════════
export function loadCityGraph(cityName) {
  if (currentCity === cityName) return Promise.resolve({ city: cityName, cached: true });

  if (loadPromise) return loadPromise;

  const w = getWorker();

  loadPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout cargando grafo'));
      loadPromise = null;
    }, 30000);

    const handler = (e) => {
      const { cmd } = e.data;
      if (cmd === 'loaded') {
        clearTimeout(timeout);
        w.removeEventListener('message', handler);
        currentCity = e.data.city;
        loadPromise = null;
        resolve(e.data);
      } else if (cmd === 'error') {
        clearTimeout(timeout);
        w.removeEventListener('message', handler);
        loadPromise = null;
        reject(new Error(e.data.message));
      }
    };

    w.addEventListener('message', handler);
    w.postMessage({ cmd: 'load', city: cityName });
  });

  return loadPromise;
}

// ═══════════════════════════════════════════════
// Calcular isocrona local
// ═══════════════════════════════════════════════
export async function calcularIsocronaLocal(lat, lng, modo, minutos) {
  try {
    // 1. Detectar ciudad
    const city = findNearestCity(lat, lng);
    if (!city) {
      throw new Error('No hay grafo disponible para esta ubicación');
    }

    // 2. Cargar grafo si no está cargado
    await loadCityGraph(city.name);

    // 3. Calcular velocidades según modo
    // modeSpeed > 0: coche (min entre velocidad vía y límite modo)
    // modeSpeed < 0: velocidad fija (andando)
    let modeSpeed;
    if (modo === 'car') {
      modeSpeed = 120; // km/h — las autovías limitan a esto, las calles a menos
    } else if (modo === 'walking') {
      modeSpeed = -5; // 5 km/h fijo (negativo = velocidad fija)
    } else if (modo === 'bike') {
      modeSpeed = -15; // 15 km/h fijo
    } else {
      modeSpeed = -5; // default: andando
    }

    const cutoffSec = minutos * 60;
    const w = getWorker();

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        w.removeEventListener('message', handler);
        reject(new Error('Timeout en cálculo Dijkstra'));
      }, 15000);

      const handler = (e) => {
        const { cmd } = e.data;
        if (cmd === 'result') {
          clearTimeout(timeout);
          w.removeEventListener('message', handler);

          // Reconstruir coords desde flatCoords (Float64Array: [lng, lat, lng, lat, ...])
          const flat = new Float64Array(e.data.flatCoords);
          const coords = [];
          for (let i = 0; i < e.data.numPoints; i++) {
            coords.push([flat[i * 2], flat[i * 2 + 1]]);
          }

          const geojson = {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: {
                mode: modo,
                time_min: minutos,
                area_km2: e.data.areaKm2,
                centro_lat: lat,
                centro_lng: lng,
                simulated: false,
                source: 'dijkstra-local',
                city: city.name,
                node_count: e.data.nodeCount
              },
              geometry: { type: 'Polygon', coordinates: [coords] }
            }]
          };

          resolve({
            geojson,
            areaKm2: e.data.areaKm2,
            radioMaxKm: e.data.radioMaxKm,
            timeMin: minutos,
            coords,
            simulated: false,
            city: city.name
          });

        } else if (cmd === 'error') {
          clearTimeout(timeout);
          w.removeEventListener('message', handler);
          reject(new Error(e.data.message));
        }
      };

      w.addEventListener('message', handler);
      w.postMessage({ cmd: 'isochrone', lat, lng, cutoffSec, modeSpeed });
    });

  } catch (err) {
    throw err;
  }
}

// ═══════════════════════════════════════════════
// Info del grafo cargado actualmente
// ═══════════════════════════════════════════════
export function getLoadedCity() {
  return currentCity;
}

// ═══════════════════════════════════════════════
// Verificar si un punto tiene grafo disponible
// ═══════════════════════════════════════════════
export function hasLocalGraph(lat, lng) {
  return findNearestCity(lat, lng) !== null;
}
