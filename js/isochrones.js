import { CONFIG } from './config.js';
import { calcularIsocronaSim } from './map.js';

export async function calcularIsocrona(lng, lat, modo, minutos) {
  const apiKey = localStorage.getItem(CONFIG.STORAGE_KEY);
  const profile = CONFIG.PROFILES[modo];
  if (!apiKey) {
    console.warn('No API key, using simulation');
    return calcularIsocronaSim(lng, lat, modo, minutos);
  }
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
      console.error('ORS error:', response.status, errText);
      return calcularIsocronaSim(lng, lat, modo, minutos);
    }
    const data = await response.json();
    return parseOrsResponse(data, lng, lat, modo, minutos);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('ORS fetch failed:', error.message);
    return calcularIsocronaSim(lng, lat, modo, minutos);
  }
}

function parseOrsResponse(data, lng, lat, modo, minutos) {
  if (!data.features || data.features.length === 0) {
    return calcularIsocronaSim(lng, lat, modo, minutos);
  }
  const feature = data.features[0];
  const areaM2 = feature.properties.area || 0;
  const areaKm2 = (areaM2 / 1e6).toFixed(2);
  const radioMaxKm = calcularRadioMaximo(data, lng, lat);
  const enrichedFeature = {
    ...feature,
    properties: {
      ...feature.properties,
      mode: modo,
      time_min: minutos,
      area_km2: parseFloat(areaKm2),
      centro_lat: lat,
      centro_lng: lng,
      simulated: false
    }
  };
  return {
    geojson: { type: 'FeatureCollection', features: [enrichedFeature] },
    areaKm2,
    radioMaxKm,
    coords: feature.geometry.coordinates[0],
    simulated: false
  };
}

function calcularRadioMaximo(data, centerLng, centerLat) {
  let maxDist = 0;
  data.features.forEach(feature => {
    const coords = feature.geometry.coordinates[0];
    coords.forEach(([clng, clat]) => {
      const dLat = (clat - centerLat) * 111320;
      const dLng = (clng - centerLng) * 111320 * Math.cos(centerLat * Math.PI / 180);
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      if (dist > maxDist) maxDist = dist;
    });
  });
  return (maxDist / 1000).toFixed(2);
}
