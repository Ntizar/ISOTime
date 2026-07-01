/**
 * Dijkstra Worker — ISOTime Motor Local
 * ======================================
 * Web Worker que mantiene el grafo viario en memoria y calcula
 * isocronas con Dijkstra + binary heap, sin depender de ninguna API externa.
 *
 * Mensajes entrantes:
 *   { cmd: 'load', city: 'madrid' }              → carga grafo binario
 *   { cmd: 'isochrone', lat, lng, cutoffSec, modeSpeed }  → calcular isocrona
 *   { cmd: 'status' }                            → info del grafo cargado
 *
 * Mensajes salientes:
 *   { cmd: 'loaded', city, numNodes, numEdges }
 *   { cmd: 'result', polygonCoords, areaKm2, radioMaxKm, nodeCount, source }
 *   { cmd: 'error', message }
 *   { cmd: 'status', city, numNodes, numEdges }
 */

// ═══════════════════════════════════════════════
// MinHeap — Binary heap para Dijkstra
// ═══════════════════════════════════════════════
class MinHeap {
  constructor() {
    this.nodes = [];
    this.dists = [];
  }

  get size() { return this.nodes.length; }

  push(node, dist) {
    this.nodes.push(node);
    this.dists.push(dist);
    this._bubbleUp(this.nodes.length - 1);
  }

  pop() {
    if (this.nodes.length === 0) return null;
    const node = this.nodes[0];
    const dist = this.dists[0];
    const lastIdx = this.nodes.length - 1;
    this.nodes[0] = this.nodes[lastIdx];
    this.dists[0] = this.dists[lastIdx];
    this.nodes.pop();
    this.dists.pop();
    if (this.nodes.length > 0) this._bubbleDown(0);
    return { node, dist };
  }

  _bubbleUp(idx) {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.dists[idx] < this.dists[parent]) {
        this._swap(idx, parent);
        idx = parent;
      } else break;
    }
  }

  _bubbleDown(idx) {
    const n = this.nodes.length;
    while (true) {
      let min = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < n && this.dists[left] < this.dists[min]) min = left;
      if (right < n && this.dists[right] < this.dists[min]) min = right;
      if (min !== idx) {
        this._swap(idx, min);
        idx = min;
      } else break;
    }
  }

  _swap(i, j) {
    const tn = this.nodes[i];
    this.nodes[i] = this.nodes[j];
    this.nodes[j] = tn;
    const td = this.dists[i];
    this.dists[i] = this.dists[j];
    this.dists[j] = td;
  }
}

// ═══════════════════════════════════════════════
// Estado del grafo
// ═══════════════════════════════════════════════
let graph = null; // { numNodes, numEdges, nodeCoords, nodeOffsets, edgeTargets, edgeLengths, edgeSpeeds, city, centerLat, centerLng, radiusKm }

