import { CONFIG } from './config.js';
import { calcularIsocronaSim } from './map.js';

// ═══════════════════════════════════════════════
// MAIN: Calcular isócrona (ORS → OSRM → Sim)
// ═══════════════════════════════════════════════
export async function calcularIsocrona(lng, lat, modo, minutos) {
  // 1. Si hay API key ORS, usar ORS (datos más precisos)
  const apiKey = localStorage.getItem(CONFIG.STORAGE_KEY);
  if (apiKey) {
    try {
      return await calcularIsocronaORS(lng, lat, modo, minutos, apiKey);
    } catch (e) {
      console.warn('ORS failed, trying OSRM:', e.message);
    }
  }
  // 2. OSRM público (sin key, datos reales de routing)
  if (modo === 'car') {
    try {
      return await calcularIsocronaOSRM(lng, lat, minutos);
    } catch (e) {
      console.warn('OSRM failed, using simulation:', e.message);
    }
  }
  // 3. Simulación (fallback final, o para andando sin ORS)
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
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ORS ${response.status}: ${errText}`);
    }
    const data = await response.json();
    if (!data.features || data.features.length === 0) throw new Error('ORS: no features');
    const feature = data.features[0];
    const areaM2 = feature.properties.area || 0;
    const areaKm2 = (areaM2 / 1e6).toFixed(2);
    const radioMaxKm = calcularRadioMaximoFromCoords(feature.geometry.coordinates[0], lng, lat);
    const enrichedFeature = {
      ...feature,
      properties: {
        ...feature.properties,
        mode: modo,
        time_min: minutos,
        area_km2: parseFloat(areaKm2),
        centro_lat: lat,
        centro_lng: lng,
        simulated: false,
        source: 'ors'
      }
    };
    return {
      geojson: { type: 'FeatureCollection', features: [enrichedFeature] },
      areaKm2,
      radioMaxKm,
      coords: feature.geometry.coordinates[0],
      simulated: false
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ═══════════════════════════════════════════════
// OSRM público — Routing real sin API key
// ═══════════════════════════════════════════════
async function calcularIsocronaOSRM(lng, lat, minutos) {
  // 1. Calcular radios a probar según tiempo
  const radiosKm = calcularRadiosParaTiempo(minutos);
  
  // 2. Generar puntos radiales en múltiples anillos
  const todosLosPuntos = [];
  const n = CONFIG.OSRM_POINTS_PER_RING;
  for (const radioKm of radiosKm) {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * 2 * Math.PI;
      const dlat = (radioKm * 1000 * Math.cos(ang)) / 111320;
      const dlng = (radioKm * 1000 * Math.sin(ang)) / (111320 * Math.cos(lat * Math.PI / 180));
      todosLosPuntos.push({
        lng: lng + dlng,
        lat: lat + dlat,
        angulo: ang,
        radioKm
      });
    }
  }

  // 3. Llamadas OSRM table por batches (max 100 coords por llamada)
  const MAX_COORDS = 90; // origen + 89 puntos
  const puntosAlcanzables = [];
  const batch = [];
  batch.push({ lng, lat, angulo: 0, radioKm: 0, isOrigin: true });
  
  for (const punto of todosLosPuntos) {
    batch.push(punto);
    if (batch.length >= MAX_COORDS) {
      const resultados = await queryOSRMTable(batch);
      for (const r of resultados) {
        if (r.reachable) puntosAlcanzables.push(r);
      }
      batch.length = 0;
      batch.push({ lng, lat, angulo: 0, radioKm: 0, isOrigin: true });
      // Stagger para no saturar
      await new Promise(r => setTimeout(r, 100));
    }
  }
  // Último batch
  if (batch.length > 1) {
    const resultados = await queryOSRMTable(batch);
    for (const r of resultados) {
      if (r.reachable) puntosAlcanzables.push(r);
    }
  }

  if (puntosAlcanzables.length < 3) {
    throw new Error('OSRM: muy pocos puntos alcanzables');
  }

  // 4. Convex hull de los puntos alcanzables
  const points = puntosAlcanzables.map(p => [p.lng, p.lat]);
  const hull = convexHull(points);
  
  // Cerrar el polígono
  hull.push(hull[0]);

  const areaKm2 = calcularAreaPoligonoKm2(hull).toFixed(2);
  const radioMaxKm = calcularRadioMaximoFromCoords(hull, lng, lat);

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
        puntos_routing: puntosAlcanzables.length
      },
      geometry: {
        type: 'Polygon',
        coordinates: [hull]
      }
    }]
  };

  return {
    geojson,
    areaKm2,
    radioMaxKm,
    timeMin: minutos,
    coords: hull,
    simulated: false
  };
}

// ═══════════════════════════════════════════════
// OSRM Table Query
// ═══════════════════════════════════════════════
async function queryOSRMTable(batch) {
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
    
    const durations = data.durations[0]; // desde el origen (índice 0)
    const resultados = [];
    
    for (let i = 1; i < batch.length; i++) {
      const duracion = durations[i];
      if (duracion !== null && duracion !== undefined) {
        resultados.push({
          lng: batch[i].lng,
          lat: batch[i].lat,
          angulo: batch[i].angulo,
          radioKm: batch[i].radioKm,
          duracion: duracion,
          reachable: true
        });
      }
    }
    return resultados;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ═══════════════════════════════════════════════
// Convex Hull (Andrew's monotone chain)
// ═══════════════════════════════════════════════
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 1) return pts;
  
  const cross = (O, A, B) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// ═══════════════════════════════════════════════
// Utilidades
// ═══════════════════════════════════════════════
function calcularRadiosParaTiempo(minutos) {
  // Para coche: ~30-50 km/h medio → radio en km ≈ minutos * 0.7
  const radioMaxEstimado = minutos * 0.8;
  return CONFIG.OSRM_RADII.filter(r => r <= radioMaxEstimado);
}

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

export function calcularAreaPoligonoKm2(coords) {
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
