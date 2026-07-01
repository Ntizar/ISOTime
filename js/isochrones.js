import { CONFIG } from './config.js';
import { calcularIsocronaSim } from './map.js';
import { calcularIsocronaLocal, hasLocalGraph } from './graph-loader.js';

// ═══════════════════════════════════════════════
// MAIN: Calcular isócrona (ORS → Dijkstra local → OSRM → Sim)
// ═══════════════════════════════════════════════
export async function calcularIsocrona(lng, lat, modo, minutos) {
  // 1. ORS API (con key del usuario) — máxima precisión
  const apiKey = localStorage.getItem(CONFIG.STORAGE_KEY);
  if (apiKey) {
    try {
      return await calcularIsocronaORS(lng, lat, modo, minutos, apiKey);
    } catch (e) {
      console.warn('ORS failed, trying local Dijkstra:', e.message);
    }
  }

  // 2. Dijkstra local (grafo pre-calculado) — sin API, ciudades españolas
  if (hasLocalGraph(lat, lng)) {
    try {
      return await calcularIsocronaLocal(lat, lng, modo, minutos);
    } catch (e) {
      console.warn('Local Dijkstra failed, trying OSRM:', e.message);
    }
  }

  // 3. OSRM público (sin key) — solo coche, boundary detection
  if (modo === 'car') {
    try {
      return await calcularIsocronaOSRM(lng, lat, minutos);
    } catch (e) {
      console.warn('OSRM failed, using simulation:', e.message);
    }
  }

  // 4. Simulación — fallback final
  return calcularIsocronaSim(lng, lat, modo, minutos);
}

// ═══════════════════════════════════════════════
// ORS API v2 (con API key)
// ═══════════════════════════════════════════════
async function calcularIsocronaORS(lng, lat, modo, minutos, apiKey) {
  const profile = CONFIG.PROFILES[modo];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.ORS_TIMEOUT);
  try {
    const url = `${CONFIG.ORS_BASE}/isochrones/${profile}`;
    const body = {
      locations: [[lng, lat]],
      range: [minutos * 60],
      range_type: 'time',
      attributes: ['area']
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`ORS ${response.status}: ${await response.text()}`);
    const data = await response.json();
    if (!data.features || data.features.length === 0) throw new Error('ORS: no features');
    const feature = data.features[0];
    const areaM2 = feature.properties.area || 0;
    const areaKm2 = (areaM2 / 1e6).toFixed(2);
    const radioMaxKm = calcularRadioMaximoFromCoords(feature.geometry.coordinates[0], lng, lat);
    return {
      geojson: { type: 'FeatureCollection', features: [{
        ...feature,
        properties: { ...feature.properties, mode: modo, time_min: minutos, area_km2: parseFloat(areaKm2), centro_lat: lat, centro_lng: lng, simulated: false, source: 'ors' }
      }]},
      areaKm2, radioMaxKm, timeMin: minutos, coords: feature.geometry.coordinates[0], simulated: false
    };
  } catch (error) { clearTimeout(timeoutId); throw error; }
}

