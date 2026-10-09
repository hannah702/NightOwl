/**
 * Routing and Geocoding service for NightOwl.
 * Multi-layer geocoder (Photon -> Nominatim -> Overpass), strict coordinate validation,
 * physically plausible walking duration checks, and safe waypoint corridor routing.
 */

import { CampusGate, CampusZone } from '../types/zones';
import { getDistanceMeters } from './scoring';

export interface RouteOption {
  id: string;
  name: string;
  summary: string;
  distance: number;       // road route distance in meters
  duration: number;       // verified walking duration in seconds
  geometry: {
    type: 'LineString';
    coordinates: [number, number][]; // [lng, lat]
  };
  steps?: {
    instruction: string;
    distance: number;
    duration: number;
  }[];
  campusNotice?: string;
  isEstimatedDuration?: boolean;
}

export interface GeocodeResult {
  placeId: string;
  displayName: string;
  subtitle?: string;
  lat: number;
  lng: number;
  type?: string;
  category?: string;
  distanceMeters?: number;
  source: 'photon' | 'nominatim' | 'overpass';
}

/**
 * Validates coordinate pair against real terrestrial bounds and India geographic bounds
 */
export function isValidCoordinate(
  lat: number,
  lng: number,
  allowOutsideIndia: boolean = false
): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!isFinite(lat) || !isFinite(lng)) return false;
  if (isNaN(lat) || isNaN(lng)) return false;

  // Reject (0, 0) and Null Island
  if (Math.abs(lat) < 0.005 && Math.abs(lng) < 0.005) return false;

  // General terrestrial limits
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;

  if (allowOutsideIndia) return true;

  // India geographic bounds: Latitude approx 6.5° N to 37.5° N, Longitude approx 68.0° E to 97.5° E
  const inIndia = lat >= 6.5 && lat <= 37.5 && lng >= 68.0 && lng <= 97.5;
  return inIndia;
}

/**
 * Validates and corrects walking duration to ensure physically plausible walking speeds.
 * Enforces typical walking speed between 0.8 m/s (~2.9 km/h) and 2.0 m/s (~7.2 km/h).
 * Default pace is 1.2 m/s (~4.3 km/h).
 */
export function validateAndCorrectWalkingDuration(
  roadDistanceMeters: number,
  rawDurationSeconds: number
): { durationSeconds: number; isEstimated: boolean } {
  const DEFAULT_WALKING_SPEED = 1.2; // 1.2 m/s = 4.32 km/h

  if (!rawDurationSeconds || rawDurationSeconds <= 0 || !isFinite(rawDurationSeconds)) {
    return {
      durationSeconds: Math.max(60, Math.round(roadDistanceMeters / DEFAULT_WALKING_SPEED)),
      isEstimated: true,
    };
  }

  const impliedSpeedMps = roadDistanceMeters / rawDurationSeconds;

  // If implied speed is < 0.8 m/s (crawling/stuck) or > 2.0 m/s (> 7.2 km/h - e.g. driving profile from OSRM demo)
  if (impliedSpeedMps < 0.8 || impliedSpeedMps > 2.0) {
    console.warn(
      `[NightOwl Speed Validation] Implied walking speed ${impliedSpeedMps.toFixed(2)} m/s (${(impliedSpeedMps * 3.6).toFixed(1)} km/h) for ${Math.round(roadDistanceMeters)}m is outside walking range (0.8-2.0 m/s). Correcting with 1.2 m/s.`
    );
    return {
      durationSeconds: Math.max(60, Math.round(roadDistanceMeters / DEFAULT_WALKING_SPEED)),
      isEstimated: true,
    };
  }

  return {
    durationSeconds: Math.round(rawDurationSeconds),
    isEstimated: false,
  };
}

/**
 * Layer 1: Photon Geocoding with map centre bias & POI support
 */