// ═══════════════════════════════════════════════
// Parsear grafo binario CSR
// ═══════════════════════════════════════════════
function parseGraph(buffer) {
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== 'ISOG') throw new Error('Formato de grafo inválido (magic mismatch)');
  offset = 4;

  const version = view.getUint32(offset, true); offset += 4;
  const numNodes = view.getUint32(offset, true); offset += 4;
  const numEdges = view.getUint32(offset, true); offset += 4;
  const centerLat = view.getFloat32(offset, true); offset += 4;
  const centerLng = view.getFloat32(offset, true); offset += 4;
  const radiusKm = view.getFloat32(offset, true); offset += 4;
  offset += 4; // reserved

  // City name (32 bytes)
  const nameBytes = new Uint8Array(buffer, offset, 32);
  let city = '';
  for (let i = 0; i < 32 && nameBytes[i] !== 0; i++) city += String.fromCharCode(nameBytes[i]);
  offset += 32;

  // Nodes: lat(f32) × N + lng(f32) × N → interleave to [lat0,lng0, lat1,lng1, ...]
  const rawLats = new Float32Array(buffer, offset, numNodes);
  offset += numNodes * 4;
  const rawLngs = new Float32Array(buffer, offset, numNodes);
  offset += numNodes * 4;
  const nodeCoords = new Float32Array(numNodes * 2);
  for (let i = 0; i < numNodes; i++) {
    nodeCoords[i * 2] = rawLats[i];
    nodeCoords[i * 2 + 1] = rawLngs[i];
  }

  // CSR offsets: u32 × (N+1)
  const nodeOffsets = new Uint32Array(buffer, offset, numNodes + 1);
  offset += (numNodes + 1) * 4;

  // Edge targets: u32 × E
  const edgeTargets = new Uint32Array(buffer, offset, numEdges);
  offset += numEdges * 4;

  // Edge lengths: f32 × E (metros)
  const edgeLengths = new Float32Array(buffer, offset, numEdges);
  offset += numEdges * 4;

  // Edge speeds: f32 × E (km/h)
  const edgeSpeeds = new Float32Array(buffer, offset, numEdges);
  offset += numEdges * 4;

  return { numNodes, numEdges, nodeCoords, nodeOffsets, edgeTargets, edgeLengths, edgeSpeeds, city, centerLat, centerLng, radiusKm, version };
}

// ═══════════════════════════════════════════════
// Encontrar nodo más cercano (brute force — O(n))
// ═══════════════════════════════════════════════
function findNearestNode(lat, lng) {
  if (!graph) throw new Error('Grafo no cargado');
  let minDist = Infinity;
  let nearestIdx = 0;
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i < graph.numNodes; i++) {
    const nLat = graph.nodeCoords[i * 2];
    const nLng = graph.nodeCoords[i * 2 + 1];
    const dLat = (nLat - lat) * 111320;
    const dLng = (nLng - lng) * 111320 * cosLat;
    const dist = dLat * dLat + dLng * dLng;
    if (dist < minDist) {
      minDist = dist;
      nearestIdx = i;
    }
  }
  return nearestIdx;
}

// ═══════════════════════════════════════════════
// Dijkstra con binary heap
// ═══════════════════════════════════════════════
function dijkstra(originNode, cutoffSec, modeSpeed) {
  const n = graph.numNodes;
  const dist = new Float32Array(n);
  dist.fill(Infinity);
  dist[originNode] = 0;

  const visited = new Uint8Array(n);
  const heap = new MinHeap();
  heap.push(originNode, 0);

  // Límite de distancia física: cutoffSec * speed / 3.6 → metros
  const speedMs = modeSpeed > 0 ? modeSpeed / 3.6 : Math.abs(modeSpeed) / 3.6;
  const maxPhysicalDist = cutoffSec * speedMs * 1.3; // 30% margen para rutas no rectas

  const reachable = [];
  const originLat = graph.nodeCoords[originNode * 2];
  const originLng = graph.nodeCoords[originNode * 2 + 1];
  const cosLat = Math.cos(originLat * Math.PI / 180);

  while (heap.size > 0) {
    const { node, dist: d } = heap.pop();
    if (visited[node]) continue;
    visited[node] = 1;

    if (d > cutoffSec) break;

    // Filtro de distancia física: si está demasiado lejos, saltar
    const lat = graph.nodeCoords[node * 2];
    const lng = graph.nodeCoords[node * 2 + 1];
    const dLat = (lat - originLat) * 111320;
    const dLng = (lng - originLng) * 111320 * cosLat;
    const physicalDist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (physicalDist > maxPhysicalDist) continue;

    reachable.push(node);

    // Iterar aristas salientes (CSR)
    const start = graph.nodeOffsets[node];
    const end = graph.nodeOffsets[node + 1];

    for (let i = start; i < end; i++) {
      const target = graph.edgeTargets[i];
      if (visited[target]) continue;

      const length = graph.edgeLengths[i]; // metros
      const edgeSpeed = graph.edgeSpeeds[i] || 50; // km/h

      // modeSpeed > 0: usar min(velocidad vía, velocidad modo) — para coche
      // modeSpeed < 0: velocidad fija (andando = 5 km/h)
      const speed = modeSpeed > 0
        ? Math.min(edgeSpeed, modeSpeed)
        : Math.abs(modeSpeed); // velocidad fija para andando/bici

      const time = length / (speed / 3.6); // segundos
      const newDist = d + time;

      if (newDist < dist[target]) {
        dist[target] = newDist;
        heap.push(target, newDist);
      }
    }
  }

  return reachable;
}

