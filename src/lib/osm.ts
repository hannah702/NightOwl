/**
 * OpenStreetMap & Overpass API corridor data fetcher with in-memory bounding box caching.
 * Uses `nwr` (nodes, ways, relations) with `out center;` to capture building polygons and businesses.
 */

import { OsmElement, SafeHaven } from './scoring';
import { Place, normalizeOsmElementToPlace, isPlaceSafeHaven } from './places';

interface CachedOverpassData {
  timestamp: number;
  elements: OsmElement[];
}

const overpassCache = new Map<string, CachedOverpassData>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Computes bounding box for an array of coordinate pairs [lng, lat] with a buffer in degrees
 */
export function getBoundingBox(
  coordinates: [number, number][],
  bufferDeg = 0.0025 // ~280 meters buffer
): { south: number; west: number; north: number; east: number; bboxString: string; cacheKey: string } {
  let minLat = 90;
  let maxLat = -90;
  let minLon = 180;
  let maxLon = -180;

  for (const [lon, lat] of coordinates) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }

  const south = Math.max(-90, minLat - bufferDeg);
  const north = Math.min(90, maxLat + bufferDeg);
  const west = Math.max(-180, minLon - bufferDeg);
  const east = Math.min(180, maxLon + bufferDeg);

  // Round to 3 decimals (~100m grid) for high cache hit rate
  const cacheKey = `${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(3)},${east.toFixed(3)}`;
  const bboxString = `${south},${west},${north},${east}`;

  return { south, west, north, east, bboxString, cacheKey };
}

/**
 * Fetches safety & infrastructure data along the route corridor from Overpass API.
 * Uses `nwr` with `out center;` across food & drink, shops, services, and hangouts.
 */
export async function fetchCorridorOsmData(
  allRouteCoordinates: [number, number][],
  checkTime: Date = new Date(),
  countBarsAsSafeStops: boolean = false
): Promise<{ elements: OsmElement[]; havens: SafeHaven[]; places: Place[]; fromCache: boolean }> {
  if (!allRouteCoordinates || allRouteCoordinates.length === 0) {
    return { elements: [], havens: [], places: [], fromCache: false };
  }

  const { bboxString, cacheKey } = getBoundingBox(allRouteCoordinates);

  // Check cache
  const cached = overpassCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    const places = extractPlacesFromElements(cached.elements, checkTime);
    const havens = extractSafeHavensFromPlaces(places, cached.elements, checkTime, countBarsAsSafeStops);
    return {
      elements: cached.elements,
      havens,
      places,
      fromCache: true,
    };
  }

  // Broad NWR Overpass query covering food & drink, shops, services, and hangouts
  const query = `[out:json][timeout:15];
(
  nwr["amenity"~"cafe|restaurant|fast_food|pub|bar|biergarten|ice_cream|food_court|nightclub|pharmacy|atm|bank|fuel|clinic|hospital|police|bus_station|marketplace|cinema|library|community_centre|place_of_worship"](${bboxString});
  nwr["shop"~"convenience|supermarket|mall|department_store|kiosk|bakery|general|chemist|alcohol"](${bboxString});
  nwr["leisure"~"park|garden|fitness_centre|sports_centre"](${bboxString});
  nwr["tourism"~"attraction|hotel|hostel"](${bboxString});
  nwr["highway"="bus_stop"](${bboxString});
  nwr["railway"~"station|subway_entrance"](${bboxString});
  way["highway"](${bboxString});
);
out body center qt 400;`;

  try {
    const overpassMirrors = [
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ];

    let data: { elements?: OsmElement[] } = {};
    let fetchSuccess = false;

    // Attempt local backend proxy first
    try {
      const response = await fetch('/api/osm/corridor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, cacheKey }),
      });
      if (response.ok) {
        data = await response.json();
        fetchSuccess = true;
      }
    } catch {}

    if (!fetchSuccess) {
      for (const mirrorUrl of overpassMirrors) {
        try {
          const directRes = await fetch(mirrorUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
          });

          if (!directRes.ok) continue;

          data = await directRes.json();
          fetchSuccess = true;
          break;
        } catch {}
      }
    }

    const elements = data.elements || [];
    overpassCache.set(cacheKey, { timestamp: Date.now(), elements });

    const places = extractPlacesFromElements(elements, checkTime);
    const havens = extractSafeHavensFromPlaces(places, elements, checkTime, countBarsAsSafeStops);

    return { elements, havens, places, fromCache: false };
  } catch (err) {
    console.warn('Overpass fetch failed, using fallback corridor data:', err);
    const fallbackElements = generateFallbackCorridorData(allRouteCoordinates);
    const places = extractPlacesFromElements(fallbackElements, checkTime);
    const havens = extractSafeHavensFromPlaces(places, fallbackElements, checkTime, countBarsAsSafeStops);
    return { elements: fallbackElements, havens, places, fromCache: false };
  }
}

