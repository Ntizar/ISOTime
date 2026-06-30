import { CONFIG } from './config.js';

let map = null;
let isoLayer = null;
let pointLayer = null;
let originMarker = null;

export function initMap() {
  map = L.map('map', {
    center: [40.4168, -3.7038],
    zoom: 12,
    zoomControl: false
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer(CONFIG.TILES_URL, {
    attribution: CONFIG.TILES_ATTRIBUTION,
    maxZoom: 19,
    tileSize: 256
  }).addTo(map);
  isoLayer = L.layerGroup().addTo(map);
  pointLayer = L.layerGroup().addTo(map);
  return map;
}

export function getMap() { return map; }

export function setCenter(lat, lng, zoom) {
  if (map) map.setView([lat, lng], zoom || 13);
}

export function addPoint(lat, lng) {
  pointLayer.clearLayers();
  originMarker = L.circleMarker([lat, lng], {
    radius: 8,
    color: '#dc2626',
    fillColor: '#ef4444',
    fillOpacity: 0.9,
    weight: 2
  }).addTo(pointLayer);
  originMarker.bindPopup(`<strong>Origen</strong><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  originMarker.openPopup();
  return { lat, lng };
}

export function getOrigin() {
  if (originMarker) {
    const ll = originMarker.getLatLng();
    return { lat: ll.lat, lng: ll.lng };
  }
  return null;
}

export function renderIsochrones(features, mode) {
  isoLayer.clearLayers();
  if (!features || features.length === 0) return;
  const color = CONFIG.COLORS[mode] || CONFIG.COLORS.car;
  features.forEach((feature, idx) => {
    const coords = feature.geometry.coordinates;
    const latlngs = coords[0].map(c => [c[1], c[0]]);
    const polygon = L.polygon(latlngs, {
      color: color,
      fillColor: color,
      fillOpacity: 0.3,
      weight: 2,
      opacity: 0.7
    }).addTo(isoLayer);
    const props = feature.properties || {};
    const areaKm2 = props.area_km2 || (props.area ? (props.area / 1e6).toFixed(2) : '?');
    const timeMin = props.time_min || (props.value ? Math.round(props.value / 60) : '?');
    const modeLabel = CONFIG.MODES[mode] || mode;
    const source = props.source ? ` [${props.source.toUpperCase()}]` : '';

    polygon.bindPopup(
      `<strong>Isocrona${source}</strong><br>Modo: ${modeLabel}<br>Tiempo: ${timeMin} min<br>Área: ${areaKm2} km²`
    );
  });
}

export function clearLayers() {
  if (isoLayer) isoLayer.clearLayers();
  if (pointLayer) pointLayer.clearLayers();
  originMarker = null;
}

export function fitBoundsToGeojson(geojson) {
  if (!map || !geojson) return;
  const tempLayer = L.geoJSON(geojson);
  const bounds = tempLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
}

export function calcularIsocronaSim(lng, lat, modo, minutos) {
  const speedKmh = CONFIG.SPEEDS[modo] || 50;
  const radioM = (speedKmh / 3.6) * minutos * 60;
  const PTS = 48;
  const coords = [];
  for (let i = 0; i <= PTS; i++) {
    const ang = (i / PTS) * 2 * Math.PI;
    const jitter = 1 - (0.15 * (Math.sin(i * 7.3) * 0.5 + 0.5));
    const r = radioM * jitter;
    const dLat = (r * Math.cos(ang)) / 111320;
    const dLng = (r * Math.sin(ang)) / (111320 * Math.cos(lat * Math.PI / 180));
    coords.push([lng + dLng, lat + dLat]);
  }
  const areaKm2 = calcularAreaPoligonoKm2(coords).toFixed(2);
  const radioMaxKm = calcularRadioMaximoSim(coords, lng, lat);
  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        mode: modo,
        time_min: minutos,
        area_km2: parseFloat(calcularAreaPoligonoKm2(coords).toFixed(2)),
        centro_lat: lat,
        centro_lng: lng,
        simulated: true,
        value: minutos * 60,
        area: areaKm2 * 1e6
      },
      geometry: { type: 'Polygon', coordinates: [coords] }
    }]
  };
  return { geojson, areaKm2, radioMaxKm, coords, simulated: true };
}

function calcularAreaPoligonoKm2(coords) {
  let area = 0;
  const n = coords.length - 1;
  const avgLat = coords.reduce((s, c) => s + c[1], 0) / n;
  const cosLat = Math.cos(avgLat * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2) * 111.32 * 111.32 * cosLat;
}

function calcularRadioMaximoSim(coords, centerLng, centerLat) {
  let maxDist = 0;
  coords.forEach(([clng, clat]) => {
    const dLat = (clat - centerLat) * 111320;
    const dLng = (clng - centerLng) * 111320 * Math.cos(centerLat * Math.PI / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist > maxDist) maxDist = dist;
  });
  return (maxDist / 1000).toFixed(2);
}