// ═══════════════════════════════════════════════
// OSRM público — Boundary detection por dirección
// ═══════════════════════════════════════════════
async function calcularIsocronaOSRM(lng, lat, minutos) {
  const N_DIR = 72;           // 72 direcciones (cada 5°)
  const BATCH_MAX = 89;       // OSRM soporta ~100 coords
  const targetSec = minutos * 60;

  // Radios adaptativos según tiempo (km)
  const radioMaxEstimado = Math.max(minutos * 0.9, 5);
  const radios = [2, 5, 8, 12, 18, 25, 35, 50, 65, 80].filter(r => r <= radioMaxEstimado);

  // 1. Generar puntos radiales: radios × direcciones
  const puntos = [];
  for (const radioKm of radios) {
    for (let d = 0; d < N_DIR; d++) {
      const ang = (d / N_DIR) * 2 * Math.PI;
      const dlat = (radioKm * 1000 * Math.cos(ang)) / 111320;
      const dlng = (radioKm * 1000 * Math.sin(ang)) / (111320 * Math.cos(lat * Math.PI / 180));
      puntos.push({ lng: lng + dlng, lat: lat + dlat, dir: d, radioKm });
    }
  }

  // 2. Query OSRM table por batches
  const resultados = [];
  const origin = { lng, lat, dir: -1, radioKm: 0 };
  
  for (let b = 0; b < puntos.length; b += BATCH_MAX) {
    const batch = [origin, ...puntos.slice(b, b + BATCH_MAX)];
    const durations = await queryOSRMTableBatch(batch);
    for (let i = 1; i < batch.length; i++) {
      if (durations[i] !== null && durations[i] !== undefined) {
        resultados.push({
          dir: batch[i].dir,
          radioKm: batch[i].radioKm,
          dur: durations[i]
        });
      }
    }
    // Stagger entre batches
    if (b + BATCH_MAX < puntos.length) await sleep(80);
  }

  // 3. Para cada dirección, encontrar boundary por interpolación
  const boundaryPoints = [];
  for (let d = 0; d < N_DIR; d++) {
    const ptsDir = resultados.filter(r => r.dir === d).sort((a, b) => a.radioKm - b.radioKm);
    if (ptsDir.length === 0) continue;

    let lastReach = null;
    let firstOver = null;
    for (const p of ptsDir) {
      if (p.dur <= targetSec) {
        lastReach = p;
      } else if (firstOver === null) {
        firstOver = p;
        break;
      }
    }

    let rBoundary;
    if (lastReach && firstOver && firstOver.dur > lastReach.dur) {
      // Interpolación lineal entre último alcanzable y primero que excede
      const frac = (targetSec - lastReach.dur) / (firstOver.dur - lastReach.dur);
      rBoundary = lastReach.radioKm + frac * (firstOver.radioKm - lastReach.radioKm);
    } else if (lastReach) {
      rBoundary = lastReach.radioKm;
    } else {
      continue; // Esta dirección no tiene ningún punto alcanzable
    }

    const ang = (d / N_DIR) * 2 * Math.PI;
    const dlat = (rBoundary * 1000 * Math.cos(ang)) / 111320;
    const dlng = (rBoundary * 1000 * Math.sin(ang)) / (111320 * Math.cos(lat * Math.PI / 180));
    boundaryPoints.push([lng + dlng, lat + dlat]);
  }

  if (boundaryPoints.length < 3) {
    throw new Error('OSRM: muy pocos puntos de boundary alcanzables');
  }

  // 4. Cerrar polígono
  boundaryPoints.push(boundaryPoints[0]);

  const areaKm2 = calcularAreaPoligonoKm2(boundaryPoints).toFixed(2);
  const radioMaxKm = calcularRadioMaximoFromCoords(boundaryPoints, lng, lat);

  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        mode: 'car',
        time_min: minutos,
        area_km2: parseFloat(areaKm2),
        centro_lat: lat,
        centro_lng: lng,
        simulated: false,
        source: 'osrm',
        puntos_boundary: boundaryPoints.length
      },
      geometry: { type: 'Polygon', coordinates: [boundaryPoints] }
    }]
  };

  return { geojson, areaKm2, radioMaxKm, timeMin: minutos, coords: boundaryPoints, simulated: false };
}

// ═══════════════════════════════════════════════
// OSRM Table Query
// ═══════════════════════════════════════════════
async function queryOSRMTableBatch(batch) {
  const coords = batch.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `${CONFIG.OSRM_BASE}/table/v1/driving/${coords}?annotations=duration`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.OSRM_TIMEOUT);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ISOTime/1.0' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
    const data = await response.json();
    if (data.code !== 'Ok') throw new Error(`OSRM: ${data.code}`);
    return data.durations[0]; // tiempos desde origen (índice 0)
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ═══════════════════════════════════════════════
// Utilidades
// ═══════════════════════════════════════════════
function calcularRadioMaximoFromCoords(coords, centerLng, centerLat) {
  let maxDist = 0;
  coords.forEach(([clng, clat]) => {
    const dLat = (clat - centerLat) * 111320;
    const dLng = (clng - centerLng) * 111320 * Math.cos(centerLat * Math.PI / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist > maxDist) maxDist = dist;
  });
  return (maxDist / 1000).toFixed(2);
}

function calcularAreaPoligonoKm2(coords) {
  let area = 0;
  const n = coords.length;
  const avgLat = coords.reduce((s, c) => s + c[1], 0) / n;
  const cosLat = Math.cos(avgLat * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i][0] * coords[j][1] - coords[j][0] * coords[i][1];
  }
  return Math.abs(area / 2) * 111.32 * 111.32 * cosLat;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
