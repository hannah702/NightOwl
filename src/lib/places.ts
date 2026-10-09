import opening_hours from 'opening_hours';
import { getDistanceMeters } from './scoring';

export type PlaceCategory = 'food_drink' | 'shop' | 'service' | 'hangout' | 'other';

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  subcategory: string; // 'cafe', 'pub', 'bar', 'restaurant', 'fast_food', 'convenience', 'supermarket', 'mall', 'pharmacy', 'atm', 'fuel', 'park', 'hospital', 'police', etc.
  lat: number;
  lng: number;
  openingHours?: string;
  openNow: boolean;
  closingTime?: string;
  isLateNight: boolean; // open past 10 PM (22:00)
  is24h: boolean;
  source: 'osm' | 'photon';
}

/**
 * Weights per place subcategory for pedestrian activity calculation
 */
export const PLACE_CATEGORY_WEIGHTS: Record<string, number> = {
  cafe: 1.0,
  restaurant: 1.0,
  convenience: 1.0,
  supermarket: 1.0,
  mall: 1.0,
  department_store: 1.0,
  bakery: 1.0,
  fast_food: 0.9,
  pharmacy: 0.9,
  atm: 0.9,
  fuel: 0.9,
  bar: 0.7,
  pub: 0.7,
  nightclub: 0.7,
  biergarten: 0.7,
  park: 1.0, // daytime 1.0, dark 0.2
  garden: 1.0,
  hospital: 1.0,
  police: 1.0,
  clinic: 0.9,
  bank: 0.8,
  transit: 0.8,
  bus_station: 0.8,
  library: 0.8,
  cinema: 0.8,
  hotel: 0.8,
  other: 0.5,
};

/**
 * Evaluates opening hours at a given date/time
 */