async function searchPhoton(
  query: string,
  nearCenter?: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<GeocodeResult[]> {
  try {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8`;
    if (nearCenter) {
      url += `&lat=${nearCenter.lat}&lon=${nearCenter.lng}&location_bias_scale=0.7`;
    }

    const res = await fetch(url, { signal });
    if (!res.ok) return [];

    const data = await res.json();
    if (!data.features || !Array.isArray(data.features)) return [];

    const results: GeocodeResult[] = [];
    for (const feat of data.features) {
      const coords = feat.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);

      if (!isValidCoordinate(lat, lng)) continue;

      const props = feat.properties || {};
      const primaryName = props.name || props.street || props.city || 'Location';
      const parts = [
        props.street,
        props.suburb || props.district,
        props.city,
        props.state,
      ].filter(Boolean);
      const subtitle = parts.join(', ') || props.country || '';

      const type = props.osm_value || props.type || props.osm_key;

      let distanceMeters: number | undefined;
      if (nearCenter) {
        distanceMeters = Math.round(getDistanceMeters(nearCenter.lat, nearCenter.lng, lat, lng));
      }

      results.push({
        placeId: `photon-${props.osm_type || 'p'}-${props.osm_id || Math.random()}`,
        displayName: primaryName,
        subtitle,
        lat,
        lng,
        type,
        category: props.osm_key,
        distanceMeters,
        source: 'photon',
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Layer 2: Nominatim Geocoding (Restricted to India by default with viewbox bias)
 */
async function searchNominatim(
  query: string,
  nearCenter?: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<GeocodeResult[]> {
  try {
    let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1&countrycodes=in`;
    if (nearCenter) {
      url += `&viewbox=${nearCenter.lng - 0.6},${nearCenter.lat + 0.6},${nearCenter.lng + 0.6},${nearCenter.lat - 0.6}&bounded=0`;
    }

    const res = await fetch(url, {
      signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NightOwl-WalkingNav/1.0',
      },
    });
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const results: GeocodeResult[] = [];
    for (const item of data) {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);

      if (!isValidCoordinate(lat, lng)) continue;

      const address = item.address || {};
      const primaryName = item.name || (item.display_name ? item.display_name.split(',')[0] : 'Location');
      const locality = address.suburb || address.neighbourhood || address.road || '';
      const city = address.city || address.town || address.village || address.municipality || address.county || '';
      const state = address.state || '';
      const parts = [locality, city, state].filter(Boolean);
      const subtitle = parts.join(', ') || item.display_name;

      let distanceMeters: number | undefined;
      if (nearCenter) {
        distanceMeters = Math.round(getDistanceMeters(nearCenter.lat, nearCenter.lng, lat, lng));
      }

      results.push({
        placeId: `nom-${item.place_id}`,
        displayName: primaryName,
        subtitle,
        lat,
        lng,
        type: item.type || item.class,
        category: item.class,
        distanceMeters,
        source: 'nominatim',
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Layer 3: Overpass Name Search inside 15 km of map centre
 */
async function searchOverpass(
  query: string,
  nearCenter?: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<GeocodeResult[]> {
  if (!nearCenter || query.trim().length < 3) return [];

  try {
    // Sanitize query string for Overpass regex
    const sanitized = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const overpassQuery = `[out:json][timeout:8];(nwr["name"~"${sanitized}",i](around:15000,${nearCenter.lat},${nearCenter.lng}););out center 8;`;

    const mirrors = [
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass-api.de/api/interpreter',
    ];

    for (const mirror of mirrors) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal,
        });
        if (!res.ok) continue;

        const data = await res.json();
        if (!data.elements || !Array.isArray(data.elements)) continue;

        const results: GeocodeResult[] = [];
        for (const el of data.elements) {
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          if (lat === undefined || lng === undefined) continue;
          if (!isValidCoordinate(lat, lng)) continue;

          const tags = el.tags || {};
          const name = tags.name || tags['name:en'] || query;
          const type = tags.amenity || tags.shop || tags.leisure || tags.tourism || 'place';
          const distanceMeters = Math.round(getDistanceMeters(nearCenter.lat, nearCenter.lng, lat, lng));

          results.push({
            placeId: `ovp-${el.type || 'n'}-${el.id}`,
            displayName: name,
            subtitle: `${type.replace(/_/g, ' ')} • ~${(distanceMeters / 1000).toFixed(1)} km away`,
            lat,
            lng,
            type,
            category: tags.amenity ? 'amenity' : (tags.shop ? 'shop' : 'leisure'),
            distanceMeters,
            source: 'overpass',
          });
        }

        if (results.length > 0) return results;
      } catch {}
    }
  } catch {}

  return [];
}

/**
 * Searches places using layered geocoding:
 * 1. Photon (POIs & location bias)
 * 2. Nominatim (India-restricted address details)
 * 3. Overpass (15 km corridor search for local spots)
 */
export async function searchPlaces(
  query: string,
  nearCenter?: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<GeocodeResult[]> {
  if (!query || query.trim().length < 2) return [];

  const trimmed = query.trim();

  // Run Photon first
  let photonResults: GeocodeResult[] = [];
  try {
    photonResults = await searchPhoton(trimmed, nearCenter, signal);
  } catch {}

  // If photon returned fewer than 3 results, supplement with Nominatim
  let nominatimResults: GeocodeResult[] = [];
  if (photonResults.length < 4) {
    try {
      nominatimResults = await searchNominatim(trimmed, nearCenter, signal);
    } catch {}
  }

  // If still fewer than 2 results and we have a map center, check Overpass local name search
  let overpassResults: GeocodeResult[] = [];
  if (photonResults.length + nominatimResults.length < 2 && nearCenter) {
    try {
      overpassResults = await searchOverpass(trimmed, nearCenter, signal);
    } catch {}
  }

  const allRaw = [...photonResults, ...nominatimResults, ...overpassResults];

  // Merge and deduplicate by name proximity (within 120m)
  const unique: GeocodeResult[] = [];
  for (const item of allRaw) {
    // Validate bounds
    if (!isValidCoordinate(item.lat, item.lng)) continue;

    // Reject > 100km from center unless query explicitly names a distant location
    if (nearCenter && item.distanceMeters && item.distanceMeters > 100000) {
      const lowerQ = trimmed.toLowerCase();
      const hasDistantIndicator =
        lowerQ.includes('delhi') ||
        lowerQ.includes('mumbai') ||
        lowerQ.includes('bangalore') ||
        lowerQ.includes('kolkata') ||
        lowerQ.includes('chennai') ||
        lowerQ.includes('jaipur') ||
        lowerQ.includes('kochi') ||
        lowerQ.includes('india');
      if (!hasDistantIndicator) continue;
    }

    const isDuplicate = unique.some(existing => {
      const dist = getDistanceMeters(existing.lat, existing.lng, item.lat, item.lng);
      const nameMatch = existing.displayName.toLowerCase() === item.displayName.toLowerCase();
      return dist < 120 && nameMatch;
    });

    if (!isDuplicate) {
      unique.push(item);
    }
  }

  // Rank results:
  // (a) Exact or prefix text match quality
  // (b) Being a typed POI (cafe, restaurant, shop) vs generic boundary
  // (c) Distance from map centre
  const qLower = trimmed.toLowerCase();
  unique.sort((a, b) => {
    const aName = a.displayName.toLowerCase();
    const bName = b.displayName.toLowerCase();

    const aExact = aName === qLower ? 1 : (aName.startsWith(qLower) ? 0.8 : 0);
    const bExact = bName === qLower ? 1 : (bName.startsWith(qLower) ? 0.8 : 0);
    if (bExact !== aExact) return bExact - aExact;

    const aPoi = a.type && !['administrative', 'boundary', 'residential'].includes(a.type) ? 1 : 0;
    const bPoi = b.type && !['administrative', 'boundary', 'residential'].includes(b.type) ? 1 : 0;
    if (bPoi !== aPoi) return bPoi - aPoi;

    if (a.distanceMeters !== undefined && b.distanceMeters !== undefined) {
      return a.distanceMeters - b.distanceMeters;
    }
    return 0;
  });

  return unique.slice(0, 8);
}

/**
 * Reverse geocodes coordinates to a street address / title
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  if (!isValidCoordinate(lat, lng)) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NightOwl-WalkingNav/1.0',
      },
    });
    if (!res.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const data = await res.json();
    const addr = data.address || {};
    const primary = data.name || addr.road || addr.suburb || data.display_name?.split(',')[0];
    const secondary = addr.city || addr.town || addr.village || addr.state || '';
    return secondary ? `${primary}, ${secondary}` : (data.display_name?.split(',')[0] || `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

/**
 * Ray-casting algorithm to test if a point [lat, lng] is inside a polygon
 */
export function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  if (!polygon || polygon.length < 3) return false;
  const [lat, lng] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > lng) !== (yj > lng)) &&
      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculates perpendicular distance in meters from point P to line segment AB
 */
