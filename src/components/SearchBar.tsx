import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  MapPin,
  Navigation,
  ArrowUpDown,
  X,
  Loader2,
  Coffee,
  Beer,
  Utensils,
  Pizza,
  ShoppingBag,
  Pill,
  Banknote,
  Fuel,
  Trees,
  Building2,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { searchPlaces, GeocodeResult } from '../lib/routing';
import { NEARBY_CHIPS, Place } from '../lib/places';
import { fetchNearbyPlacesForCategory } from '../lib/osm';

interface SearchBarProps {
  originText: string;
  destinationText: string;
  onSelectOrigin: (name: string, coords: [number, number]) => void;
  onSelectDestination: (name: string, coords: [number, number]) => void;
  onSwapPoints: () => void;
  onUseCurrentLocation: () => void;
  isLocatingUser: boolean;
  nearCenter?: { lat: number; lng: number };
  onPickFromMap: (target: 'origin' | 'destination') => void;
  activeClickMode: 'none' | 'origin' | 'destination' | 'report';
  checkTime?: Date;
  onClearSafeStop?: () => void;
  hasSafeStop?: boolean;
}

// Map place type or subcategory to a corresponding icon
export function getPlaceTypeIcon(type?: string, category?: string) {
  const t = (type || category || '').toLowerCase();
  if (t.includes('cafe') || t.includes('coffee')) {
    return <Coffee className="w-4 h-4 text-amber-400" />;
  }
  if (t.includes('beer') || t.includes('pub') || t.includes('bar') || t.includes('nightclub')) {
    return <Beer className="w-4 h-4 text-yellow-400" />;
  }
  if (t.includes('restaurant') || t.includes('food_court') || t.includes('biergarten')) {
    return <Utensils className="w-4 h-4 text-emerald-400" />;
  }
  if (t.includes('fast_food') || t.includes('pizza') || t.includes('burger')) {
    return <Pizza className="w-4 h-4 text-orange-400" />;
  }
  if (t.includes('shop') || t.includes('convenience') || t.includes('supermarket') || t.includes('bakery') || t.includes('kiosk')) {
    return <ShoppingBag className="w-4 h-4 text-cyan-400" />;
  }
  if (t.includes('pharmacy') || t.includes('chemist') || t.includes('hospital') || t.includes('clinic')) {
    return <Pill className="w-4 h-4 text-rose-400" />;
  }
  if (t.includes('atm') || t.includes('bank')) {
    return <Banknote className="w-4 h-4 text-emerald-300" />;
  }
  if (t.includes('fuel') || t.includes('petrol')) {
    return <Fuel className="w-4 h-4 text-amber-500" />;
  }
  if (t.includes('park') || t.includes('garden') || t.includes('nature') || t.includes('trees')) {
    return <Trees className="w-4 h-4 text-emerald-400" />;
  }
  if (t.includes('mall') || t.includes('department_store') || t.includes('commercial')) {
    return <Building2 className="w-4 h-4 text-indigo-400" />;
  }
  return <MapPin className="w-4 h-4 text-slate-400" />;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  originText,
  destinationText,
  onSelectOrigin,
  onSelectDestination,
  onSwapPoints,
  onUseCurrentLocation,
  isLocatingUser,
  nearCenter,
  onPickFromMap,
  activeClickMode,
  checkTime = new Date(),
  onClearSafeStop,
  hasSafeStop,
}) => {
  const [activeInput, setActiveInput] = useState<'origin' | 'destination' | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);

  // Nearby Chips drawer state
  const [activeNearbyChip, setActiveNearbyChip] = useState<string | null>(null);
  const [nearbyPlaces, setNearbyPlaces] = useState<Place[]>([]);
  const [isLoadingNearby, setIsLoadingNearby] = useState(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputContainerRef = useRef<HTMLDivElement | null>(null);

  // Layered Search effect with 300ms debounce and AbortController
  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setSuggestions([]);
      setHasSearched(false);
      setSelectedIndex(-1);
      return;
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();

    debounceTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const results = await searchPlaces(query, nearCenter, controller.signal);
        setSuggestions(results);
        setHasSearched(true);
        setSelectedIndex(-1);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Search request failed:', err);
        }
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [query, nearCenter]);

  // Keyboard navigation for suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        handleSelectSuggestion(suggestions[selectedIndex]);
      } else if (suggestions.length > 0) {
        handleSelectSuggestion(suggestions[0]);
      }
    } else if (e.key === 'Escape') {
      setActiveInput(null);
      setSuggestions([]);
    }
  };

  const handleSelectSuggestion = (item: GeocodeResult) => {
    const cleanName = item.displayName.split(',')[0].trim();
    if (activeInput === 'origin') {
      onSelectOrigin(cleanName, [item.lng, item.lat]);
    } else if (activeInput === 'destination') {
      onSelectDestination(cleanName, [item.lng, item.lat]);
    }
    setActiveInput(null);
    setQuery('');
    setSuggestions([]);
    setSelectedIndex(-1);
  };

  // Nearby Chip click handler
  const handleChipClick = async (chipId: string, subcategories: string[]) => {
    if (activeNearbyChip === chipId) {
      setActiveNearbyChip(null);
      setNearbyPlaces([]);
      return;
    }

    setActiveNearbyChip(chipId);
    setIsLoadingNearby(true);
    setActiveInput(null);

    const lat = nearCenter?.lat || 26.9124;
    const lng = nearCenter?.lng || 75.7873;

    try {
      // Fetch via category search around map centre
      const results = await fetchNearbyPlacesForCategory(lat, lng, subcategories, checkTime);
      setNearbyPlaces(results);
    } catch {
      setNearbyPlaces([]);
    } finally {
      setIsLoadingNearby(false);
    }
  };

  const handleSelectNearbyPlace = (place: Place) => {
    onSelectDestination(place.name, [place.lng, place.lat]);
    setActiveNearbyChip(null);
    setNearbyPlaces([]);
  };

  return (
    <div ref={inputContainerRef} className="relative w-full max-w-xl mx-auto z-40">
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl p-3 shadow-2xl transition-all">
        <div className="flex items-center gap-2">
          {/* Inputs Column */}
          <div className="flex-1 space-y-2">
            {/* Origin Input */}
            <div className="relative flex items-center">
              <span className="w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 ml-2.5 mr-3 shrink-0" />
              <input
                type="text"
                placeholder="Starting location or 'My Location'..."
                value={activeInput === 'origin' ? query : originText}
                onFocus={() => {
                  setActiveInput('origin');
                  setQuery(originText);
                  setActiveNearbyChip(null);
                }}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-slate-800/80 hover:bg-slate-800 text-slate-100 placeholder-slate-400 text-xs sm:text-sm rounded-xl py-2 px-3 pr-16 focus:outline-none focus:ring-2 focus:ring-emerald-500 border border-slate-700/60"
              />
              <div className="absolute right-2 flex items-center gap-1">
                {originText && (
                  <button
                    onClick={() => onSelectOrigin('', [0, 0])}
                    className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
                    title="Clear"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onPickFromMap('origin')}
                  className={`p-1.5 rounded-lg text-xs cursor-pointer ${
                    activeClickMode === 'origin' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                  title="Pick on map"
                >
                  <MapPin className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Destination Input */}
            <div className="relative flex items-center">
              <span className="w-3 h-3 rounded-full bg-rose-500 ring-4 ring-rose-500/20 ml-2.5 mr-3 shrink-0" />
              <input
                type="text"
                placeholder="Where to? (e.g. Cafe, Tapri, Metro, Mall, Pub)"
                value={activeInput === 'destination' ? query : destinationText}
                onFocus={() => {
                  setActiveInput('destination');
                  setQuery(destinationText);
                  setActiveNearbyChip(null);
                }}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-slate-800/80 hover:bg-slate-800 text-slate-100 placeholder-slate-400 text-xs sm:text-sm rounded-xl py-2 px-3 pr-16 focus:outline-none focus:ring-2 focus:ring-rose-500 border border-slate-700/60"
              />
              <div className="absolute right-2 flex items-center gap-1">
                {destinationText && (
                  <button
                    onClick={() => onSelectDestination('', [0, 0])}
                    className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
                    title="Clear"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onPickFromMap('destination')}
                  className={`p-1.5 rounded-lg text-xs cursor-pointer ${
                    activeClickMode === 'destination' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                  title="Pick on map"
                >
                  <MapPin className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Action buttons on right */}
          <div className="flex flex-col gap-1.5 pl-1 shrink-0">
            <button
              onClick={onSwapPoints}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition cursor-pointer"
              title="Swap origin & destination"
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
            <button
              onClick={onUseCurrentLocation}
              disabled={isLocatingUser}
              className="p-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 transition flex items-center justify-center cursor-pointer"
              title="Use current GPS location"
            >
              {isLocatingUser ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              ) : (
                <Navigation className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Safe Stop Badge if Active */}
        {hasSafeStop && (
          <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-1.5 text-cyan-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="font-medium">Routing via active Safe Stop Waypoint</span>
            </div>
            {onClearSafeStop && (
              <button
                onClick={onClearSafeStop}
                className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3 h-3" /> Remove stop
              </button>
            )}
          </div>
        )}

        {/* Nearby Category Chips Row */}
        <div className="mt-2.5 pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider shrink-0 mr-1 hidden xs:inline">
              Nearby:
            </span>
            {NEARBY_CHIPS.map((chip) => {
              const isActive = activeNearbyChip === chip.id;
              return (
                <button
                  key={chip.id}
                  onClick={() => handleChipClick(chip.id, chip.subcategories)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-medium whitespace-nowrap transition cursor-pointer shrink-0 border ${
                    isActive
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md font-semibold'
                      : 'bg-slate-800/70 hover:bg-slate-800 text-slate-300 border-slate-700/60 hover:text-white'
                  }`}
                >
                  {getPlaceTypeIcon(chip.id)}
                  <span>{chip.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Auto-complete Suggestions Dropdown with Portal-like high z-index */}
      {activeInput && (isSearching || suggestions.length > 0 || hasSearched) && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-50 max-h-72 overflow-y-auto">
          {isSearching && (
            <div className="p-3 text-xs text-slate-400 flex items-center gap-2 border-b border-slate-800/50">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              Searching businesses & places...
            </div>
          )}

          {suggestions.length > 0 && (
            <div>
              {suggestions.map((item, idx) => {
                const isSelected = selectedIndex === idx;
                return (
                  <button
                    key={item.placeId}
                    onClick={() => handleSelectSuggestion(item)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-start gap-3 border-b border-slate-800/50 transition cursor-pointer ${
                      isSelected ? 'bg-slate-800 text-white ring-1 ring-emerald-500/50' : 'hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/60 mt-0.5 shrink-0">
                      {getPlaceTypeIcon(item.type, item.category)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs sm:text-sm font-bold text-slate-100 truncate">
                          {item.displayName}
                        </div>
                        {item.distanceMeters !== undefined && (
                          <span className="text-[10px] font-semibold text-emerald-400 shrink-0">
                            {item.distanceMeters < 1000
                              ? `${item.distanceMeters} m`
                              : `${(item.distanceMeters / 1000).toFixed(1)} km`}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-1">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!isSearching && hasSearched && suggestions.length === 0 && (
            <div className="p-4 text-center text-xs text-slate-400">
              <p className="font-semibold text-slate-300">No matching place found nearby</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Try adding the neighbourhood or city name (e.g. "{query}, Jaipur") or pick a spot directly on the map.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Nearby Chip Places List Dropdown */}
      {activeNearbyChip && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-50 max-h-80 overflow-y-auto">
          <div className="p-3 bg-slate-800/80 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              {getPlaceTypeIcon(activeNearbyChip)}
              <span>Nearby {NEARBY_CHIPS.find(c => c.id === activeNearbyChip)?.label}</span>
            </div>
            <button
              onClick={() => setActiveNearbyChip(null)}
              className="text-slate-400 hover:text-white p-1 rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {isLoadingNearby ? (
            <div className="p-6 text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              Finding nearest open spots...
            </div>
          ) : nearbyPlaces.length > 0 ? (
            <div className="divide-y divide-slate-800/60">
              {nearbyPlaces.map((place) => (
                <button
                  key={place.id}
                  onClick={() => handleSelectNearbyPlace(place)}
                  className="w-full text-left p-3 hover:bg-slate-800/80 flex items-center justify-between gap-3 transition cursor-pointer"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700/60 mt-0.5 shrink-0">
                      {getPlaceTypeIcon(place.subcategory, place.category)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-100 truncate">
                        {place.name}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${place.openNow ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                        <span>{place.openNow ? 'Open Now' : 'Closed'}</span>
                        {place.closingTime && <span>• {place.closingTime}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] font-semibold text-emerald-400 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      Set as Dest
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-5 text-center text-xs text-slate-400">
              No matching open places found in this immediate area. Try panning the map or searching by name.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
