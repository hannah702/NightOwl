import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Shield,
  Sliders,
  Clock,
  MapPin,
  AlertTriangle,
  Layers,
  Building,
  PlusCircle,
  HelpCircle,
  ChevronUp,
  ChevronDown,
  Navigation,
  RefreshCw,
  Check,
} from 'lucide-react';
import { Map } from './components/Map';
import { SearchBar } from './components/SearchBar';
import { RouteCard } from './components/RouteCard';
import { RouteBreakdownModal } from './components/RouteBreakdownModal';
import { WeightingPanel } from './components/WeightingPanel';
import { ReportIncidentModal } from './components/ReportIncidentModal';
import { OnboardingModal } from './components/OnboardingModal';
import { LiveWalkMode } from './components/LiveWalkMode';
import { SpectatorLiveView } from './components/SpectatorLiveView';
import { TimePicker } from './components/TimePicker';
import { ZoneManagerModal } from './components/ZoneManagerModal';

import {
  fetchCandidateWalkingRoutes,
  reverseGeocode,
  RouteOption,
  isPointInPolygon,
} from './lib/routing';
import {
  scoreRouteSafety,
  rankRoutes,
  SafetyWeights,
  ScoredRouteResult,
  CrowdsourcedReport,
  SafeHaven,
  OsmElement,
} from './lib/scoring';
import { fetchCorridorOsmData } from './lib/osm';
import { Place } from './lib/places';
import { CampusZone } from './types/zones';
import initialZonesJson from './data/zones.json';

const DEFAULT_WEIGHTS: SafetyWeights = {
  lighting: 35,
  activity: 25,
  speed: 10,
  havens: 20,
  incidents: 20,
};