export function evaluateOpeningHours(
  rawHours: string | undefined,
  checkTime: Date
): {
  openNow: boolean;
  is24h: boolean;
  isLateNight: boolean;
  closingTime?: string;
  hasKnownHours: boolean;
} {
  if (!rawHours || !rawHours.trim()) {
    // Unknown hours
    return {
      openNow: true, // Default assumed open with reduced weight
      is24h: false,
      isLateNight: false,
      hasKnownHours: false,
    };
  }

  const str = rawHours.trim().toLowerCase();

  if (str === '24/7' || str === '00:00-24:00' || str === '00:00 - 24:00') {
    return {
      openNow: true,
      is24h: true,
      isLateNight: true,
      closingTime: 'Open 24/7',
      hasKnownHours: true,
    };
  }

  try {
    const oh = new opening_hours(rawHours);
    const isOpen = oh.getState(checkTime);

    // Check if open past 22:00 on checkTime date
    const lateNightCheck = new Date(checkTime);
    lateNightCheck.setHours(22, 30, 0, 0);
    const isLateNight = oh.getState(lateNightCheck);

    // Check next change
    let closingTime: string | undefined = undefined;
    try {
      const nextChange = typeof (oh as any).getNextChange === 'function' ? (oh as any).getNextChange(checkTime) : undefined;
      if (nextChange) {
        const h = nextChange.getHours();
        const m = nextChange.getMinutes();
        closingTime = `${isOpen ? 'Closes at' : 'Opens at'} ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
    } catch {}

    return {
      openNow: isOpen,
      is24h: false,
      isLateNight,
      closingTime,
      hasKnownHours: true,
    };
  } catch {
    // Regex heuristic fallback (e.g. "10:00-23:00" or "09:00 - 22:00")
    const match = str.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (match) {
      const openH = parseInt(match[1], 10);
      const openM = parseInt(match[2], 10);
      const closeH = parseInt(match[3], 10);
      const closeM = parseInt(match[4], 10);

      const curH = checkTime.getHours();
      const curM = checkTime.getMinutes();
      const curTotal = curH * 60 + curM;
      const openTotal = openH * 60 + openM;
      let closeTotal = closeH * 60 + closeM;

      let isOpen = false;
      let isLate = closeH >= 22 || closeH < 4;

      if (closeTotal < openTotal) {
        // Overnight hours, e.g. 18:00 - 02:00
        isOpen = curTotal >= openTotal || curTotal <= closeTotal;
      } else {
        isOpen = curTotal >= openTotal && curTotal <= closeTotal;
      }

      return {
        openNow: isOpen,
        is24h: false,
        isLateNight: isLate,
        closingTime: `Closes at ${closeH.toString().padStart(2, '0')}:${closeM.toString().padStart(2, '0')}`,
        hasKnownHours: true,
      };
    }

    return {
      openNow: true,
      is24h: false,
      isLateNight: false,
      hasKnownHours: false,
    };
  }
}

/**
 * Determines whether a place qualifies as a verified Safe Haven
 */
export function isPlaceSafeHaven(
  place: Place,
  checkTime: Date,
  countBarsAsSafeStops: boolean = false
): boolean {
  if (!place.openNow) return false;

  const sub = place.subcategory.toLowerCase();

  // Always staffed emergency & medical services
  if (sub === 'police' || sub === 'hospital') {
    return true;
  }

  // 24h or late-night pharmacies & fuel stations
  if (sub === 'pharmacy' || sub === 'fuel') {
    return place.is24h || place.isLateNight || place.openNow;
  }

  // 24h convenience stores & supermarkets
  if ((sub === 'convenience' || sub === 'supermarket') && (place.is24h || place.isLateNight)) {
    return true;
  }

  // Staffed hotels with 24h reception
  if (sub === 'hotel' && (place.is24h || place.isLateNight)) {
    return true;
  }

  // ATMs inside monitored bank branches
  if (sub === 'atm' && (place.is24h || place.isLateNight)) {
    return true;
  }

  // Bars and pubs only if explicitly enabled by user in settings
  if ((sub === 'pub' || sub === 'bar' || sub === 'nightclub')) {
    return countBarsAsSafeStops && place.openNow;
  }

  return false;
}

/**
 * Maps OSM tag combinations to normalized Category and Subcategory
 */
export function categorizeOsmTags(tags: Record<string, string>): { category: PlaceCategory; subcategory: string } {
  const amenity = tags.amenity || '';
  const shop = tags.shop || '';
  const leisure = tags.leisure || '';
  const tourism = tags.tourism || '';
  const highway = tags.highway || '';
  const railway = tags.railway || '';

  if (['cafe', 'restaurant', 'fast_food', 'pub', 'bar', 'biergarten', 'ice_cream', 'food_court', 'nightclub'].includes(amenity)) {
    return { category: 'food_drink', subcategory: amenity };
  }

  if (shop) {
    if (['convenience', 'supermarket', 'mall', 'department_store', 'kiosk', 'bakery', 'chemist', 'general'].includes(shop)) {
      return { category: 'shop', subcategory: shop };
    }
    return { category: 'shop', subcategory: 'retail' };
  }

  if (['pharmacy', 'atm', 'bank', 'fuel', 'clinic', 'hospital', 'police', 'bus_station', 'marketplace'].includes(amenity)) {
    return { category: 'service', subcategory: amenity };
  }
  if (highway === 'bus_stop' || railway === 'station' || railway === 'subway_entrance') {
    return { category: 'service', subcategory: 'transit' };
  }

  if (['park', 'garden', 'fitness_centre', 'sports_centre'].includes(leisure)) {
    return { category: 'hangout', subcategory: leisure };
  }
  if (['attraction', 'hotel', 'hostel'].includes(tourism)) {
    return { category: 'hangout', subcategory: tourism };
  }
  if (['cinema', 'library', 'community_centre', 'place_of_worship'].includes(amenity)) {
    return { category: 'hangout', subcategory: amenity };
  }

  return { category: 'other', subcategory: amenity || shop || 'place' };
}

/**
 * Normalizes an OSM element (node, way, relation) into a Place
 */
export function normalizeOsmElementToPlace(el: any, checkTime: Date): Place | null {
  const tags = el.tags || {};
  const name = tags.name || tags['name:en'] || tags.brand;
  if (!name) return null;

  let lat = el.lat;
  let lng = el.lon;

  // Ways and relations use center
  if (lat === undefined || lng === undefined) {
    if (el.center) {
      lat = el.center.lat;
      lng = el.center.lon;
    }
  }

  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
    return null;
  }

  const { category, subcategory } = categorizeOsmTags(tags);
  const rawHours = tags.opening_hours;
  const hoursEval = evaluateOpeningHours(rawHours, checkTime);

  return {
    id: `osm-${el.type || 'n'}-${el.id}`,
    name,
    category,
    subcategory,
    lat,
    lng,
    openingHours: rawHours,
    openNow: hoursEval.openNow,
    closingTime: hoursEval.closingTime,
    isLateNight: hoursEval.isLateNight,
    is24h: hoursEval.is24h,
    source: 'osm',
  };
}

/**
 * Subcategory display labels and icons
 */
export const NEARBY_CHIPS = [
  { id: 'cafe', label: 'Cafes', icon: 'Coffee', subcategories: ['cafe'] },
  { id: 'restaurant', label: 'Restaurants', icon: 'Utensils', subcategories: ['restaurant'] },
  { id: 'pub_bar', label: 'Pubs & Bars', icon: 'Beer', subcategories: ['pub', 'bar', 'biergarten', 'nightclub'] },
  { id: 'fast_food', label: 'Fast Food', icon: 'Pizza', subcategories: ['fast_food'] },
  { id: 'convenience', label: 'Convenience', icon: 'ShoppingBag', subcategories: ['convenience', 'kiosk', 'general'] },
  { id: 'pharmacy', label: 'Pharmacy', icon: 'Pill', subcategories: ['pharmacy', 'chemist'] },
  { id: 'atm', label: 'ATM', icon: 'Banknote', subcategories: ['atm', 'bank'] },
  { id: 'fuel', label: 'Fuel', icon: 'Fuel', subcategories: ['fuel'] },
  { id: 'park', label: 'Parks', icon: 'Trees', subcategories: ['park', 'garden'] },
  { id: 'mall', label: 'Malls', icon: 'Building2', subcategories: ['mall', 'supermarket', 'department_store'] },
];