// ═══════════════════════════════════════════════
// Boundary detection por grid — polígonos orgánicos
// ═══════════════════════════════════════════════
function boundaryDetection(reachableNodes, centerLat, centerLng, _numDirs) {
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const GRID_SIZE = 50; // 50x50 celdas

  // 1. Recoger coordenadas y calcular bounding box
  const lats = new Float32Array(reachableNodes.length);
  const lngs = new Float32Array(reachableNodes.length);
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;

  for (let i = 0; i < reachableNodes.length; i++) {
    const lat = graph.nodeCoords[reachableNodes[i] * 2];
    const lng = graph.nodeCoords[reachableNodes[i] * 2 + 1];
    lats[i] = lat;
    lngs[i] = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }

  // Añadir margen (10%)
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  minLat -= latRange * 0.1;
  maxLat += latRange * 0.1;
  minLng -= lngRange * 0.1;
  maxLng += lngRange * 0.1;

  const cellLat = (maxLat - minLat) / GRID_SIZE;
  const cellLng = (maxLng - minLng) / GRID_SIZE;

  // 2. Marcar celdas ocupadas
  const grid = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (let i = 0; i < reachableNodes.length; i++) {
    const row = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((lats[i] - minLat) / cellLat)));
    const col = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((lngs[i] - minLng) / cellLng)));
    grid[row * GRID_SIZE + col] = 1;
  }

  // 3. Encontrar celdas frontera (ocupadas con al menos 1 vecina vacía)
  const dirs4 = [[0,1],[0,-1],[1,0],[-1,0]];
  const boundaryCells = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!grid[r * GRID_SIZE + c]) continue;
      let isBoundary = false;
      for (const [dr, dc] of dirs4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE || !grid[nr * GRID_SIZE + nc]) {
          isBoundary = true;
          break;
        }
      }
      if (isBoundary) boundaryCells.push({ r, c });
    }
  }

  if (boundaryCells.length < 3) return null;

  // 4. Ordenar celdas frontera en ciclo (boundary tracing)
  // Algoritmo: ordenar por ángulo desde centro del grid → polígono convexo suave
  const centerR = GRID_SIZE / 2;
  const centerC = GRID_SIZE / 2;
  boundaryCells.sort((a, b) => {
    const angA = Math.atan2(a.r - centerR, a.c - centerC);
    const angB = Math.atan2(b.r - centerR, b.c - centerC);
    return angA - angB;
  });

  // 5. Convertir celdas a coordenadas geográficas (centro de celda)
  const coords = boundaryCells.map(cell => {
    const lat = minLat + (cell.r + 0.5) * cellLat;
    const lng = minLng + (cell.c + 0.5) * cellLng;
    return [lng, lat];
  });

  // 6. Suavizar: eliminar puntos muy cercanos (< 10m)
  const smoothed = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const prev = smoothed[smoothed.length - 1];
    const dLat = (coords[i][1] - prev[1]) * 111320;
    const dLng = (coords[i][0] - prev[0]) * 111320 * cosLat;
    if (Math.sqrt(dLat * dLat + dLng * dLng) > 10) {
      smoothed.push(coords[i]);
    }
  }

  // Cerrar polígono
  smoothed.push(smoothed[0]);
  return smoothed;
}

