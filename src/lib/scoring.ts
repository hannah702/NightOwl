/**
 * NightOwl - Core Safety Scoring Engine
 * 
 * Formula:
 * FinalScore = (w_light * LightingScore + w_crowd * ActivityScore + w_road * RoadTypeScore + w_havens * HavenProximityScore - w_incident * IncidentPenalty)
 * All sub-scores normalised to [0, 1] range before weighting.
 * Final route score scaled to [0, 100].
 */

import opening_hours from 'opening_hours';
import { Place, PLACE_CATEGORY_WEIGHTS } from './places';

export interface SafetyWeights {
  lighting: number;       // default 35
  activity: number;       // default 25
  speed: number;          // user preference for brevity/time (affects route ranking balance)
  havens: number;         // default 20
  incidents: number;      // default 20
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface CrowdsourcedReport {
  id: string;
  lat: number;
  lng: number;
  type: 'dark_patch' | 'broken_streetlight' | 'harassment' | 'suspicious_activity' | 'isolated_area' | 'other';
  note?: string;
  timestamp: number;      // Epoch ms
  confirmations: number;
  dismissals: number;
}

export interface SafeHaven {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: 'pharmacy' | 'fuel' | 'police' | 'hospital' | 'convenience' | 'atm' | 'campus_security' | 'other';
  open24h?: boolean;
  openingHours?: string;
  opensAt?: string;       // e.g. "08:00"
  closesAt?: string;      // e.g. "22:00"
  description?: string;
}

export interface OsmElement {
  id: number | string;
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  nodes?: number[];
}

export interface SampledPoint {
  lat: number;
  lng: number;
  distanceFromStart: number;
  nearestRoadType?: string;
  isLit?: boolean | 'unknown';
  nearbyOpenShopsCount: number;
  nearestHavenDistance: number;
  hasHavenWithin100m: boolean;
  incidentPenalty: number;
  pointScore: number; // 0..100
}

export interface SegmentScore {
  from: [number, number]; // [lng, lat]
  to: [number, number];   // [lng, lat]
  score: number;          // 0..100
  color: string;          // Hex or tailwind class
  lighting: 'lit' | 'unlit' | 'unknown';
  roadType: string;
  havenNearby: boolean;
  incidentNearby: boolean;
}

export interface ScoredRouteResult {
  routeIndex: number;
  rawDuration: number;    // seconds
  rawDistance: number;    // meters
  safetyScore: number;    // 0..100

  // Sub-scores (0..1)
  lightingScore: number;
  activityScore: number;
  roadTypeScore: number;
  havenProximityScore: number;
  incidentPenalty: number;

  // Granular metrics for explanation & UI
  litPercent: number;                // verified lit %
  estimatedLitPercent?: number;       // including estimated daytime/road-type lit %
  hasLightingData: boolean;          // false if lit tag was missing on all highway ways
  unlitDistanceMeters: number;
  openPlacesCount: number;
  openPlacesBreakdown?: Record<string, number>;
  openPlacesSummary?: string;
  passedPlaces?: Place[];
  openHavensPassedCount: number;
  longestHavenGapMeters: number;
  hasHavensNearby: boolean;
  nearbyIncidentsCount: number;
  dataConfidence: number;            // 0..1 (how much OSM data was verified)

