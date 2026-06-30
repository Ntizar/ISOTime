import { CONFIG } from './config.js';
import { initMap, getMap, setCenter, addPoint, renderIsochrones, clearLayers, fitBoundsToGeojson, getOrigin } from './map.js';
import { calcularIsocrona } from './isochrones.js';
import { buscarDireccion, debounce } from './geocoding.js';
import { exportGeoJSON, exportShapefile } from './export.js';

let currentMode = CONFIG.DEFAULT_MODE;
let currentTime = CONFIG.DEFAULT_TIME;
let currentGeoJSON = null;
let isLoading = false;

function init() {
  initMap();
  setupModeSelector();
  setupTimeSlider();
  setupPresets();
  setupSearch();
  setupCalculateButton();
  setupExportButtons();
  setupMapClick();
  setupSettingsButton();
  checkApiKey();
}

function checkApiKey() {
  const key = localStorage.getItem(CONFIG.STORAGE_KEY);
  if (!key) showApiKeyModal();
}

function showApiKeyModal() {
  const modal = document.getElementById('api-key-modal');
  if (modal) modal.style.display = 'flex';
}

function hideApiKeyModal() {
  const modal = document.getElementById('api-key-modal');
  if (modal) modal.style.display = 'none';
}

function setupModeSelector() {
  const buttons = document.querySelectorAll('.mode-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = btn.dataset.mode;
    });
  });
  const defaultBtn = document.querySelector(`.mode-btn[data-mode="${CONFIG.DEFAULT_MODE}"]`);
  if (defaultBtn) defaultBtn.classList.add('active');
}

function setupTimeSlider() {
  const slider = document.getElementById('time-slider');
  const display = document.getElementById('time-display');
  if (slider && display) {
    slider.addEventListener('input', (e) => {
      currentTime = parseInt(e.target.value);
      display.textContent = `${currentTime} minutos`;
      updatePresetButtons();
    });
    slider.value = CONFIG.DEFAULT_TIME;
    display.textContent = `${CONFIG.DEFAULT_TIME} minutos`;
  }
}

function setupPresets() {
  const presets = document.querySelectorAll('.preset-btn');
  presets.forEach(btn => {
    btn.addEventListener('click', () => {
      const value = parseInt(btn.dataset.time);
      currentTime = value;
      const slider = document.getElementById('time-slider');
      const display = document.getElementById('time-display');
      if (slider) slider.value = value;
      if (display) display.textContent = `${value} minutos`;
      updatePresetButtons();
    });
  });
  updatePresetButtons();
}

function updatePresetButtons() {
  const presets = document.querySelectorAll('.preset-btn');
  presets.forEach(btn => {
    const value = parseInt(btn.dataset.time);
    btn.classList.toggle('active', value === currentTime);
  });
}

function setupSearch() {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  if (!input) return;
  input.addEventListener('input', () => {
    debounce(async () => {
      const query = input.value.trim();
      if (query.length < 3) {
        results.innerHTML = '';
        results.style.display = 'none';
        return;
      }
      const matches = await buscarDireccion(query);
      if (matches.length > 0) {
        results.innerHTML = matches.map((m, i) => `
          <div class="search-result-item" data-index="${i}">
            <span class="result-icon">📍</span>
            <span class="result-text">${m.displayName}</span>
          </div>
        `).join('');
        results.style.display = 'block';
        results.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            const idx = parseInt(item.dataset.index);
            const match = matches[idx];
            setCenter(match.lat, match.lng, 14);
            addPoint(match.lat, match.lng);
            results.style.display = 'none';
            input.value = match.displayName;
          });
        });
      } else {
        results.innerHTML = '<div class="no-results">Sin resultados</div>';
        results.style.display = 'block';
      }
    }, 800);
  });
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) {
      results.style.display = 'none';
    }
  });
}