export function App() {
  // Spectator Session from URL param ?share=XYZ
  const [spectatorSessionId, setSpectatorSessionId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareParam = params.get('share');
    if (shareParam) {
      setSpectatorSessionId(shareParam);
    }
  }, []);

  // Generic Campus Zones State
  const [zones, setZones] = useState<CampusZone[]>(() => {
    try {
      const saved = localStorage.getItem('safewalk_campus_zones');
      if (saved) return JSON.parse(saved);
      return Array.isArray(initialZonesJson) ? initialZonesJson : [];
    } catch {
      return [];
    }
  });

  const [zoneMode, setZoneMode] = useState<'auto' | 'off'>(() => {
    try {
      const saved = localStorage.getItem('safewalk_zone_mode');
      return (saved as 'auto' | 'off') || 'auto';
    } catch {
      return 'auto';
    }
  });

  const [isZoneManagerOpen, setIsZoneManagerOpen] = useState<boolean>(false);
  const [activeDrawingTarget, setActiveDrawingTarget] = useState<{
    zoneId: string;
    drawType: 'polygon' | 'gate' | 'restricted';
  } | null>(null);

  // Map Center: Default to Trivandrum (Palayam to East Fort test corridor)
  const [mapCenter, setMapCenter] = useState<[number, number]>([8.4980, 76.9485]);
  const [mapZoom, setMapZoom] = useState<number>(14);

  // Origin & Destination coordinates [lng, lat]
  const [originCoords, setOriginCoords] = useState<[number, number] | null>([76.9515, 8.5061]); // Palayam, Trivandrum
  const [originName, setOriginName] = useState<string>('Palayam, Thiruvananthapuram');
  const [destCoords, setDestCoords] = useState<[number, number] | null>([76.9455, 8.4837]); // East Fort, Trivandrum
  const [destName, setDestName] = useState<string>('East Fort, Thiruvananthapuram');

  // Candidate Routes (Network DATA stage)
  const [candidateRoutes, setCandidateRoutes] = useState<RouteOption[]>([]);
  const [corridorOsmElements, setCorridorOsmElements] = useState<OsmElement[]>([]);
  const [safeHavens, setSafeHavens] = useState<SafeHaven[]>([]);
  const [showHavens, setShowHavens] = useState<boolean>(true);

  // Places & Safe Stop Waypoint
  const [places, setPlaces] = useState<Place[]>([]);
  const [showPlaces, setShowPlaces] = useState<boolean>(true);
  const [safeStopWaypoint, setSafeStopWaypoint] = useState<[number, number] | null>(null); // [lng, lat]
  const [countBarsAsSafeStops, setCountBarsAsSafeStops] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nightowl_bars_havens') === 'true';
    } catch {
      return false;
    }
  });

  // Selected Route index
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState<boolean>(false);
  const [isRecalculatingScores, setIsRecalculatingScores] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);

  // TIME-AWARE ENGINE: Single source of truth is a valid Date
  const [selectedTime, setSelectedTime] = useState<Date>(() => new Date());
  const [showTimePicker, setShowTimePicker] = useState<boolean>(false);

  // Safe setter for selectedTime: rejects NaN and keeps previous valid date
  const handleUpdateSelectedTime = useCallback((newDate: Date) => {
    if (!newDate || isNaN(newDate.getTime())) {
      console.warn('Attempted to set invalid date to selectedTime, ignoring.');
      return;
    }
    // Show quick visual recalculating shimmer (<300 ms)
    setIsRecalculatingScores(true);
    setSelectedTime(new Date(newDate.getTime()));
    setTimeout(() => {
      setIsRecalculatingScores(false);
    }, 280);
  }, []);

  // Formatted header string with Intl.DateTimeFormat and safe fallback
  const formattedHeaderTime = useMemo(() => {
    if (!selectedTime || isNaN(selectedTime.getTime())) return 'Now';
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(selectedTime);
    } catch {
      return 'Now';
    }
  }, [selectedTime]);

  // User Weighting Preferences (persisted in localStorage)
  const [weights, setWeights] = useState<SafetyWeights>(() => {
    try {
      const saved = localStorage.getItem('safewalk_weights');
      return saved ? JSON.parse(saved) : DEFAULT_WEIGHTS;
    } catch {
      return DEFAULT_WEIGHTS;
    }
  });
  const [showWeightsPanel, setShowWeightsPanel] = useState<boolean>(false);

  // Crowdsourced Reports Layer
  const [reports, setReports] = useState<CrowdsourcedReport[]>([]);
  const [showReports, setShowReports] = useState<boolean>(true);

  // Modals & Mode Controls
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(() => {
    return !localStorage.getItem('safewalk_onboarded');
  });
  const [breakdownModalOpen, setBreakdownModalOpen] = useState<boolean>(false);
  const [reportModalOpen, setReportModalOpen] = useState<boolean>(false);
  const [reportDraftCoords, setReportDraftCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Map Click Target Mode
  const [clickMode, setClickMode] = useState<'none' | 'origin' | 'destination' | 'report'>('none');

  // Live Walk Mode
  const [isLiveWalkActive, setIsLiveWalkActive] = useState<boolean>(false);
  const [userLivePosition, setUserLivePosition] = useState<{ lat: number; lng: number; heading?: number } | null>(null);
  const [isLocatingUser, setIsLocatingUser] = useState<boolean>(false);

  // Mobile Bottom Sheet state
  const [isSheetCollapsed, setIsSheetCollapsed] = useState<boolean>(false);

  // Active Zone detection: ONLY active if route starts or ends inside the zone
  const activeZone = useMemo(() => {
    if (zoneMode === 'off' || zones.length === 0 || !originCoords) return null;
    return zones.find(z =>
      isPointInPolygon([originCoords[1], originCoords[0]], z.polygon) ||
      (destCoords ? isPointInPolygon([destCoords[1], destCoords[0]], z.polygon) : false)
    ) || null;
  }, [zones, zoneMode, originCoords, destCoords]);

  // Save weights to localStorage
  const handleWeightsChange = (newWeights: SafetyWeights) => {
    setWeights(newWeights);
    try {
      localStorage.setItem('safewalk_weights', JSON.stringify(newWeights));
    } catch (e) {}
  };

  // Save zones
  const handleSaveZones = (newZones: CampusZone[]) => {
    setZones(newZones);
    try {
      localStorage.setItem('safewalk_campus_zones', JSON.stringify(newZones));
    } catch (e) {}
  };

  // Toggle zone mode
  const handleToggleZoneMode = () => {
    const nextMode = zoneMode === 'auto' ? 'off' : 'auto';
    setZoneMode(nextMode);
    try {
      localStorage.setItem('safewalk_zone_mode', nextMode);
    } catch (e) {}
  };

  // Drawing points onto a zone polygon
  const handleDrawPoint = (lat: number, lng: number) => {
    if (!activeDrawingTarget) return;
    const { zoneId, drawType } = activeDrawingTarget;

    const updated = zones.map(z => {
      if (z.id !== zoneId) return z;
      if (drawType === 'polygon') {
        return {
          ...z,
          polygon: [...z.polygon, [lat, lng] as [number, number]],
        };
      }
      return z;
    });

    handleSaveZones(updated);
  };

  // Close onboarding
  const handleCloseOnboarding = () => {
    setOnboardingOpen(false);
    try {
      localStorage.setItem('safewalk_onboarded', 'true');
    } catch (e) {}
  };

  const handleToggleCountBarsAsSafeStops = (val: boolean) => {
    setCountBarsAsSafeStops(val);
    try {
      localStorage.setItem('nightowl_bars_havens', String(val));
    } catch {}
  };

  const handleSetSafeStop = (place: Place) => {
    setSafeStopWaypoint([place.lng, place.lat]);
  };

  const handleClearSafeStop = () => {
    setSafeStopWaypoint(null);
  };

  const handleNavigateToPlace = (place: Place) => {
    setDestCoords([place.lng, place.lat]);
    setDestName(place.name);
  };

  // Load Crowdsourced Reports
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch('/api/reports');
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch (err) {
      console.warn('Could not fetch community reports:', err);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Vote on a report
  const handleVoteReport = async (reportId: string, vote: 'confirm' | 'dismiss') => {
    try {
      const res = await fetch(`/api/reports/${reportId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote }),
      });
      if (res.ok) {
        fetchReports();
      }
    } catch (err) {
      console.warn('Voting failed:', err);
    }
  };

  // -------------------------------------------------------------
  // STAGE A: DATA STAGE
  // Fetches routes (OSRM) and OSM corridor data (Overpass) ONCE.
  // Cached by origin/dest coordinates and zone layout.
  // Changing time or weights DOES NOT refetch network data!
  // -------------------------------------------------------------
  useEffect(() => {
    if (!originCoords || !destCoords) {
      setCandidateRoutes([]);
      setCorridorOsmElements([]);
      setSafeHavens([]);
      return;
    }

    let isCancelled = false;

    async function fetchDataPipeline() {
      setIsLoadingRoutes(true);
      setRouteError(null);

      try {
        // 1. Fetch Candidate Walking Routes (strictly origin and dest, plus safeStopWaypoint if set)
        const routes = await fetchCandidateWalkingRoutes(
          originCoords!,
          destCoords!,
          selectedTime,
          zones,
          zoneMode,
          safeStopWaypoint
        );

        if (isCancelled) return;
        setCandidateRoutes(routes);

        // 2. Fetch corridor OpenStreetMap elements and Places (Overpass)
        const allCoords: [number, number][] = routes.flatMap(r => r.geometry.coordinates);
        const { elements, havens: osmHavens, places: osmPlaces } = await fetchCorridorOsmData(
          allCoords,
          selectedTime,
          countBarsAsSafeStops
        );

        if (isCancelled) return;
        setCorridorOsmElements(elements);
        setSafeHavens(osmHavens);
        setPlaces(osmPlaces);
      } catch (err: any) {
        console.error('Error during route data pipeline:', err);
        if (!isCancelled) {
          setRouteError(err?.message || 'Walking routing call timed out or failed.');
          setCandidateRoutes([]);
          setCorridorOsmElements([]);
          setSafeHavens([]);
          setPlaces([]);
        }
      } finally {
        if (!isCancelled) setIsLoadingRoutes(false);
      }
    }

    fetchDataPipeline();

    return () => {
      isCancelled = true;
    };
  }, [
    originCoords?.[0],
    originCoords?.[1],
    destCoords?.[0],
    destCoords?.[1],
    safeStopWaypoint?.[0],
    safeStopWaypoint?.[1],
    countBarsAsSafeStops,
    zoneMode,
    zones,
    retryTrigger,
  ]);

  // -------------------------------------------------------------
  // STAGE B: SCORING STAGE (Pure function in useMemo)
  // Re-evaluates instantly when selectedTime or weights change.
  // Reads from the single source of truth routeData + OSM elements.
  // -------------------------------------------------------------
  const scoredRoutes: ScoredRouteResult[] = useMemo(() => {
    if (candidateRoutes.length === 0) return [];

    const scored = candidateRoutes.map((r, idx) =>
      scoreRouteSafety({
        routeIndex: idx,
        coordinates: r.geometry.coordinates,
        rawDuration: r.duration,
        rawDistance: r.distance,
        weights,
        checkTime: selectedTime,
        osmElements: corridorOsmElements,
        safeHavens,
        places,
        incidentReports: reports,
        isInActiveZone: Boolean(activeZone),
        countBarsAsSafeStops,
      })
    );

    return rankRoutes(scored, weights);
  }, [
    candidateRoutes,
    corridorOsmElements,
    safeHavens,
    places,
    reports,
    selectedTime.getTime(),
    weights,
    Boolean(activeZone),
    countBarsAsSafeStops,
  ]);

  // Automatically select the highest-ranked route when routes update
  useEffect(() => {
    if (scoredRoutes.length > 0) {
      setSelectedRouteIndex(scoredRoutes[0].routeIndex);
    }
  }, [candidateRoutes]);

  // Handle Map Click based on active clickMode
  const handleMapClick = async (lat: number, lng: number) => {
    if (activeDrawingTarget) {
      handleDrawPoint(lat, lng);
      return;
    }

    if (clickMode === 'origin') {
      setOriginCoords([lng, lat]);
      setOriginName('Selected Origin Pin');
      const address = await reverseGeocode(lat, lng);
      setOriginName(address.split(',')[0]);
      setClickMode('none');
    } else if (clickMode === 'destination') {
      setDestCoords([lng, lat]);
      setDestName('Selected Destination Pin');
      const address = await reverseGeocode(lat, lng);
      setDestName(address.split(',')[0]);
      setClickMode('none');
    } else if (clickMode === 'report') {
      setReportDraftCoords({ lat, lng });
      setReportModalOpen(true);
      setClickMode('none');
    }
  };

  // GPS "Use My Location"
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported in this browser.');
      return;
    }

    setIsLocatingUser(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setOriginCoords([longitude, latitude]);
        setMapCenter([latitude, longitude]);
        const address = await reverseGeocode(latitude, longitude);
        setOriginName(address.split(',')[0] || 'My Location');
        setIsLocatingUser(false);
      },
      (err) => {
        setIsLocatingUser(false);
        alert(`Location access denied or unavailable: ${err.message}`);
      },
      { timeout: 8000 }
    );
  };

  // Swap Points
  const handleSwapPoints = () => {
    const tempCoords = originCoords;
    const tempName = originName;
    setOriginCoords(destCoords);
    setOriginName(destName);
    setDestCoords(tempCoords);
    setDestName(tempName);
  };

  // Submit crowdsourced report
  const handleSubmitReport = async (reportData: {
    lat: number;
    lng: number;
    type: CrowdsourcedReport['type'];
    note?: string;
  }) => {
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportData),
    });

    if (res.ok) {
      fetchReports();
      setReportDraftCoords(null);
    } else {
      throw new Error('Failed to save report');
    }
  };

  // If Spectator View is active, render spectator screen
  if (spectatorSessionId) {
    return (
      <SpectatorLiveView
        sessionId={spectatorSessionId}
        onExitSpectator={() => {
          window.history.replaceState({}, '', window.location.pathname);
          setSpectatorSessionId(null);
        }}
      />
    );
  }

  // Selected route and benchmark route
  const currentSelectedRoute = candidateRoutes[selectedRouteIndex];
  const currentScoredRoute = scoredRoutes.find(r => r.routeIndex === selectedRouteIndex);
  const safestRouteScored = scoredRoutes[0];
  const benchmarkRoute = safestRouteScored && candidateRoutes[safestRouteScored.routeIndex] ? {
    option: candidateRoutes[safestRouteScored.routeIndex],
    scored: safestRouteScored,
  } : undefined;

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* Top Floating App Bar */}
      <header className="relative z-20 p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Brand & Toggles */}
          <div className="w-full sm:w-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-950/50">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h1 className="text-base sm:text-lg font-black tracking-tight text-white">NightOwl</h1>
                </div>
                <p className="text-[10px] text-slate-400 hidden xs:block">
                  Safety-Ranked Walking Navigation
                </p>
              </div>
            </div>

            {/* Quick Action Badges */}
            <div className="flex items-center gap-1.5">
              {/* Campus Zones Modal Button */}
              <button
                onClick={() => setIsZoneManagerOpen(true)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 cursor-pointer"
                title="Manage custom campus boundaries & operating gates"
              >
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Zones</span>
                {zones.length > 0 && (
                  <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-1 rounded-full font-mono">
                    {zones.length}
                  </span>
                )}
              </button>

              {/* Campus Auto-Detect / Off Toggle */}
              <button
                onClick={handleToggleZoneMode}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border cursor-pointer ${
                  zoneMode === 'auto'
                    ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                }`}
                title={`Campus Mode: ${zoneMode === 'auto' ? 'Auto-Detect (Active when route crosses a zone)' : 'Off (Pure global walking mode)'}`}
              >
                <Building className="w-3.5 h-3.5" />
                <span>{zoneMode === 'auto' ? 'Auto' : 'Off'}</span>
              </button>

              {/* Time Picker Toggle (Always valid formatted string, never "Invalid Date") */}
              <button
                onClick={() => setShowTimePicker(!showTimePicker)}
                className={`p-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition border cursor-pointer ${
                  showTimePicker
                    ? 'bg-sky-600/30 border-sky-500 text-sky-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Adjust walk time (scores update instantly)"
              >
                <Clock className="w-4 h-4 text-sky-400" />
                <span className="hidden sm:inline font-mono">
                  {formattedHeaderTime}
                </span>
              </button>

              {/* Weights Button */}
              <button
                onClick={() => setShowWeightsPanel(!showWeightsPanel)}
                className={`p-2 rounded-xl text-xs font-semibold flex items-center gap-1 transition border cursor-pointer ${
                  showWeightsPanel
                    ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Personal safety weights"
              >
                <Sliders className="w-4 h-4 text-emerald-400" />
              </button>

              {/* Report Concern Pin */}
              <button
                onClick={() => {
                  setClickMode('report');
                }}
                className="px-2.5 py-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-400 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                title="Report dark area or incident"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Report</span>
              </button>

              {/* Onboarding Help */}
              <button
                onClick={() => setOnboardingOpen(true)}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
                title="How NightOwl Works"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search Inputs */}
          <div className="w-full sm:flex-1 sm:max-w-xl">
            <SearchBar
              originText={originName}
              destinationText={destName}
              onSelectOrigin={(name, coords) => {
                setOriginName(name);
                setOriginCoords(coords);
              }}
              onSelectDestination={(name, coords) => {
                setDestName(name);
                setDestCoords(coords);
              }}
              onSwapPoints={handleSwapPoints}
              onUseCurrentLocation={handleUseCurrentLocation}
              isLocatingUser={isLocatingUser}
              nearCenter={{ lat: mapCenter[0], lng: mapCenter[1] }}
              onPickFromMap={(target) => setClickMode(target)}
              activeClickMode={clickMode}
              checkTime={selectedTime}
              hasSafeStop={Boolean(safeStopWaypoint)}
              onClearSafeStop={handleClearSafeStop}
            />
          </div>
        </div>

        {/* Floating Time Picker Dropdown */}
        {showTimePicker && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-40 w-full max-w-sm px-4">
            <TimePicker
              selectedTime={selectedTime}
              onChangeTime={handleUpdateSelectedTime}
            />
          </div>
        )}
      </header>

      {/* Drawing Mode Banner */}
      {activeDrawingTarget && (
        <div className="bg-indigo-950/90 border-b border-indigo-700/60 px-4 py-2 text-xs flex items-center justify-between z-20 text-indigo-200">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping"></span>
            <span>
              <strong>Drawing {activeDrawingTarget.drawType}:</strong> Click on the map to add boundary points.
            </span>
          </div>
          <button
            onClick={() => {
              setActiveDrawingTarget(null);
              setIsZoneManagerOpen(true);
            }}
            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold flex items-center gap-1 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" /> Done Drawing
          </button>
        </div>
      )}

      {/* Main Map & Interface Viewport */}
      <main className="flex-1 relative overflow-hidden flex flex-col md:flex-row">
        {/* Left Side Route Panel (Desktop) / Sliding Bottom Sheet (Mobile) */}
        <aside
          className={`absolute md:relative z-20 bottom-0 left-0 right-0 md:bottom-auto md:left-auto md:right-auto md:w-96 lg:w-[420px] max-h-[62vh] md:max-h-full flex flex-col bg-slate-950/95 md:bg-slate-950/90 backdrop-blur-xl border-t md:border-t-0 md:border-r border-slate-800 shadow-2xl transition-all duration-300 ${
            isSheetCollapsed ? 'translate-y-[calc(100%-48px)] md:translate-y-0' : 'translate-y-0'
          }`}
        >
          {/* Mobile Sheet Drag Handle */}
          <div
            onClick={() => setIsSheetCollapsed(!isSheetCollapsed)}
            className="md:hidden p-2 flex items-center justify-between text-slate-400 cursor-pointer border-b border-slate-800/80 px-4"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-semibold text-slate-200">
                {candidateRoutes.length > 0
                  ? `${candidateRoutes.length} Walking Routes Found`
                  : 'NightOwl Route Search'}
              </span>
            </div>
            <button className="p-1 text-slate-400 hover:text-white">
              {isSheetCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {/* Personal Weighting Panel Drawer */}
          <div className="p-3 pb-0">
            <WeightingPanel
              weights={weights}
              onChangeWeights={handleWeightsChange}
              isOpen={showWeightsPanel}
              onToggleOpen={() => setShowWeightsPanel(!showWeightsPanel)}
              countBarsAsSafeStops={countBarsAsSafeStops}
              onToggleCountBarsAsSafeStops={handleToggleCountBarsAsSafeStops}
            />
          </div>

          {/* Candidate Routes Scrollable List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {isLoadingRoutes ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-3">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                <div className="text-xs font-medium text-slate-300">
                  Scoring route corridor via OpenStreetMap & Overpass...
                </div>
                <div className="text-[11px] text-slate-500">
                  Evaluating street lighting, havens & open businesses
                </div>
              </div>
            ) : routeError ? (
              <div className="py-8 px-4 text-center space-y-3 bg-rose-950/40 border border-rose-500/40 rounded-2xl p-4 shadow-xl">
                <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-400 mx-auto flex items-center justify-center border border-rose-500/30">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="text-sm font-bold text-white">Route Calculation Notice</div>
                <p className="text-xs text-rose-200/90 leading-relaxed max-w-xs mx-auto">
                  {routeError}
                </p>
                <div className="pt-1">
                  <button
                    onClick={() => setRetryTrigger(c => c + 1)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-rose-950/60 inline-flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Route Search
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 pt-1">
                  Tip: Ensure origin and destination are walkable and within 60 km.
                </p>
              </div>
            ) : candidateRoutes.length === 0 ? (
              <div className="py-10 text-center text-slate-400 space-y-2">
                <MapPin className="w-8 h-8 text-slate-600 mx-auto" />
                <div className="text-sm font-semibold text-slate-300">No Routes Loaded</div>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Select an origin and destination above or click anywhere on the map to start navigation.
                </p>
              </div>
            ) : (
              scoredRoutes.map((scoredItem, index) => {
                const routeOpt = candidateRoutes[scoredItem.routeIndex];
                if (!routeOpt) return null;
                return (
                  <RouteCard
                    key={routeOpt.id || index}
                    route={routeOpt}
                    scored={scoredItem}
                    isSelected={scoredItem.routeIndex === selectedRouteIndex}
                    onSelect={() => setSelectedRouteIndex(scoredItem.routeIndex)}
                    onOpenBreakdown={() => setBreakdownModalOpen(true)}
                    onStartLiveWalk={() => setIsLiveWalkActive(true)}
                    timeString={formattedHeaderTime}
                    isCampusMode={Boolean(activeZone)}
                    isRecalculating={isRecalculatingScores}
                    benchmarkRoute={benchmarkRoute}
                  />
                );
              })
            )}
          </div>

          {/* Map Layer Controls in Bottom Sheet */}
          <div className="p-3 border-t border-slate-800/80 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPlaces}
                  onChange={(e) => setShowPlaces(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0"
                />
                <span>Places</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showHavens}
                  onChange={(e) => setShowHavens(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0"
                />
                <span>Safe Havens</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showReports}
                  onChange={(e) => setShowReports(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-800 text-amber-500 focus:ring-0"
                />
                <span>Incident Reports</span>
              </label>
            </div>

            <div className="text-[11px] text-slate-500 font-mono">
              {places.length} places • {safeHavens.length} havens • {reports.length} reports
            </div>
          </div>
        </aside>

        {/* Center / Right: Interactive Map Canvas */}
        <section className="flex-1 h-full relative">
          <Map
            center={mapCenter}
            zoom={mapZoom}
            origin={originCoords ? [originCoords[1], originCoords[0]] : null}
            destination={destCoords ? [destCoords[1], destCoords[0]] : null}
            routes={candidateRoutes}
            scoredRoutes={scoredRoutes}
            selectedRouteIndex={selectedRouteIndex}
            onSelectRoute={(idx) => setSelectedRouteIndex(idx)}
            safeHavens={safeHavens}
            showHavens={showHavens}
            onToggleHavens={() => setShowHavens(prev => !prev)}
            places={places}
            showPlaces={showPlaces}
            onTogglePlaces={() => setShowPlaces(prev => !prev)}
            onNavigateToPlace={handleNavigateToPlace}
            onSetSafeStop={handleSetSafeStop}
            safeStopWaypoint={safeStopWaypoint}
            reports={reports}
            showReports={showReports}
            onToggleReports={() => setShowReports(prev => !prev)}
            onVoteReport={handleVoteReport}
            zones={zones}
            activeZone={activeZone}
            zoneMode={zoneMode}
            checkTime={selectedTime}
            userLivePosition={userLivePosition}
            clickMode={clickMode}
            onMapClick={handleMapClick}
            reportPinDraft={reportDraftCoords}
            drawingTarget={activeDrawingTarget}
            onDrawPoint={handleDrawPoint}
            onFinishDrawing={() => setActiveDrawingTarget(null)}
          />

          {/* Legend Overlay */}
          <div className="absolute top-4 right-4 z-10 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-2.5 shadow-xl text-[11px] space-y-1.5 pointer-events-auto">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Segment Heatmap
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-1.5 rounded-full bg-[#22c55e]"></span>
              <span className="text-slate-200">Safe / Well-Lit (&gt; 70)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-1.5 rounded-full bg-[#f59e0b]"></span>
              <span className="text-slate-200">Moderate Caution (45–70)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-1.5 rounded-full bg-[#ef4444]"></span>
              <span className="text-slate-200">Unlit / Isolated (&lt; 45)</span>
            </div>
          </div>
        </section>
      </main>

      {/* Live Walk Mode HUD Overlay */}
      {isLiveWalkActive && currentSelectedRoute && currentScoredRoute && (
        <LiveWalkMode
          route={currentSelectedRoute}
          scored={currentScoredRoute}
          onStopWalk={() => setIsLiveWalkActive(false)}
          onReroute={(currentCoords) => {
            setOriginCoords(currentCoords);
            setOriginName('Current GPS Position');
          }}
          onUpdateUserLocation={(loc) => setUserLivePosition(loc)}
        />
      )}

      {/* Sub-Score Breakdown Modal - Synchronized strictly with currentScoredRoute */}
      {breakdownModalOpen && currentSelectedRoute && currentScoredRoute && (
        <RouteBreakdownModal
          isOpen={breakdownModalOpen}
          onClose={() => setBreakdownModalOpen(false)}
          route={currentSelectedRoute}
          scored={currentScoredRoute}
          weights={weights}
          timeString={formattedHeaderTime}
        />
      )}

      {/* Campus Zones Manager Modal */}
      {isZoneManagerOpen && (
        <ZoneManagerModal
          isOpen={isZoneManagerOpen}
          onClose={() => setIsZoneManagerOpen(false)}
          zones={zones}
          onSaveZones={handleSaveZones}
          onStartMapDraw={(zoneId, drawType) => {
            setActiveDrawingTarget({ zoneId, drawType });
            setIsZoneManagerOpen(false);
          }}
          activeDrawingTarget={activeDrawingTarget}
        />
      )}

      {/* Report Incident Modal */}
      {reportModalOpen && (
        <ReportIncidentModal
          isOpen={reportModalOpen}
          onClose={() => {
            setReportModalOpen(false);
            setReportDraftCoords(null);
          }}
          coordinates={reportDraftCoords}
          onSubmitReport={handleSubmitReport}
          onSelectPinOnMap={() => {
            setReportModalOpen(false);
            setClickMode('report');
          }}
        />
      )}

      {/* Welcome / Onboarding Modal */}
      {onboardingOpen && (
        <OnboardingModal
          isOpen={onboardingOpen}
          onClose={handleCloseOnboarding}
        />
      )}
    </div>
  );
}

export default App;