// ═══════════════════════════════════════════════
// Calcular área del polígono (km²)
// ═══════════════════════════════════════════════
function calcularAreaKm2(coords, refLat) {
  let area = 0;
  const n = coords.length - 1; // último = primero
  const avgLat = refLat || coords.reduce((s, c) => s + c[1], 0) / n;
  const cosLat = Math.cos(avgLat * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2) * 111.32 * 111.32 * cosLat;
}

// ═══════════════════════════════════════════════
// Radio máximo desde el centro
// ═══════════════════════════════════════════════
function calcularRadioMaxKm(coords, centerLat, centerLng) {
  let maxDist = 0;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  for (const [lng, lat] of coords) {
    const dLat = (lat - centerLat) * 111320;
    const dLng = (lng - centerLng) * 111320 * cosLat;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist > maxDist) maxDist = dist;
  }
  return maxDist / 1000;
}

// ═══════════════════════════════════════════════
// Handler principal
// ═══════════════════════════════════════════════
self.onmessage = async function(e) {
  const { cmd } = e.data;

  if (cmd === 'load') {
    try {
      const { city } = e.data;
      // Resolve graph path relative to page root
      // Worker self.location.href gives us the worker script URL
      const baseUrl = self.location.href.replace(/js\/[^/]*$/, '');
      const url = `${baseUrl}data/graphs/${city}.bin`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Grafo no encontrado: ${city} (HTTP ${response.status})`);
      const buffer = await response.arrayBuffer();
      graph = parseGraph(buffer);
      self.postMessage({
        cmd: 'loaded',
        city: graph.city,
        numNodes: graph.numNodes,
        numEdges: graph.numEdges,
        centerLat: graph.centerLat,
        centerLng: graph.centerLng,
        radiusKm: graph.radiusKm
      });
    } catch (err) {
      self.postMessage({ cmd: 'error', message: `Error cargando grafo: ${err.message}` });
    }
    return;
  }

  if (cmd === 'isochrone') {
    try {
      if (!graph) throw new Error('Grafo no cargado');

      const { lat, lng, cutoffSec, modeSpeed } = e.data;

      // 1. Encontrar nodo más cercano al punto del usuario
      const originNode = findNearestNode(lat, lng);

      // 2. Dijkstra
      const reachable = dijkstra(originNode, cutoffSec, modeSpeed);

      if (reachable.length < 3) {
        throw new Error('Muy pocos nodos alcanzables');
      }

      // 3. Boundary detection → polígono
      const polygonCoords = boundaryDetection(reachable, lat, lng, 72);

      if (!polygonCoords || polygonCoords.length < 4) {
        throw new Error('No se pudo generar el polígono de isocrona');
      }

      // 4. Métricas
      const areaKm2 = calcularAreaKm2(polygonCoords, lat);
      const radioMaxKm = calcularRadioMaxKm(polygonCoords, lat, lng);

      // Transferir coords como ArrayBuffer (zero-copy)
      const flatCoords = new Float64Array(polygonCoords.length * 2);
      for (let i = 0; i < polygonCoords.length; i++) {
        flatCoords[i * 2] = polygonCoords[i][0];     // lng
        flatCoords[i * 2 + 1] = polygonCoords[i][1]; // lat
      }

      self.postMessage({
        cmd: 'result',
        flatCoords: flatCoords.buffer,
        numPoints: polygonCoords.length,
        areaKm2: parseFloat(areaKm2.toFixed(2)),
        radioMaxKm: parseFloat(radioMaxKm.toFixed(2)),
        nodeCount: reachable.length,
        source: 'dijkstra-local'
      }, [flatCoords.buffer]);

    } catch (err) {
      self.postMessage({ cmd: 'error', message: err.message });
    }
    return;
  }

  if (cmd === 'status') {
    if (graph) {
      self.postMessage({
        cmd: 'status',
        city: graph.city,
        numNodes: graph.numNodes,
        numEdges: graph.numEdges
      });
    } else {
      self.postMessage({ cmd: 'status', city: null, numNodes: 0, numEdges: 0 });
    }
    return;
  }
};
