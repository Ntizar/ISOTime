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
  try {
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
  } catch (err) {
    console.error('SHP export error:', err);
    alert('Error al generar Shapefile: ' + err.message);
  }
}

function generateSHP(coords) {
  // SHP Polygon (shape type 5)
  // File: header(100) + record_header(8) + record_content(variable)
  // Record content: shapeType(4) + bbox(32) + numParts(4) + numPoints(4) + parts(4) + points(N*16)
  const shapeType = 5;
  const numParts = 1;
  const numPoints = coords.length;

  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  coords.forEach(([lng, lat]) => {
    minX = Math.min(minX, lng); minY = Math.min(minY, lat);
    maxX = Math.max(maxX, lng); maxY = Math.max(maxY, lat);
  });

  // Record content size in bytes
  const recordContentBytes = 4 + 32 + 4 + 4 + 4 + (numPoints * 16); // 48 + N*16
  // Content length in 16-bit words (SHP spec)
  const contentLength16 = recordContentBytes / 2;
  // File length in 16-bit words: header(50) + record_header(4) + content
  const fileLength16 = 50 + 4 + contentLength16;
  // Actual buffer size in bytes
  const bufferBytes = 100 + 8 + recordContentBytes;

  const buffer = new ArrayBuffer(bufferBytes);
  const v = new DataView(buffer);

  // === FILE HEADER (100 bytes) ===
  v.setInt32(0, 9994, false);           // File code (big-endian)
  // bytes 4-20: unused (5 × int32 = 20 bytes, already 0)
  v.setInt32(24, fileLength16, false);  // File length in 16-bit words (big-endian)
  v.setInt32(28, 1000, true);           // Version (little-endian)
  v.setInt32(32, shapeType, true);      // Shape type
  v.setFloat64(36, minX, true);         // Bounding box
  v.setFloat64(44, minY, true);
  v.setFloat64(52, maxX, true);
  v.setFloat64(60, maxY, true);
  // 4 unused doubles (68-99) = already 0

  // === RECORD HEADER (8 bytes) ===
  let off = 100;
  v.setInt32(off, 1, false); off += 4;                  // Record number (big-endian)
  v.setInt32(off, contentLength16, false); off += 4;     // Content length in 16-bit words (big-endian)

  // === RECORD CONTENT ===
  v.setInt32(off, shapeType, true); off += 4;            // Shape type
  v.setFloat64(off, minX, true); off += 8;               // Bounding box
  v.setFloat64(off, minY, true); off += 8;
  v.setFloat64(off, maxX, true); off += 8;
  v.setFloat64(off, maxY, true); off += 8;
  v.setInt32(off, numParts, true); off += 4;             // NumParts
  v.setInt32(off, numPoints, true); off += 4;            // NumPoints
  v.setInt32(off, 0, true); off += 4;                    // Parts[0] = 0

  // Points (lng, lat as Float64 LE)
  coords.forEach(([lng, lat]) => {
    v.setFloat64(off, lng, true); off += 8;
    v.setFloat64(off, lat, true); off += 8;
  });

  return new Uint8Array(buffer);
}

function generateSHX(coords) {
  // SHX is the spatial index for SHP
  // Header (100 bytes) + records (8 bytes each = offset + content_length)
  const shapeType = 5;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  coords.forEach(([lng, lat]) => {
    minX = Math.min(minX, lng); minY = Math.min(minY, lat);
    maxX = Math.max(maxX, lng); maxY = Math.max(maxY, lat);
  });

  const numPoints = coords.length;
  const recordContentBytes = 48 + numPoints * 16;
  const contentLength16 = recordContentBytes / 2;
  const fileLength16 = 50 + 4 + contentLength16;

  // SHX record: offset (4 bytes) + content_length (4 bytes) — both big-endian
  const shxRecordOffset = 50; // in 16-bit words from file start
  const buffer = new ArrayBuffer(100 + 8);
  const v = new DataView(buffer);

  // Header
  v.setInt32(0, 9994, false);
  v.setInt32(24, 54, false);           // File length: 100 + 8 = 108 bytes = 54 words
  v.setInt32(28, 1000, true);
  v.setInt32(32, shapeType, true);
  v.setFloat64(36, minX, true);
  v.setFloat64(44, minY, true);
  v.setFloat64(52, maxX, true);
  v.setFloat64(60, maxY, true);

  // Record
  v.setInt32(100, shxRecordOffset, false);           // Offset in 16-bit words
  v.setInt32(104, contentLength16, false);            // Content length in 16-bit words

  return new Uint8Array(buffer);
}

function generateDBF(props, modo, tiempo) {
  const modeLabel = CONFIG.MODES[modo] || modo;
  const areaKm2 = props.area_km2 || 0;
  const numRecords = 1;
  const numFields = 3;
  const fieldDescriptorsLength = numFields * 32 + 1;
  const recordLength = 31; // 1 (deleted) + 10 (mode) + 10 (time) + 10 (area)
  const numHeaderBytes = 32 + fieldDescriptorsLength + 1;
  const fileSize = numHeaderBytes + recordLength * numRecords;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // Header
  bytes[offset] = 0x03; offset += 1;              // Version
  bytes[offset] = 24; bytes[offset + 1] = 6; bytes[offset + 2] = 30; offset += 3; // Date
  view.setInt32(offset, numRecords, true); offset += 4;  // Num records
  view.setInt16(offset, numHeaderBytes, true); offset += 2;  // Header size
  view.setInt16(offset, recordLength, true); offset += 2;    // Record size
  offset += 20; // Reserved

  // Field descriptors
  writeFieldDescriptor(bytes, offset, 'MODOTXT', 'C', 10, 0); offset += 32;
  writeFieldDescriptor(bytes, offset, 'TIEMPO_N', 'N', 10, 0); offset += 32;
  writeFieldDescriptor(bytes, offset, 'AREA_KM2', 'N', 10, 2); offset += 32;

  // Header terminator
  bytes[offset] = 0x0D; offset += 1;

  // Record data
  bytes[offset] = 0x20; offset += 1;  // Deleted flag (space = not deleted)

  const modeStr = modeLabel.padEnd(10, ' ').substring(0, 10);
  for (let i = 0; i < 10; i++) bytes[offset + i] = modeStr.charCodeAt(i);
  offset += 10;

  const tiempoStr = String(Math.round(tiempo)).padStart(10, ' ').substring(0, 10);
  for (let i = 0; i < 10; i++) bytes[offset + i] = tiempoStr.charCodeAt(i);
  offset += 10;

  const areaStr = Number(areaKm2).toFixed(2).padStart(10, ' ').substring(0, 10);
  for (let i = 0; i < 10; i++) bytes[offset + i] = areaStr.charCodeAt(i);

  return new Uint8Array(buffer);
}

function writeFieldDescriptor(bytes, offset, name, type, length, decimals) {
  for (let i = 0; i < 11; i++) bytes[offset + i] = i < name.length ? name.charCodeAt(i) : 0;
  bytes[offset + 11] = type.charCodeAt(0);
  bytes[offset + 16] = length;
  bytes[offset + 17] = decimals;
}