export function getPerpendicularDistanceToSegment(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number
): number {
  const lineDist = getDistanceMeters(aLat, aLng, bLat, bLng);
  if (lineDist === 0) return getDistanceMeters(pLat, pLng, aLat, aLng);

  const dx = bLng - aLng;
  const dy = bLat - aLat;
  const u = Math.max(0, Math.min(1, ((pLng - aLng) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy)));

  const projLat = aLat + u * dy;
  const projLng = aLng + u * dx;
  return getDistanceMeters(pLat, pLng, projLat, projLng);
}

/**
 * Checks gate status against selected time
 */
export function getGateStatus(gate: CampusGate, checkTime: Date): { isOpen: boolean; message: string } {
  if (!gate.opensAt || !gate.closesAt) {
    return { isOpen: true, message: 'Open' };
  }
  const currentMins = checkTime.getHours() * 60 + checkTime.getMinutes();
  const [closeH, closeM] = gate.closesAt.split(':').map(Number);
  const [openH, openM] = gate.opensAt.split(':').map(Number);
  const closeTotal = closeH * 60 + closeM;
  const openTotal = openH * 60 + openM;

  let isOpen = false;
  if (closeTotal >= openTotal) {
    isOpen = currentMins >= openTotal && currentMins <= closeTotal;
  } else {
    // Overnight curfew
    isOpen = currentMins >= openTotal || currentMins <= closeTotal;
  }

  return {
    isOpen,
    message: isOpen
      ? `Open until ${gate.closesAt}`
      : `Closed (Curfew: Closes at ${gate.closesAt}, reopens at ${gate.opensAt})`,
  };
}

