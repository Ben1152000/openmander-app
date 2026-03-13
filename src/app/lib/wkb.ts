/** Parse a WKB-encoded MultiPolygon into a GeoJSON MultiPolygon. */
export function parseWkbMultiPolygon(wkb: Uint8Array): GeoJSON.MultiPolygon | null {
  if (wkb.length < 9) return null;

  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  let offset = 0;

  const isLE = wkb[offset++] === 1;
  const readU32 = () => { const v = view.getUint32(offset, isLE); offset += 4; return v; };
  const readF64 = () => { const v = view.getFloat64(offset, isLE); offset += 8; return v; };

  if (readU32() !== 6) return null; // not MultiPolygon

  const numPolygons = readU32();
  const polygons: GeoJSON.Position[][][] = [];

  for (let p = 0; p < numPolygons; p++) {
    offset++; // byte order
    if (readU32() !== 3) continue; // not Polygon

    const rings: GeoJSON.Position[][] = [];
    const numRings = readU32();
    for (let r = 0; r < numRings; r++) {
      const numPoints = readU32();
      const ring: GeoJSON.Position[] = [];
      for (let i = 0; i < numPoints; i++) ring.push([readF64(), readF64()]);
      rings.push(ring);
    }
    polygons.push(rings);
  }

  return { type: 'MultiPolygon', coordinates: polygons };
}

/** Area-weighted centroid of a MultiPolygon (exterior rings only). */
export function multiPolygonCentroid(mp: GeoJSON.MultiPolygon): [number, number] {
  let totalArea = 0, cx = 0, cy = 0;
  for (const polygon of mp.coordinates) {
    const ring = polygon[0];
    let area = 0, rx = 0, ry = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      area += cross; rx += (ring[i][0] + ring[j][0]) * cross; ry += (ring[i][1] + ring[j][1]) * cross;
    }
    area = Math.abs(area) / 2;
    if (area > 0) { cx += (rx / (6 * area)) * area; cy += (ry / (6 * area)) * area; totalArea += area; }
  }
  return totalArea > 0 ? [cx / totalArea, cy / totalArea] : [0, 0];
}
