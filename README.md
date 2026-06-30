# ISOTime 🗺️

Calculadora de isócronas de accesibilidad en España con datos reales de velocidad.

## Qué hace

ISOTime calcula **isócronas** — polígonos que muestran hasta dónde puedes llegar en un tiempo determinado desde cualquier punto de España. Usa datos reales de velocidad de [OpenRouteService](https://openrouteservice.org), que incluyen:

- Velocidades legales por tipo de vía
- Penalizaciones por semáforos
- Desnivel del terreno
- Condiciones de circulación reales

## Características

- 🚶 **Andando** — Isócronas peatonales con velocidades reales
- 🚗 **Coche** — Isócronas vehiculares con red viaria completa
- ⏱️ **5-90 minutos** — Rango configurable con presets rápidos
- 🗺️ **Mapa IGN** — Base cartográfica del Instituto Geográfico Nacional
- 📥 **Exportar** — GeoJSON y Shapefile (SHP) descargables
- 📱 **Responsive** — Funciona en móvil y escritorio

## Uso

1. Abre [ISOTime en GitHub Pages](https://ntizar.github.io/ISOTime/)
2. Configura tu API key gratuita de OpenRouteService (la app te guía)
3. Busca una dirección o haz click en el mapa
4. Selecciona modo (andando/coche) y tiempo (5-90 min)
5. Pulsa **CALCULAR ISOCRONA**
6. Exporta el resultado en GeoJSON o Shapefile

## API Key

Necesitas una API key gratuita de OpenRouteService:
1. Visita [openrouteservice.org/dev/#/signup](https://openrouteservice.org/dev/#/signup)
2. Crea una cuenta (gratis)
3. Copia tu API key
4. Introdúcela en ISOTime (se guarda localmente en tu navegador)

**Límites del tier gratuito:** 2,000 requests/día — más que suficiente para uso normal.

## Stack

- **Mapa:** Leaflet + Tiles IGN WMTS
- **Isocronas:** OpenRouteService API v2
- **Geocoding:** Nominatim (OpenStreetMap)
- **Export SHP:** Construcción binaria in-browser + JSZip
- **Framework:** Vanilla JS (ES Modules)

## Licencia

MIT — David Antizar

---

*Hecho con ❤️ por David Antizar*