/**
 * Converts OSM elements into normalized Place records
 */
export function extractPlacesFromElements(elements: OsmElement[], checkTime: Date): Place[] {
  const places: Place[] = [];
  const seenIds = new Set<string>();

  for (const el of elements) {
    const p = normalizeOsmElementToPlace(el, checkTime);
    if (p && !seenIds.has(p.id)) {
      seenIds.add(p.id);
      places.push(p);
    }
  }

  return places;
}

/**
 * Extracts recognized Safe Havens from verified Places and OSM elements
 */
export function extractSafeHavensFromPlaces(
  places: Place[],
  elements: OsmElement[],
  checkTime: Date,
  countBarsAsSafeStops: boolean = false
): SafeHaven[] {
  const havens: SafeHaven[] = [];
  const seen = new Set<string>();

  // 1. From normalized Places that qualify as havens
  for (const p of places) {
    if (isPlaceSafeHaven(p, checkTime, countBarsAsSafeStops)) {
      seen.add(`${p.lat.toFixed(4)},${p.lng.toFixed(4)}`);
      havens.push({
        id: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        type: (p.subcategory as SafeHaven['type']) || 'other',
        open24h: p.is24h,
        openingHours: p.openingHours,
        description: p.closingTime || (p.is24h ? 'Verified 24/7 safe stop' : 'Staffed open business'),
      });
    }
  }

  // 2. Also ensure police and hospital nodes without full tags are preserved
  for (const el of elements) {
    const t = el.tags || {};
    if (t.amenity === 'police' || t.amenity === 'hospital') {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat === undefined || lng === undefined) continue;

      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
      if (!seen.has(key)) {
        seen.add(key);
        havens.push({
          id: `osm-${el.id}`,
          name: t.name || (t.amenity === 'police' ? 'Police Station' : 'Hospital'),
          lat,
          lng,
          type: t.amenity,
          open24h: true,
          description: 'Emergency safe haven',
        });
      }
    }
  }

  return havens;
}

/**
 * Fetches nearby open places around a center coordinate matching specific subcategories
 * Used for the "Nearby" chips row (Cafes, Restaurants, Pubs & Bars, etc.)
 */
export async function fetchNearbyPlacesForCategory(
  centerLat: number,
  centerLng: number,
  subcategories: string[],
  checkTime: Date = new Date()
): Promise<Place[]> {
  const radius = 2500; // 2.5 km radius around center
  const subcatRegex = subcategories.join('|');

  const query = `[out:json][timeout:10];
(
  nwr["amenity"~"^(${subcatRegex})$"](around:${radius},${centerLat},${centerLng});
  nwr["shop"~"^(${subcatRegex})$"](around:${radius},${centerLat},${centerLng});
  nwr["leisure"~"^(${subcatRegex})$"](around:${radius},${centerLat},${centerLng});
);
out body center qt 25;`;

  const mirrors = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  for (const mirror of mirrors) {
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) continue;

      const data = await res.json();
      if (!data.elements || !Array.isArray(data.elements)) continue;

      const places = extractPlacesFromElements(data.elements, checkTime);
      return places;
    } catch {}
  }

  return [];
}

/**
 * Generates synthetic baseline data when Overpass is strictly offline/rate-limited
 */
function generateFallbackCorridorData(coordinates: [number, number][]): OsmElement[] {
  const elements: OsmElement[] = [];

  for (let i = 0; i < coordinates.length; i += 3) {
    const [lon, lat] = coordinates[i];
    elements.push({
      id: 9000000 + i,
      type: 'way',
      lat,
      lon,
      tags: {
        highway: 'residential',
        lit: i % 2 === 0 ? 'yes' : 'unknown',
      },
    });

    if (i % 12 === 0) {
      elements.push({
        id: 8000000 + i,
        type: 'node',
        lat: lat + (Math.random() - 0.5) * 0.0006,
        lon: lon + (Math.random() - 0.5) * 0.0006,
        tags: {
          amenity: i % 24 === 0 ? 'pharmacy' : 'police',
          name: i % 24 === 0 ? 'City Care Pharmacy' : 'Patrol Safety Booth',
          opening_hours: '24/7',
        },
      });
    }
  }

  return elements;
}