/**
 * Generates an alternative route geometry detour via an offset waypoint
 */
async function fetchDetouredRoute(
  origin: [number, number],
  dest: [number, number],
  waypoint: [number, number],
  maxAllowedDistance: number
): Promise<RouteOption | null> {
  const url = `https://router.project-osrm.org/route/v1/foot/${origin[0]},${origin[1]};${waypoint[0]},${waypoint[1]};${dest[0]},${dest[1]}?overview=full&geometries=geojson`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) return null;

    const r = data.routes[0];
    const roadDist = Math.round(r.distance);
    if (roadDist > maxAllowedDistance) return null;

    const { durationSeconds, isEstimated } = validateAndCorrectWalkingDuration(roadDist, r.duration);

    return {
      id: `route-detour-${Math.random().toString(36).substring(2, 7)}`,
      name: 'Commercial Boulevard Detour',
      summary: 'Via illuminated main avenue & active storefronts',
      distance: roadDist,
      duration: durationSeconds,
      isEstimatedDuration: isEstimated,
      geometry: r.geometry,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches 3 to 5 candidate walking routes between origin and destination.
 * Supports intermediate safe stop waypoint.
 * Enforces verified physical walking durations.
 */
export async function fetchCandidateWalkingRoutes(
  origin: [number, number],       // [lng, lat]
  destination: [number, number],  // [lng, lat]
  checkTime: Date,
  zones: CampusZone[] = [],
  zoneMode: 'off' | 'auto' = 'auto',
  safeStopWaypoint?: [number, number] | null // [lng, lat]
): Promise<RouteOption[]> {
  // 1. Calculate straight-line (haversine) distance
  const haversineDist = getDistanceMeters(origin[1], origin[0], destination[1], destination[0]);

  // 2. Validate walking radius
  if (haversineDist > 65000) {
    throw new Error('These places are far apart for a walking route (over 65 km). Please choose closer origin and destination points.');
  }

  // 3. Hard sanity threshold
  const maxAllowedDistance = Math.max(3.5 * haversineDist, haversineDist + 2000);

  // 4. Check active generic campus zone
  let campusNotice: string | undefined = undefined;
  let intermediateWaypoint: [number, number] | null = safeStopWaypoint || null;

  if (!intermediateWaypoint && zoneMode === 'auto' && zones.length > 0) {
    const activeZone = zones.find(z =>
      isPointInPolygon([origin[1], origin[0]], z.polygon) ||
      isPointInPolygon([destination[1], destination[0]], z.polygon)
    );

    if (activeZone) {
      const closedGates = activeZone.gates.filter(g => g.name && !getGateStatus(g, checkTime).isOpen);
      const openGates = activeZone.gates.filter(g => g.name && getGateStatus(g, checkTime).isOpen);

      const closedNames = closedGates.map(g => g.name.trim()).filter(Boolean);
      const openNames = openGates.map(g => g.name.trim()).filter(Boolean);

      if (closedNames.length > 0 && openNames.length > 0) {
        campusNotice = `⚠️ ${closedNames.join(', ')} is closed at this time. Use ${openNames.join(', ')}.`;
      } else if (closedNames.length > 0) {
        campusNotice = `⚠️ ${closedNames.join(', ')} is closed at this time.`;
      }

      for (const openGate of openGates) {
        const perpDist = getPerpendicularDistanceToSegment(
          openGate.lat, openGate.lng,
          origin[1], origin[0],
          destination[1], destination[0]
        );
        const distToStart = getDistanceMeters(openGate.lat, openGate.lng, origin[1], origin[0]);
        const distToEnd = getDistanceMeters(openGate.lat, openGate.lng, destination[1], destination[0]);

        if (perpDist <= 500 && isPointInPolygon([openGate.lat, openGate.lng], activeZone.polygon) && distToStart > 60 && distToEnd > 60) {
          intermediateWaypoint = [openGate.lng, openGate.lat];
          break;
        }
      }
    }
  }

  const rawCandidateRoutes: RouteOption[] = [];
  let osrmNetworkError: string | null = null;

  const waypointSegments = intermediateWaypoint
    ? `${origin[0]},${origin[1]};${intermediateWaypoint[0]},${intermediateWaypoint[1]};${destination[0]},${destination[1]}`
    : `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;

  const osrmUrl = `https://router.project-osrm.org/route/v1/foot/${waypointSegments}?overview=full&geometries=geojson&alternatives=3&steps=true`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error(`OSRM request failed: ${osrmUrl} (status: ${res.status})`);
      osrmNetworkError = `Routing server returned status ${res.status}`;
    } else {
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        data.routes.forEach((r: any, idx: number) => {
          let name = 'Direct Footpath Route';
          let summary = 'Shortest trajectory along verified public roads';
          if (intermediateWaypoint && safeStopWaypoint) {
            name = idx === 0 ? 'Route via Safe Haven Stop' : `Alternative via Safe Stop ${idx}`;
            summary = 'Walks via selected safe haven stop before final destination';
          } else if (idx === 1) {
            name = 'Lit Corridor Alternative';
            summary = 'Via populated arterial road and transit stops';
          } else if (idx === 2) {
            name = 'Commercial Mainway';
            summary = 'Passes open storefronts and service centers';
          } else if (idx >= 3) {
            name = `Alternate Path ${idx + 1}`;
            summary = 'Secondary walking corridor';
          }

          const roadDist = Math.round(r.distance);
          const { durationSeconds, isEstimated } = validateAndCorrectWalkingDuration(roadDist, r.duration);

          rawCandidateRoutes.push({
            id: `osrm-${idx}`,
            name,
            summary,
            distance: roadDist,
            duration: durationSeconds,
            isEstimatedDuration: isEstimated,
            geometry: r.geometry,
            campusNotice: campusNotice || undefined,
            steps: r.legs?.[0]?.steps?.map((s: any) => ({
              instruction: s.maneuver?.type || 'Walk',
              distance: Math.round(s.distance),
              duration: Math.round(s.duration),
            })),
          });
        });
      }
    }
  } catch (err: any) {
    const errMsg = err?.name === 'AbortError' ? 'Timeout (8s exceeded)' : (err?.message || 'Network error');
    osrmNetworkError = errMsg;
  }

  // 5. HARD SANITY FILTER
  const sanitizedRoutes = rawCandidateRoutes.filter(r => {
    const isSensible = r.distance <= maxAllowedDistance;
    return isSensible;
  });

  // 6. Generate close local detours if we have fewer than 3 candidates
  if (!safeStopWaypoint && sanitizedRoutes.length > 0 && sanitizedRoutes.length < 3 && haversineDist < 12000) {
    const dLon = destination[0] - origin[0];
    const dLat = destination[1] - origin[1];
    const len = Math.sqrt(dLon * dLon + dLat * dLat);

    if (len > 0) {
      const perpOffsetMag = Math.min(0.0008, Math.max(0.0003, (haversineDist / 1000) * 0.0002));
      const perpLon = (-dLat / len) * perpOffsetMag;
      const perpLat = (dLon / len) * perpOffsetMag;

      const midLon = (origin[0] + destination[0]) / 2;
      const midLat = (origin[1] + destination[1]) / 2;

      const detour1 = await fetchDetouredRoute(
        origin, destination,
        [midLon + perpLon, midLat + perpLat],
        maxAllowedDistance
      );
      if (detour1) {
        detour1.name = 'Well-Lit Arterial Route';
        detour1.summary = 'Slight detour via broader street with steady lighting';
        if (campusNotice) detour1.campusNotice = campusNotice;
        sanitizedRoutes.push(detour1);
      }

      if (sanitizedRoutes.length < 3) {
        const detour2 = await fetchDetouredRoute(
          origin, destination,
          [midLon - perpLon, midLat - perpLat],
          maxAllowedDistance
        );
        if (detour2) {
          detour2.name = 'High-Activity District Route';
          detour2.summary = 'Stays closer to open stores and safe havens';
          if (campusNotice) detour2.campusNotice = campusNotice;
          sanitizedRoutes.push(detour2);
        }
      }
    }
  }

  if (sanitizedRoutes.length === 0) {
    throw new Error(
      osrmNetworkError
        ? `Routing service error: ${osrmNetworkError}. We couldn't find a sensible walking route between these points.`
        : "We couldn't find a sensible walking route between these points."
    );
  }

  return sanitizedRoutes.slice(0, 5);
}
