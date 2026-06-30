import { CONFIG } from './config.js';

export function exportGeoJSON(geojson, modo, tiempo) {
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `isotime_${modo}_${tiempo}min.geojson`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportShapefile(geojson, modo, tiempo) {
  if (typeof JSZip === 'undefined') {
    alert('Error: JSZip no está cargado. Recarga la página.');
    return;
  }
  const zip = new JSZip();
  const coords = geojson.features[0].geometry.coordinates[0];
  const props = geojson.features[0].properties;
  const shpBytes = generateSHP(coords);
  const shxBytes = generateSHX(coords);
  const dbfBytes = generateDBF(props, modo, tiempo);
  const prjContent = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  const filename = `isotime_${modo}_${tiempo}min`;
  zip.file(`${filename}.shp`, shpBytes);
  zip.file(`${filename}.shx`, shxBytes);
  zip.file(`${filename}.dbf`, dbfBytes);
  zip.file(`${filename}.prj`, prjContent);
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateSHP(coords) {
  const shapeType = 5;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  coords.forEach(([lng, lat]) => {
    minX = Math.min(minX, lng); minY = Math.min(minY, lat);
    maxX = Math.max(maxX, lng); maxY = Math.max(maxY, lat);
  });
  const numParts = 1;
  const numPoints = coords.length;
  const contentLength = 44 + numPoints * 16;
  const fileLength = 50 + contentLength / 2;
  const buffer = new ArrayBuffer(50 + contentLength);
  const view = new DataView(buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, fileLength, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, shapeType, true);
  view.setFloat64(36, minX, true);
  view.setFloat64(44, minY, true);
  view.setFloat64(52, maxX, true);
  view.setFloat64(60, maxY, true);
  view.setFloat64(68, 0, true);
  view.setFloat64(76, 0, true);
  view.setFloat64(84, 0, true);
  view.setFloat64(92, 0, true);
  let offset = 100;
  view.setInt32(offset, 1, false); offset += 4;
  view.setInt32(offset, contentLength / 2, false); offset += 4;
  view.setInt32(offset, shapeType, true); offset += 4;
  view.setFloat64(offset, minX, true); offset += 8;
  view.setFloat64(offset, minY, true); offset += 8;
  view.setFloat64(offset, maxX, true); offset += 8;
  view.setFloat64(offset, maxY, true); offset += 8;
  view.setInt32(offset, numParts, true); offset += 4;
  view.setInt32(offset, numPoints, true); offset += 4;
  view.setInt32(offset, 0, true); offset += 4;
  coords.forEach(([lng, lat]) => {
    view.setFloat64(offset, lng, true); offset += 8;
    view.setFloat64(offset, lat, true); offset += 8;
  });
  return new Uint8Array(buffer);
}

function generateSHX(coords) {
  const numPoints = coords.length;
  const contentLength = 44 + numPoints * 16;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  coords.forEach(([lng, lat]) => {
    minX = Math.min(minX, lng); minY = Math.min(minY, lat);
    maxX = Math.max(maxX, lng); maxY = Math.max(maxY, lat);
  });
  const buffer = new ArrayBuffer(100 + 8);
  const view = new DataView(buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, 54, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);
  view.setFloat64(36, minX, true);
  view.setFloat64(44, minY, true);
  view.setFloat64(52, maxX, true);
  view.setFloat64(60, maxY, true);
  view.setFloat64(68, 0, true);
  view.setFloat64(76, 0, true);
  view.setFloat64(84, 0, true);
  view.setFloat64(92, 0, true);
  view.setInt32(100, 50, false);
  view.setInt32(104, contentLength / 2, false);
  return new Uint8Array(buffer);
}

function generateDBF(props, modo, tiempo) {
  const modeLabel = CONFIG.MODES[modo] || modo;
  const areaKm2 = props.area_km2 || 0;
  const numRecords = 1;
  const numFields = 3;
  const fieldDescriptorsLength = numFields * 32 + 1;
  const recordLength = 31;
  const numHeaderBytes = 32 + fieldDescriptorsLength + 1;
  const fileSize = numHeaderBytes + recordLength * numRecords;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  bytes[offset] = 0x03; offset += 1;
  bytes[offset] = 24; bytes[offset + 1] = 6; bytes[offset + 2] = 30; offset += 3;
  view.setInt32(offset, numRecords, true); offset += 4;
  view.setInt16(offset, numHeaderBytes, true); offset += 2;
  view.setInt16(offset, recordLength, true); offset += 2;
  offset += 20;
  writeFieldDescriptor(bytes, offset, 'MODOTXT', 'C', 10, 0); offset += 32;
  writeFieldDescriptor(bytes, offset, 'TIEMPO_N', 'N', 10, 0); offset += 32;
  writeFieldDescriptor(bytes, offset, 'AREA_KM2', 'N', 10, 2); offset += 32;
  bytes[offset] = 0x0D; offset += 1;
  bytes[offset] = 0x20; offset += 1;
  const modeStr = modeLabel.padEnd(10, ' ').substring(0, 10);
  for (let i = 0; i < 10; i++) bytes[offset + i] = modeStr.charCodeAt(i);
  offset += 10;
  const tiempoStr = String(tiempo).padStart(10, ' ').substring(0, 10);
  for (let i = 0; i < 10; i++) bytes[offset + i] = tiempoStr.charCodeAt(i);
  offset += 10;
  const areaStr = Number(areaKm2).toFixed(2).padStart(10, ' ').substring(0, 10);
  for (let i = 0; i < 10; i++) bytes[offset + i] = areaStr.charCodeAt(i);
  offset += 10;
  return new Uint8Array(buffer);
}

function writeFieldDescriptor(bytes, offset, name, type, length, decimals) {
  for (let i = 0; i < 11; i++) bytes[offset + i] = i < name.length ? name.charCodeAt(i) : 0;
  bytes[offset + 11] = type.charCodeAt(0);
  bytes[offset + 16] = length;
  bytes[offset + 17] = decimals;
}
