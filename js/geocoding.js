import { CONFIG } from './config.js';

let debounceTimer = null;

export function debounce(fn, delay) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, delay);
}

export async function buscarDireccion(query) {
  if (!query || query.trim().length < 3) return [];
  const url = `${CONFIG.NOMINATIM_BASE}/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=es&addressdetails=1`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': CONFIG.NOMINATIM_USER_AGENT }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.map(item => ({
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      displayName: item.display_name,
      type: item.type,
      importance: item.importance
    }));
  } catch (error) {
    console.error('Geocoding failed:', error.message);
    return [];
  }
}

export async function reverseGeocode(lat, lng) {
  const url = `${CONFIG.NOMINATIM_BASE}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': CONFIG.NOMINATIM_USER_AGENT }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return { displayName: data.display_name, address: data.address };
  } catch (error) {
    console.error('Reverse geocoding failed:', error.message);
    return null;
  }
}