  // Segment analysis
  segments: SegmentScore[];
  sampledPoints: SampledPoint[];
}

/**
 * Formats duration from seconds into human-readable walking time
 */
export function formatDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) {
    return `${mins} min`;
  }
  const h = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${h}h ${remMins}m` : `${h}h`;
}

/**
 * Formats distance from meters into human-readable format
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

// Road type hierarchy weights
export const ROAD_TYPE_SCORES: Record<string, number> = {
  pedestrian: 1.0,
  living_street: 0.95,
  footway: 0.90,
  cycleway: 0.85,
  residential: 0.80,
  tertiary: 0.70,
  secondary: 0.60,
  primary: 0.50,
  service: 0.40,
  path: 0.40,
  track: 0.25,
  alley: 0.20,
  unclassified: 0.50,
};

// Half-life in days for exponential decay
export const REPORT_HALF_LIFE_DAYS: Record<CrowdsourcedReport['type'], number> = {
  harassment: 30,          // Harassment reports stay relevant longer
  suspicious_activity: 21,
  isolated_area: 45,       // Structural isolation changes slowly
  broken_streetlight: 14,  // Broken fixtures can get fixed
  dark_patch: 14,
  other: 14,
};

/**
 * Calculates Haversine distance in meters between two lat/lng coordinates
 */
export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Checks if a safe haven is open at a given time
 */
export function isHavenOpen(haven: SafeHaven, checkTime: Date): boolean {
  if (haven.open24h) return true;
  if (haven.type === 'police' || haven.type === 'hospital' || haven.type === 'campus_security') {
    return true;
  }

  // Try openingHours string with opening_hours library
  if (haven.openingHours) {
    try {
      const oh = new opening_hours(haven.openingHours);
      return oh.getState(checkTime);
    } catch {
      // Fallback
    }
  }

  // Fallback to opensAt / closesAt simple time strings "HH:MM"
  if (haven.opensAt && haven.closesAt) {
    const currentMins = checkTime.getHours() * 60 + checkTime.getMinutes();
    const [openH, openM] = haven.opensAt.split(':').map(Number);
    const [closeH, closeM] = haven.closesAt.split(':').map(Number);
    const openTotal = openH * 60 + openM;
    const closeTotal = closeH * 60 + closeM;

    if (closeTotal >= openTotal) {
      return currentMins >= openTotal && currentMins <= closeTotal;
    } else {
      // Overnight (e.g. 18:00 to 03:00)
      return currentMins >= openTotal || currentMins <= closeTotal;
    }
  }

  // If no hours known: fuel & pharmacy remain open until late, others close at 10 PM
  const hour = checkTime.getHours();
  if (haven.type === 'fuel' || haven.type === 'atm') return true;
  if (haven.type === 'pharmacy') return hour >= 7 && hour < 23;
  return hour >= 8 && hour < 22;
}

/**
 * Checks if an OSM element with opening_hours is open at checkTime
 * Returns { isOpen: boolean; hasHours: boolean; unknownWeight: number }
 */
export function isOsmElementOpen(tags: Record<string, string> | undefined, checkTime: Date): {
  isOpen: boolean;
  hasHours: boolean;
  effectiveWeight: number;
} {
  if (!tags) return { isOpen: false, hasHours: false, effectiveWeight: 0 };

  const hour = checkTime.getHours();
  const isLateNight = hour >= 22 || hour < 5;

  // Always open facilities
  if (tags.amenity === 'police' || tags.amenity === 'hospital') {
    return { isOpen: true, hasHours: true, effectiveWeight: 1.0 };
  }

  // Explicit 24/7 check
  if (tags.opening_hours === '24/7' || tags['24_7'] === 'yes') {
    return { isOpen: true, hasHours: true, effectiveWeight: 1.0 };
  }

  if (tags.opening_hours) {
    try {
      const oh = new opening_hours(tags.opening_hours);
      const state = oh.getState(checkTime);
      return {
        isOpen: state,
        hasHours: true,
        effectiveWeight: state ? 1.0 : 0.0,
      };
    } catch {
      // Parse error on complex OSM rule, fallback to unknown below
    }
  }

  // If no opening_hours tag: count at reduced weight
  // By day: 0.40; After 10 PM: 0.15 (or 0 for standard shops)
  const unknownWeight = isLateNight ? 0.15 : 0.40;
  const isTypicalNightAmenity = tags.amenity === 'fuel' || tags.amenity === 'pharmacy' || tags.amenity === 'atm';

  if (isLateNight && !isTypicalNightAmenity) {
    // Standard retail / cafe / supermarket with unknown hours is likely closed after 10 PM
    return { isOpen: false, hasHours: false, effectiveWeight: 0 };
  }

  return {
    isOpen: true,
    hasHours: false,
    effectiveWeight: unknownWeight,
  };
}

/**
 * Computes incident decay weight based on age, user confirmations, and time of day
 */
export function computeIncidentWeight(report: CrowdsourcedReport, checkTime: Date): number {
  const ageMs = Math.max(0, checkTime.getTime() - report.timestamp);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const halfLife = REPORT_HALF_LIFE_DAYS[report.type] || 14;

  // Exponential decay
  const timeDecay = Math.exp(-ageDays / halfLife);

  // Community verification multiplier
  const verificationMultiplier = Math.max(0.2, 1 + (report.confirmations * 0.35) - (report.dismissals * 0.45));

  // Night-time multiplier for night-relevant incidents (harassment, dark patch, suspicious activity)
  const hour = checkTime.getHours();
  const isNight = hour >= 20 || hour < 6;
  let nightMultiplier = 1.0;
  if (isNight && (report.type === 'harassment' || report.type === 'dark_patch' || report.type === 'suspicious_activity' || report.type === 'isolated_area')) {
    nightMultiplier = 1.45;
  }

  return timeDecay * verificationMultiplier * nightMultiplier;
}

/**
 * Resamples a route geometry (array of [lng, lat]) every ~intervalMeters
 */
export function resampleRoute(
  coordinates: [number, number][],
  intervalMeters = 25
): { points: { lat: number; lng: number; dist: number }[]; totalDistance: number } {
  if (!coordinates || coordinates.length === 0) {
    return { points: [], totalDistance: 0 };
  }

  const result: { lat: number; lng: number; dist: number }[] = [];
  let cumulativeDist = 0;

  result.push({
    lat: coordinates[0][1],
    lng: coordinates[0][0],
    dist: 0,
  });

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lon1, lat1] = coordinates[i];
    const [lon2, lat2] = coordinates[i + 1];
    const segmentLen = getDistanceMeters(lat1, lon1, lat2, lon2);

    if (segmentLen === 0) continue;

    const steps = Math.max(1, Math.floor(segmentLen / intervalMeters));
    for (let s = 1; s <= steps; s++) {
      const frac = s / steps;
      const interpLat = lat1 + (lat2 - lat1) * frac;
      const interpLng = lon1 + (lon2 - lon1) * frac;
      const pointDist = cumulativeDist + segmentLen * frac;
      result.push({
        lat: interpLat,
        lng: interpLng,
        dist: pointDist,
      });
    }

    cumulativeDist += segmentLen;
  }

  return { points: result, totalDistance: cumulativeDist };
}

/**
 * Primary Safety Scoring Engine Function (Pure function)
 */
export function scoreRouteSafety({
  routeIndex,
  coordinates,
  rawDuration,
  rawDistance,
  weights,
  checkTime,
  osmElements = [],
  safeHavens = [],
  places = [],
  incidentReports = [],
  isInActiveZone = false,
  countBarsAsSafeStops = false,
}: {
  routeIndex: number;
  coordinates: [number, number][]; // [lng, lat]
  rawDuration: number;
  rawDistance: number;
  weights: SafetyWeights;
  checkTime: Date;
  osmElements?: OsmElement[];
  safeHavens?: SafeHaven[];
  places?: Place[];
  incidentReports?: CrowdsourcedReport[];
  isInActiveZone?: boolean;
  countBarsAsSafeStops?: boolean;
}): ScoredRouteResult {
  // Normalize user weights
  const totalWeightSum =
    (weights.lighting || 0) +
    (weights.activity || 0) +
    (weights.havens || 0) +
    (weights.incidents || 0);

  const baseNormLight = totalWeightSum > 0 ? (weights.lighting / totalWeightSum) : 0.35;
  const normCrowd = totalWeightSum > 0 ? (weights.activity / totalWeightSum) : 0.25;
  const normRoad = 0.15; // Baseline road infrastructure weight
  const normHavens = totalWeightSum > 0 ? (weights.havens / totalWeightSum) : 0.20;
  const normIncidents = totalWeightSum > 0 ? (weights.incidents / totalWeightSum) : 0.20;

  // Time-of-day multipliers:
  const hour = checkTime.getHours();
  const isNight = hour >= 20 || hour < 6;
  const isLateNight = hour >= 22 || hour < 5;
  const isDaylight = hour >= 8 && hour < 19;

  // 1. Lighting matters more at night: multiplier for lighting (x0.4 in daylight, x1.0 at night)
  const lightingTimeMultiplier = isDaylight ? 0.40 : isNight ? 1.00 : 0.70;
  const effectiveNormLight = baseNormLight * lightingTimeMultiplier;

  // 2. Time-of-day pedestrian multiplier on baseline activity (~1.0 from 8am to 7pm, ~0.6 from 7 to 10pm, ~0.25 from 10pm to 5am)
  let timeOfDayActivityMultiplier = 1.0;
  if (hour >= 22 || hour < 5) {
    timeOfDayActivityMultiplier = 0.25;
  } else if (hour >= 19 && hour < 22) {
    timeOfDayActivityMultiplier = 0.60;
  } else if (hour >= 8 && hour < 19) {
    timeOfDayActivityMultiplier = 1.00;
  } else {
    timeOfDayActivityMultiplier = 0.45; // Dawn (5am - 8am)
  }

  // Pre-filter active havens open at checkTime
  const activeHavens = safeHavens.filter(h => isHavenOpen(h, checkTime));

  // Resample points every 25m
  const { points: sampledPointsRaw, totalDistance } = resampleRoute(coordinates, 25);
  const effectiveDistance = totalDistance > 0 ? totalDistance : rawDistance;

  // Categorize OSM elements
  const highwayWays = osmElements.filter(el => el.tags?.highway);
  const activityNodes = osmElements.filter(el => {
    const t = el.tags || {};
    return t.shop || t.amenity || t.leisure || t.highway === 'bus_stop';
  });

  let totalVerifiedLitSamples = 0;
  let totalEstimatedLitSamples = 0;
  let totalExplicitKnownLightingSamples = 0;
  let totalRoadScoreSum = 0;
  let totalActivityScoreSum = 0;
  let totalHavenProximitySum = 0;
  let totalIncidentPenaltySum = 0;
  let openPlacesCountTotal = 0;
  let unlitDistanceMeters = 0;

  // Track haven gaps
  let currentHavenGapStartDist = 0;
  let inHavenGap = false;
  let longestHavenGapMeters = 0;
  const passedHavensSet = new Set<string>();
  const nearbyIncidentsSet = new Set<string>();
  const passedPlacesMap = new Map<string, Place>();

  const sampledPoints: SampledPoint[] = [];

  for (let i = 0; i < sampledPointsRaw.length; i++) {
    const pt = sampledPointsRaw[i];
    const prevPt = i > 0 ? sampledPointsRaw[i - 1] : null;
    const stepDist = prevPt ? (pt.dist - prevPt.dist) : 0;

    // 1. LIGHTING DETERMINATION
    let isLit: boolean | 'unknown' = 'unknown';
    let roadType = 'residential';

    let nearestWayDist = Infinity;
    for (const way of highwayWays) {
      const wayLat = way.lat ?? way.center?.lat;
      const wayLon = way.lon ?? way.center?.lon;
      if (wayLat !== undefined && wayLon !== undefined) {
        const d = getDistanceMeters(pt.lat, pt.lng, wayLat, wayLon);
        if (d < nearestWayDist && d < 60) {
          nearestWayDist = d;
          roadType = way.tags?.highway || roadType;
          if (way.tags?.lit === 'yes') isLit = true;
          else if (way.tags?.lit === 'no') isLit = false;
        }
      }
    }

    // Inside active campus zone, pedestrian pathways receive priority
    if (isInActiveZone && isLit === 'unknown') {
      isLit = true;
      roadType = roadType === 'residential' ? 'pedestrian' : roadType;
    }

    let pointLightScore = 0.50; // Neutral baseline for unknown

    if (isLit === true) {
      pointLightScore = 1.0;
      totalVerifiedLitSamples++;
      totalEstimatedLitSamples++;
      totalExplicitKnownLightingSamples++;
    } else if (isLit === false) {
      // Explicitly marked unlit: heavily penalised at night, moderate during day
      pointLightScore = isDaylight ? 0.40 : 0.05;
      totalExplicitKnownLightingSamples++;
      unlitDistanceMeters += stepDist;
    } else {
      // Unknown lighting: missing OSM tag is NOT scored as zero.
      // In daylight hours, natural sunlight illuminates streets: high score (0.85)
      // At night, unknown residential/secondary streets have estimated streetlights based on road type
      if (isDaylight) {
        pointLightScore = 0.85;
        totalEstimatedLitSamples += 0.85;
      } else {
        // Night: unlit/unknown roads are penalised more than at noon, but major roads get estimated lighting
        if (roadType === 'primary' || roadType === 'secondary' || roadType === 'tertiary') {
          pointLightScore = 0.55; // Arterials almost always have public streetlights
          totalEstimatedLitSamples += 0.55;
        } else if (roadType === 'residential' || roadType === 'living_street') {
          pointLightScore = 0.35;
          totalEstimatedLitSamples += 0.35;
          unlitDistanceMeters += stepDist * 0.5;
        } else {
          // Alley, path, track
          pointLightScore = 0.15;
          unlitDistanceMeters += stepDist * 0.85;
        }
      }
    }

    // 2. ACTIVITY & OPEN BUSINESSES DETERMINATION (40m radius)
    let pointActivitySum = 0;
    let pointOpenShops = 0;

    if (places && places.length > 0) {
      for (const place of places) {
        const d = getDistanceMeters(pt.lat, pt.lng, place.lat, place.lng);
        if (d <= 40) {
          if (place.openNow) {
            passedPlacesMap.set(place.id, place);
            pointOpenShops++;

            let weight = PLACE_CATEGORY_WEIGHTS[place.subcategory] ?? 0.5;
            // Bars & Pubs: late-night safety discounting after 11 PM
            if (['bar', 'pub', 'nightclub', 'biergarten'].includes(place.subcategory)) {
              if (hour >= 23 || hour < 4) {
                weight = 0.45;
              }
            }
            // Parks: daytime 1.0, dark 0.2
            if (['park', 'garden'].includes(place.subcategory)) {
              weight = (hour >= 6 && hour < 19) ? 1.0 : 0.2;
            }
            // Unknown hours penalty
            if (!place.openingHours) {
              weight *= 0.5;
            }

            const is24_7 = place.is24h;
            const bonus = (is24_7 && isLateNight) ? 0.35 : 0.20;
            pointActivitySum += bonus * weight;
          }
        }
      }
    } else {
      for (const node of activityNodes) {
        const nodeLat = node.lat ?? node.center?.lat;
        const nodeLon = node.lon ?? node.center?.lon;
        if (nodeLat !== undefined && nodeLon !== undefined) {
          const d = getDistanceMeters(pt.lat, pt.lng, nodeLat, nodeLon);
          if (d <= 45) {
            const { isOpen, effectiveWeight } = isOsmElementOpen(node.tags, checkTime);
            if (isOpen && effectiveWeight > 0) {
              pointOpenShops++;
              const is24_7 = node.tags?.opening_hours === '24/7' || node.tags?.['24_7'] === 'yes';
              const bonus = (is24_7 && isLateNight) ? 0.35 : 0.20;
              pointActivitySum += bonus * effectiveWeight;
            }
          }
        }
      }
    }

    if (isInActiveZone) {
      pointActivitySum += (hour >= 8 && hour <= 23) ? 0.25 : 0.05;
    }

    const normalizedPointActivity = Math.min(1.0, pointActivitySum * timeOfDayActivityMultiplier);
    totalActivityScoreSum += normalizedPointActivity;
    openPlacesCountTotal += pointOpenShops;

    // 3. ROAD TYPE SCORE
    const roadScore = ROAD_TYPE_SCORES[roadType] || 0.45;
    totalRoadScoreSum += roadScore;

    // 4. SAFE HAVEN PROXIMITY (~100m check, only counted if OPEN at checkTime)
    let minHavenDist = Infinity;
    for (const haven of activeHavens) {
      const d = getDistanceMeters(pt.lat, pt.lng, haven.lat, haven.lng);
      if (d < minHavenDist) {
        minHavenDist = d;
      }
      if (d <= 120) {
        passedHavensSet.add(haven.id);
      }
    }

    const hasHavenWithin100m = minHavenDist <= 100;
    let havenScore = 0;
    if (minHavenDist <= 50) havenScore = 1.0;
    else if (minHavenDist <= 100) havenScore = 0.85;
    else if (minHavenDist <= 200) havenScore = 0.50;
    else if (minHavenDist <= 400) havenScore = 0.25;
    else havenScore = 0.05;

    totalHavenProximitySum += havenScore;

    // Haven gap tracking
    if (!hasHavenWithin100m) {
      if (!inHavenGap) {
        inHavenGap = true;
        currentHavenGapStartDist = pt.dist;
      } else {
        const currentGap = pt.dist - currentHavenGapStartDist;
        if (currentGap > longestHavenGapMeters) {
          longestHavenGapMeters = currentGap;
        }
      }
    } else {
      if (inHavenGap) {
        inHavenGap = false;
        const finalGap = pt.dist - currentHavenGapStartDist;
        if (finalGap > longestHavenGapMeters) {
          longestHavenGapMeters = finalGap;
        }
      }
    }

    // 5. INCIDENT PENALTY
    let pointIncidentPenalty = 0;
    for (const report of incidentReports) {
      const d = getDistanceMeters(pt.lat, pt.lng, report.lat, report.lng);
      if (d <= 60) {
        nearbyIncidentsSet.add(report.id);
        const weight = computeIncidentWeight(report, checkTime);
        const distAttenuation = 1 - (d / 60);
        pointIncidentPenalty += weight * distAttenuation * 0.45;
      }
    }
    const normPointPenalty = Math.min(1.0, pointIncidentPenalty);
    totalIncidentPenaltySum += normPointPenalty;

    // Composite point score (0..100)
    const compositePt = Math.max(
      5,
      Math.min(
        100,
        ((pointLightScore * effectiveNormLight +
          normalizedPointActivity * normCrowd +
          roadScore * normRoad +
          havenScore * normHavens -
          normPointPenalty * normIncidents) /
          (effectiveNormLight + normCrowd + normRoad + normHavens)) * 100
      )
    );

    sampledPoints.push({
      lat: pt.lat,
      lng: pt.lng,
      distanceFromStart: pt.dist,
      nearestRoadType: roadType,
      isLit,
      nearbyOpenShopsCount: pointOpenShops,
      nearestHavenDistance: minHavenDist === Infinity ? 9999 : Math.round(minHavenDist),
      hasHavenWithin100m,
      incidentPenalty: normPointPenalty,
      pointScore: Math.round(compositePt),
    });
  }

  // Handle haven gap along route geometry only
  const hasHavensNearby = passedHavensSet.size > 0;
  let finalHavenGap = 0;
  if (hasHavensNearby) {
    if (inHavenGap && sampledPointsRaw.length > 0) {
      const finalGap = effectiveDistance - currentHavenGapStartDist;
      if (finalGap > longestHavenGapMeters) {
        longestHavenGapMeters = finalGap;
      }
    }
    finalHavenGap = Math.round(Math.min(effectiveDistance, longestHavenGapMeters));
  }

  const sampleCount = Math.max(1, sampledPoints.length);

  // Sub-scores in [0, 1]
  const hasLightingData = totalExplicitKnownLightingSamples > 0;
  const verifiedLitPercent = Math.round((totalVerifiedLitSamples / sampleCount) * 100);
  const estimatedLitPercent = Math.round((totalEstimatedLitSamples / sampleCount) * 100);

  // Lighting score: if verified data exists, use verified; otherwise use estimated daytime/road-type lighting
  const lightingScore = hasLightingData
    ? (totalVerifiedLitSamples / Math.max(1, totalExplicitKnownLightingSamples))
    : (isDaylight ? 0.85 : 0.45);

  const activityScore = Math.min(1.0, totalActivityScoreSum / sampleCount);
  const roadTypeScore = Math.min(1.0, totalRoadScoreSum / sampleCount);
  const havenProximityScore = Math.min(1.0, totalHavenProximitySum / sampleCount);
  const incidentPenalty = Math.min(1.0, totalIncidentPenaltySum / sampleCount);

  // Final weighted safety calculation
  const rawSafetyScore =
    (effectiveNormLight * lightingScore +
      normCrowd * activityScore +
      normRoad * roadTypeScore +
      normHavens * havenProximityScore -
      normIncidents * incidentPenalty) /
    (effectiveNormLight + normCrowd + normRoad + normHavens);

  // Scaled to 0..100 with bounds
  const safetyScore = Math.round(Math.max(10, Math.min(99, rawSafetyScore * 100)));

  // Lit percentage for UI
  const litPercent = hasLightingData ? verifiedLitPercent : estimatedLitPercent;

  // Data Confidence: track known vs missing data explicitly
  // High confidence (>0.75) when lit tags and opening_hours exist
  // Lower confidence (~0.35-0.50) when relying on road-type and daytime defaults
  let dataConfidence = 0.40;
  if (hasLightingData) {
    dataConfidence += 0.35 * (totalExplicitKnownLightingSamples / sampleCount);
  }
  if (activityNodes.length > 0) {
    dataConfidence += 0.20;
  }
  if (osmElements.length > 20) {
    dataConfidence += 0.05;
  }
  dataConfidence = Math.min(1.0, Math.max(0.35, dataConfidence));

  // Generate color-coded segments along route
  const segments: SegmentScore[] = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    const midLat = (p1[1] + p2[1]) / 2;
    const midLng = (p1[0] + p2[0]) / 2;

    let closestPt = sampledPoints[0];
    let minD = Infinity;
    for (const sp of sampledPoints) {
      const d = getDistanceMeters(midLat, midLng, sp.lat, sp.lng);
      if (d < minD) {
        minD = d;
        closestPt = sp;
      }
    }

    const segScore = closestPt ? closestPt.pointScore : safetyScore;

    let color = '#22c55e'; // Safe Green (> 70)
    if (segScore < 45) {
      color = '#ef4444';   // Unsafe Red (< 45)
    } else if (segScore < 70) {
      color = '#f59e0b';   // Caution Amber (45 - 70)
    }

    segments.push({
      from: p1,
      to: p2,
      score: segScore,
      color,
      lighting: closestPt?.isLit === true ? 'lit' : closestPt?.isLit === false ? 'unlit' : 'unknown',
      roadType: closestPt?.nearestRoadType || 'residential',
      havenNearby: closestPt?.hasHavenWithin100m || false,
      incidentNearby: (closestPt?.incidentPenalty || 0) > 0.1,
    });
  }

  // Compute breakdown and summary string from real passed open places
  const passedPlaces = Array.from(passedPlacesMap.values());
  const openPlacesBreakdown: Record<string, number> = {};
  for (const p of passedPlaces) {
    const key = p.subcategory || 'place';
    openPlacesBreakdown[key] = (openPlacesBreakdown[key] || 0) + 1;
  }

  let openPlacesSummary = '';
  if (passedPlaces.length > 0) {
    const parts = Object.entries(openPlacesBreakdown).map(([sub, count]) => {
      const formattedSub = sub.replace(/_/g, ' ');
      return `${count} ${count === 1 ? formattedSub : `${formattedSub}s`}`;
    });
    openPlacesSummary = `Passes ${passedPlaces.length} open place${passedPlaces.length > 1 ? 's' : ''}: ${parts.join(', ')}`;
  } else {
    openPlacesSummary = 'No open businesses directly along this corridor';
  }

  return {
    routeIndex,
    rawDuration,
    rawDistance: Math.round(effectiveDistance),
    safetyScore,
    lightingScore: Number(lightingScore.toFixed(3)),
    activityScore: Number(activityScore.toFixed(3)),
    roadTypeScore: Number(roadTypeScore.toFixed(3)),
    havenProximityScore: Number(havenProximityScore.toFixed(3)),
    incidentPenalty: Number(incidentPenalty.toFixed(3)),
    litPercent,
    estimatedLitPercent,
    hasLightingData,
    unlitDistanceMeters: Math.round(unlitDistanceMeters),
    openPlacesCount: passedPlaces.length > 0 ? passedPlaces.length : openPlacesCountTotal,
    openPlacesBreakdown,
    openPlacesSummary,
    passedPlaces,
    openHavensPassedCount: passedHavensSet.size,
    longestHavenGapMeters: finalHavenGap,
    hasHavensNearby,
    nearbyIncidentsCount: nearbyIncidentsSet.size,
    dataConfidence: Number(dataConfidence.toFixed(2)),
    segments,
    sampledPoints,
  };
}

/**
 * Re-ranks candidate routes using personal weighting preferences
 * Combines SafetyScore with user speed/brevity preference
 */
export function rankRoutes(
  routes: ScoredRouteResult[],
  weights: SafetyWeights
): ScoredRouteResult[] {
  if (routes.length === 0) return [];

  const durations = routes.map(r => r.rawDuration);
  const minDur = Math.min(...durations);
  const maxDur = Math.max(...durations);
  const durRange = maxDur - minDur || 1;

  return [...routes].sort((a, b) => {
    const speedWeight = (weights.speed || 0) / 100;
    const safetyWeight = 1 - speedWeight * 0.5;

    const normSpeedA = 1 - ((a.rawDuration - minDur) / durRange);
    const normSpeedB = 1 - ((b.rawDuration - minDur) / durRange);

    const compositeA = a.safetyScore * safetyWeight + (normSpeedA * 100) * (speedWeight * 0.5);
    const compositeB = b.safetyScore * safetyWeight + (normSpeedB * 100) * (speedWeight * 0.5);

    return compositeB - compositeA;
  });
}