function setupCalculateButton() {
  const btn = document.getElementById('calculate-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (isLoading) return;
    const origin = getOrigin();
    if (!origin) {
      alert('Por favor, selecciona un punto en el mapa o busca una dirección.');
      return;
    }
    setLoading(true);
    try {
      const result = await calcularIsocrona(origin.lng, origin.lat, currentMode, currentTime);
      currentGeoJSON = result.geojson;
      clearLayers();
      addPoint(origin.lat, origin.lng);
      renderIsochrones(result.geojson.features, currentMode);
      fitBoundsToGeojson(result.geojson);
      updateResultDisplay(result);
    } catch (error) {
      console.error('Error calculating isochrone:', error);
      alert('Error al calcular la isócrona. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  });
}

function setLoading(loading) {
  isLoading = loading;
  const btn = document.getElementById('calculate-btn');
  if (btn) {
    btn.disabled = loading;
    btn.querySelector('.btn-text').style.display = loading ? 'none' : 'inline';
    btn.querySelector('.btn-loading').style.display = loading ? 'flex' : 'none';
  }
}

function updateResultDisplay(result) {
  const areaEl = document.getElementById('result-area');
  const radioEl = document.getElementById('result-radio');
  const timeEl = document.getElementById('result-time');
  const modeEl = document.getElementById('result-mode');
  const exportSection = document.getElementById('export-section');
  if (areaEl) areaEl.textContent = `${result.areaKm2} km²`;
  if (radioEl) radioEl.textContent = `${result.radioMaxKm} km`;
  if (timeEl) timeEl.textContent = `${currentTime} minutos`;
  if (modeEl) modeEl.textContent = CONFIG.MODES[currentMode];
  if (exportSection) exportSection.style.display = 'block';
  const warning = document.getElementById('simulation-warning');
  if (warning) {
    if (result.simulated) {
      warning.style.display = 'flex';
      warning.querySelector('.warning-text').textContent = '⚠️ Modo simulación — Configure API key de ORS o use modo coche para datos reales OSRM';
    } else if (result.geojson?.features?.[0]?.properties?.source === 'osrm') {
      warning.style.display = 'flex';
      warning.querySelector('.warning-text').textContent = '🛣️ Datos reales OSRM (routing público) — Para más precisión, configure API key de ORS';
      warning.style.background = '#eff6ff';
      warning.style.borderColor = '#93c5fd';
      warning.style.color = '#1e40af';
    } else {
      warning.style.display = 'none';
    }
  }
}

function setupExportButtons() {
  const geojsonBtn = document.getElementById('export-geojson');
  const shpBtn = document.getElementById('export-shp');
  if (geojsonBtn) {
    geojsonBtn.addEventListener('click', () => {
      if (currentGeoJSON) exportGeoJSON(currentGeoJSON, currentMode, currentTime);
    });
  }
  if (shpBtn) {
    shpBtn.addEventListener('click', async () => {
      if (currentGeoJSON) await exportShapefile(currentGeoJSON, currentMode, currentTime);
    });
  }
}

function setupMapClick() {
  const map = getMap();
  if (!map) return;
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    clearLayers();
    addPoint(lat, lng);
  });
}

function setupSettingsButton() {
  const btn = document.getElementById('settings-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      showApiKeyModal();
      const keyInput = document.getElementById('api-key-input');
      if (keyInput) keyInput.value = localStorage.getItem(CONFIG.STORAGE_KEY) || '';
    });
  }
  const saveBtn = document.getElementById('save-api-key');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const keyInput = document.getElementById('api-key-input');
      if (keyInput && keyInput.value.trim()) {
        localStorage.setItem(CONFIG.STORAGE_KEY, keyInput.value.trim());
        hideApiKeyModal();
      }
    });
  }
  const closeBtn = document.getElementById('close-modal');
  if (closeBtn) closeBtn.addEventListener('click', hideApiKeyModal);
  const cancelBtn = document.getElementById('cancel-modal');
  if (cancelBtn) cancelBtn.addEventListener('click', hideApiKeyModal);
  const modal = document.getElementById('api-key-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideApiKeyModal();
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
