import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import { ScoredRouteResult, SafeHaven, CrowdsourcedReport, isHavenOpen } from '../lib/scoring';
import { RouteOption, getGateStatus } from '../lib/routing';
import { CampusZone } from '../types/zones';
import { Place } from '../lib/places';

interface MapProps {
  center: [number, number]; // [lat, lng]
  zoom: number;
  origin: [number, number] | null; // [lat, lng]
  destination: [number, number] | null;
  routes: RouteOption[];
  scoredRoutes: ScoredRouteResult[];
  selectedRouteIndex: number;
  onSelectRoute: (index: number) => void;
  safeHavens: SafeHaven[];
  showHavens: boolean;
  onToggleHavens?: () => void;
  places?: Place[];
  showPlaces?: boolean;
  onTogglePlaces?: () => void;
  onNavigateToPlace?: (place: Place) => void;
  onSetSafeStop?: (place: Place) => void;
  safeStopWaypoint?: [number, number] | null; // [lng, lat]
  reports: CrowdsourcedReport[];
  showReports: boolean;
  onToggleReports?: () => void;
  onVoteReport: (reportId: string, vote: 'confirm' | 'dismiss') => void;
  zones: CampusZone[];
  activeZone: CampusZone | null;
  zoneMode: 'off' | 'auto';
  checkTime: Date;
  userLivePosition: { lat: number; lng: number; heading?: number } | null;
  clickMode: 'none' | 'origin' | 'destination' | 'report';
  onMapClick: (lat: number, lng: number) => void;
  reportPinDraft: { lat: number; lng: number } | null;
  drawingTarget: { zoneId: string; drawType: 'polygon' | 'gate' | 'restricted' } | null;
  onDrawPoint?: (lat: number, lng: number) => void;
  onFinishDrawing?: () => void;
}

export const Map: React.FC<MapProps> = ({
  center,
  zoom,
  origin,
  destination,
  routes,
  scoredRoutes,
  selectedRouteIndex,
  onSelectRoute,
  safeHavens,
  showHavens,
  onToggleHavens,
  places = [],
  showPlaces = true,
  onTogglePlaces,
  onNavigateToPlace,
  onSetSafeStop,
  safeStopWaypoint,
  reports,
  showReports,
  onToggleReports,
  onVoteReport,
  zones,
  activeZone,
  zoneMode,
  checkTime,
  userLivePosition,
  clickMode,
  onMapClick,
  reportPinDraft,
  drawingTarget,
  onDrawPoint,
  onFinishDrawing,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Remember theme in localStorage
  const [mapTheme, setMapTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('safewalk_map_theme') as 'dark' | 'light') || 'dark';
    } catch {
      return 'dark';
    }
  });

  const [backupTileToast, setBackupTileToast] = useState<boolean>(false);
  const [isTileLoading, setIsTileLoading] = useState<boolean>(false);
  const loadingTilesCount = useRef<number>(0);

  // Layer groups for clean updates without flickering
  const routesLayerRef = useRef<L.LayerGroup | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const havensLayerRef = useRef<L.LayerGroup | null>(null);
  const placesLayerRef = useRef<L.LayerGroup | null>(null);
  const reportsLayerRef = useRef<L.LayerGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const liveUserLayerRef = useRef<L.LayerGroup | null>(null);

  const handleToggleTheme = (theme: 'dark' | 'light') => {
    setMapTheme(theme);
    try {
      localStorage.setItem('safewalk_map_theme', theme);
    } catch {}
  };

  // Initialize Map ONCE
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: center,
      zoom: zoom,
      zoomControl: false,
      attributionControl: false,
    });

    // OpenStreetMap's public tile servers are for light usage only; a self-hosted or commercial tile provider is needed for production.
    const standardTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      keepBuffer: 4,
      updateWhenIdle: false,
      updateWhenZooming: false,
    }).addTo(map);

    let switchedToBackup = false;
    standardTileLayer.on('tileerror', (error) => {
      if (!switchedToBackup) {
        switchedToBackup = true;
        console.warn('Standard OSM tile error encountered, switching to backup hot mirror:', error);
        standardTileLayer.setUrl('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png');
        setBackupTileToast(true);
        setTimeout(() => setBackupTileToast(false), 4500);
      }
    });

    standardTileLayer.on('tileloadstart', () => {
      loadingTilesCount.current++;
      setIsTileLoading(true);
    });
    standardTileLayer.on('tileload', () => {
      loadingTilesCount.current = Math.max(0, loadingTilesCount.current - 1);
      if (loadingTilesCount.current === 0) setIsTileLoading(false);
    });
    standardTileLayer.on('load', () => {
      loadingTilesCount.current = 0;
      setIsTileLoading(false);
    });

    // Zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Create LayerGroups
    routesLayerRef.current = L.layerGroup().addTo(map);
    zonesLayerRef.current = L.layerGroup().addTo(map);
    havensLayerRef.current = L.layerGroup().addTo(map);
    placesLayerRef.current = L.layerGroup().addTo(map);
    reportsLayerRef.current = L.layerGroup().addTo(map);
    markersLayerRef.current = L.layerGroup().addTo(map);
    liveUserLayerRef.current = L.layerGroup().addTo(map);

    // Click handler (dispatches either map click or zone draw point)
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (drawingTarget && onDrawPoint) {
        onDrawPoint(e.latlng.lat, e.latlng.lng);
      } else {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    });

    mapInstanceRef.current = map;

    // ResizeObserver to prevent grey strip glitch when layout changes or panel collapses
    const resizeObserver = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    resizeObserver.observe(mapContainerRef.current);

    const onWindowResize = () => {
      if (mapInstanceRef.current) mapInstanceRef.current.invalidateSize();
    };
    window.addEventListener('resize', onWindowResize);

    setTimeout(() => {
      map.invalidateSize();
    }, 100);

    return () => {
      window.removeEventListener('resize', onWindowResize);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update center & zoom
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setView(center, zoom, { animate: true });
  }, [center[0], center[1], zoom]);

  // Fit bounds to selected route and ensure size validity
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (routes.length > 0 && routes[selectedRouteIndex]?.geometry?.coordinates?.length > 0) {
      const coords = routes[selectedRouteIndex].geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);
      const bounds = L.latLngBounds(coords);
      if (bounds.isValid()) {
        map.invalidateSize();
        map.fitBounds(bounds, {
          paddingTopLeft: [40, 80],
          paddingBottomRight: [40, 320], // Space for bottom sheet on mobile
          maxZoom: 17,
          animate: true,
        });
      }
    } else if (origin && destination) {
      const bounds = L.latLngBounds([origin, destination]);
      if (bounds.isValid()) {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17, animate: true });
      }
    }
  }, [routes, selectedRouteIndex, origin, destination]);

  // Render Routes (Heatmap segments for selected route, subtle paths for alternatives)
  useEffect(() => {
    const layer = routesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (routes.length === 0) return;

    // 1. Draw unselected routes in muted dashed lines
    routes.forEach((route, idx) => {
      if (idx === selectedRouteIndex) return;

      const latLngs = route.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);
      const line = L.polyline(latLngs, {
        color: '#64748b',
        weight: 5,
        opacity: 0.6,
        dashArray: '4, 8',
        lineCap: 'round',
        lineJoin: 'round',
      });

      line.on('click', () => onSelectRoute(idx));
      line.bindTooltip(`${route.name} (${Math.round(route.duration / 60)} min)`, {
        sticky: true,
        className: 'bg-slate-900 text-slate-200 text-xs px-2 py-1 rounded shadow border border-slate-700',
      });
      layer.addLayer(line);
    });

    // 2. Draw selected route with glowing shadow and color-coded heatmap segments
    const selectedRoute = routes[selectedRouteIndex];
    const scoredResult = scoredRoutes.find(r => r.routeIndex === selectedRouteIndex);

    if (selectedRoute && selectedRoute.geometry.coordinates.length > 0) {
      const fullLatLngs = selectedRoute.geometry.coordinates.map(c => [c[1], c[0]] as [number, number]);

      // Glow casing underneath
      const casing = L.polyline(fullLatLngs, {
        color: '#0f172a',
        weight: 10,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round',
      });
      layer.addLayer(casing);

      // If we have scored segment data, draw colored segments
      if (scoredResult && scoredResult.segments.length > 0) {
        scoredResult.segments.forEach((seg) => {
          const segLatLngs: [number, number][] = [
            [seg.from[1], seg.from[0]],
            [seg.to[1], seg.to[0]],
          ];

          const poly = L.polyline(segLatLngs, {
            color: seg.color, // Green (#22c55e), Amber (#f59e0b), Red (#ef4444)
            weight: 6,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round',
          });

          const statusText =
            seg.score >= 70
              ? 'Safe & Well-Lit'
              : seg.score >= 45
              ? 'Moderate Caution'
              : 'Low Lighting / Isolated';

          poly.bindTooltip(
            `<div class="text-xs font-medium">${statusText} (Score: ${seg.score})</div>
             <div class="text-[10px] text-slate-300">Type: ${seg.roadType} | ${seg.lighting === 'lit' ? '💡 Lit' : '🌑 Dim/Unlit'}</div>`,
            {
              sticky: true,
              className: 'bg-slate-900 text-white text-xs px-2.5 py-1.5 rounded-md shadow-lg border border-slate-700',
            }
          );

          layer.addLayer(poly);
        });
      } else {
        const fallbackLine = L.polyline(fullLatLngs, {
          color: '#10b981',
          weight: 6,
          opacity: 0.9,
        });
        layer.addLayer(fallbackLine);
      }
    }
  }, [routes, scoredRoutes, selectedRouteIndex]);

  // Render Origin, Destination, and Draft Pin Markers
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (origin) {
      const originIcon = L.divIcon({
        className: 'custom-origin-icon',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="absolute w-8 h-8 rounded-full bg-emerald-500/20 animate-ping"></div>
            <div class="w-7 h-7 rounded-full bg-emerald-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-xs font-bold">
              A
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const m = L.marker(origin, { icon: originIcon }).bindPopup('<b>Starting Location</b>', { closeButton: false });
      layer.addLayer(m);
    }

    if (destination) {
      const destIcon = L.divIcon({
        className: 'custom-dest-icon',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-7 h-7 rounded-full bg-rose-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-xs font-bold">
              B
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const m = L.marker(destination, { icon: destIcon }).bindPopup('<b>Destination</b>', { closeButton: false });
      layer.addLayer(m);
    }

    if (safeStopWaypoint) {
      const stopIcon = L.divIcon({
        className: 'custom-safestop-icon',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="absolute w-8 h-8 rounded-full bg-cyan-400/30 animate-ping"></div>
            <div class="w-7 h-7 rounded-full bg-cyan-500 border-2 border-white shadow-xl flex items-center justify-center text-white text-xs font-bold">
              🛡️
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const m = L.marker([safeStopWaypoint[1], safeStopWaypoint[0]], { icon: stopIcon })
        .bindPopup('<b>Safe Stop Waypoint</b><br/>En-route safe haven check-point', { closeButton: false });
      layer.addLayer(m);
    }

    if (reportPinDraft) {
      const draftIcon = L.divIcon({
        className: 'custom-draft-icon',
        html: `
          <div class="flex items-center justify-center">
            <div class="w-8 h-8 rounded-full bg-amber-500 border-2 border-white shadow-xl flex items-center justify-center text-slate-950 font-bold text-sm animate-bounce">
              ⚠️
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      });

      const m = L.marker([reportPinDraft.lat, reportPinDraft.lng], { icon: draftIcon })
        .bindPopup('<b>Report Location</b><br/>Fill form to submit report', { closeButton: false })
        .openPopup();
      layer.addLayer(m);
    }
  }, [origin, destination, safeStopWaypoint, reportPinDraft]);

  // Render Places Layer
  useEffect(() => {
    const layer = placesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!showPlaces || !places || places.length === 0) return;

    places.forEach((place) => {
      const typeIcons: Record<string, string> = {
        cafe: '☕',
        restaurant: '🍽️',
        pub: '🍺',
        bar: '🍸',
        fast_food: '🍕',
        convenience: '🏪',
        supermarket: '🛒',
        mall: '🏬',
        pharmacy: '💊',
        atm: '🏧',
        fuel: '⛽',
        park: '🌳',
        hospital: '🏥',
        police: '🛡️',
      };
      const iconChar = typeIcons[place.subcategory] || '📍';

      const placeIcon = L.divIcon({
        className: 'custom-place-icon',
        html: `
          <div class="relative cursor-pointer group">
            <div class="w-6 h-6 rounded-full ${
              place.openNow ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400 opacity-60'
            } border border-emerald-400/50 shadow-md flex items-center justify-center text-xs transition-transform hover:scale-125">
              ${iconChar}
            </div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([place.lat, place.lng], { icon: placeIcon });

      const popupContainer = document.createElement('div');
      popupContainer.className = 'p-1 min-w-[200px] text-slate-900 font-sans';
      popupContainer.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="font-bold text-xs truncate max-w-[140px]">${place.name}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${
            place.openNow ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
          }">${place.openNow ? 'OPEN' : 'CLOSED'}</span>
        </div>
        <div class="text-[11px] text-slate-600 mb-1 capitalize">
          ${place.subcategory.replace(/_/g, ' ')} • ${place.closingTime || (place.is24h ? '24/7' : 'Standard hours')}
        </div>
        <div class="grid grid-cols-2 gap-1 mt-2 pt-1.5 border-t border-slate-200">
          <button id="nav-${place.id}" class="py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold text-center cursor-pointer">
            Navigate Here
          </button>
          <button id="stop-${place.id}" class="py-1 px-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold text-center cursor-pointer">
            Set Safe Stop
          </button>
        </div>
      `;

      marker.bindPopup(popupContainer, { maxWidth: 240 });
      marker.on('popupopen', () => {
        const navBtn = popupContainer.querySelector(`#nav-${place.id}`);
        const stopBtn = popupContainer.querySelector(`#stop-${place.id}`);
        if (navBtn && onNavigateToPlace) {
          navBtn.addEventListener('click', () => {
            onNavigateToPlace(place);
            marker.closePopup();
          });
        }
        if (stopBtn && onSetSafeStop) {
          stopBtn.addEventListener('click', () => {
            onSetSafeStop(place);
            marker.closePopup();
          });
        }
      });

      layer.addLayer(marker);
    });
  }, [places, showPlaces, onNavigateToPlace, onSetSafeStop]);

  // Render Safe Havens Layer
  useEffect(() => {
    const layer = havensLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!showHavens) return;

    safeHavens.forEach((haven) => {
      const isOpen = isHavenOpen(haven, checkTime);

      const havenIcon = L.divIcon({
        className: 'custom-haven-icon',
        html: `
          <div class="relative group cursor-pointer">
            <div class="w-7 h-7 rounded-full ${
              isOpen ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 opacity-60'
            } border border-indigo-400/50 shadow-md flex items-center justify-center text-xs transition-transform hover:scale-125">
              ${
                haven.type === 'police' || haven.type === 'campus_security'
                  ? '🛡️'
                  : haven.type === 'hospital'
                  ? '🏥'
                  : haven.type === 'pharmacy'
                  ? '💊'
                  : haven.type === 'fuel'
                  ? '⛽'
                  : haven.type === 'atm'
                  ? '🏧'
                  : '🏪'
              }
            </div>
            ${
              haven.open24h
                ? '<span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full border border-slate-900" title="24/7 Open"></span>'
                : ''
            }
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([haven.lat, haven.lng], { icon: havenIcon });

      const popupContent = `
        <div class="p-1 min-w-[180px] text-slate-900 font-sans">
          <div class="flex items-center justify-between gap-2 mb-1">
            <span class="font-bold text-xs">${haven.name}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded ${
              isOpen ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
            }">${isOpen ? 'OPEN' : 'CLOSED'}</span>
          </div>
          <div class="text-[11px] text-slate-600 mb-1">
            ${haven.description || (haven.open24h ? 'Verified 24/7 safe zone' : 'Public haven')}
          </div>
          <div class="text-[10px] text-slate-500 font-medium">
            ${haven.open24h ? '🕒 Open 24 Hours' : haven.openingHours ? `🕒 ${haven.openingHours}` : 'Operating during regular hours'}
          </div>
        </div>
      `;

      marker.bindPopup(popupContent, { maxWidth: 240 });
      layer.addLayer(marker);
    });
  }, [safeHavens, showHavens, checkTime]);

  // Render Crowdsourced Reports Layer
  useEffect(() => {
    const layer = reportsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!showReports) return;

    reports.forEach((rep) => {
      const typeIcons: Record<string, string> = {
        dark_patch: '🌑',
        broken_streetlight: '💡',
        harassment: '⚠️',
        suspicious_activity: '👀',
        isolated_area: '🏚️',
        other: '❗',
      };

      const typeLabels: Record<string, string> = {
        dark_patch: 'Dark Patch / No Lights',
        broken_streetlight: 'Broken Streetlight',
        harassment: 'Harassment Reported',
        suspicious_activity: 'Suspicious Activity',
        isolated_area: 'Isolated / Deserted Area',
        other: 'Safety Concern',
      };

      const ageDays = Math.max(0, Math.round((Date.now() - rep.timestamp) / (1000 * 60 * 60 * 24)));
      const ageStr = ageDays === 0 ? 'Today' : `${ageDays}d ago`;

      const repIcon = L.divIcon({
        className: 'custom-rep-icon',
        html: `
          <div class="w-7 h-7 rounded-full bg-amber-500/90 border border-amber-300 text-slate-950 flex items-center justify-center text-xs shadow-lg transition-transform hover:scale-125">
            ${typeIcons[rep.type] || '⚠️'}
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([rep.lat, rep.lng], { icon: repIcon });

      const container = document.createElement('div');
      container.className = 'p-1 min-w-[200px] text-slate-900 font-sans';
      container.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="font-bold text-xs text-amber-800">${typeLabels[rep.type] || 'Report'}</span>
          <span class="text-[10px] text-slate-500">${ageStr}</span>
        </div>
        ${rep.note ? `<p class="text-[11px] text-slate-700 mb-2 italic">"${rep.note}"</p>` : ''}
        <div class="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200">
          <span class="text-slate-600">👍 ${rep.confirmations} confirmed</span>
          <div class="flex gap-1">
            <button id="vote-confirm-${rep.id}" class="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-medium cursor-pointer">
              Confirm
            </button>
            <button id="vote-dismiss-${rep.id}" class="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded text-[10px] font-medium cursor-pointer">
              Dismiss
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(container);
      marker.on('popupopen', () => {
        const confirmBtn = document.getElementById(`vote-confirm-${rep.id}`);
        const dismissBtn = document.getElementById(`vote-dismiss-${rep.id}`);
        if (confirmBtn) {
          confirmBtn.onclick = () => {
            onVoteReport(rep.id, 'confirm');
            marker.closePopup();
          };
        }
        if (dismissBtn) {
          dismissBtn.onclick = () => {
            onVoteReport(rep.id, 'dismiss');
            marker.closePopup();
          };
        }
      });

      layer.addLayer(marker);
    });
  }, [reports, showReports]);

  // Render Generic Campus Zones & Gates ONLY when a zone is active or being edited
  useEffect(() => {
    const layer = zonesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    // Show zones if activeZone is detected or user is in drawingTarget mode
    const zonesToRender = activeZone ? [activeZone] : (drawingTarget ? zones.filter(z => z.id === drawingTarget.zoneId) : []);

    zonesToRender.forEach((zone) => {
      // Zone boundary polygon
      if (zone.polygon && zone.polygon.length >= 3) {
        const poly = L.polygon(zone.polygon as [number, number][], {
          color: '#6366f1',
          fillColor: '#6366f1',
          fillOpacity: 0.08,
          weight: 2,
          dashArray: '5, 5',
        });
        poly.bindTooltip(`📍 ${zone.name}`, { sticky: true });
        layer.addLayer(poly);
      }

      // Restricted hazard areas
      zone.restrictedAreas.forEach((area) => {
        if (area.polygon && area.polygon.length >= 3) {
          const poly = L.polygon(area.polygon as [number, number][], {
            color: '#ef4444',
            fillColor: '#ef4444',
            fillOpacity: 0.25,
            weight: 2,
            dashArray: '4, 4',
          });
          poly.bindTooltip(`⚠️ ${area.name}${area.reason ? `<br/><span class="text-rose-300 text-[10px]">${area.reason}</span>` : ''}`, {
            sticky: true,
            className: 'bg-rose-950 text-white text-xs px-2 py-1 rounded border border-rose-700',
          });
          layer.addLayer(poly);
        }
      });

      // Show CURFEW/GATE markers ONLY when zone is active and relevant
      zone.gates.forEach((gate) => {
        if (!gate.name) return;
        const status = getGateStatus(gate, checkTime);

        const gateIcon = L.divIcon({
          className: 'custom-gate-icon',
          html: `
            <div class="flex flex-col items-center">
              <div class="px-2 py-0.5 rounded text-[10px] font-bold ${
                status.isOpen ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
              } border border-white shadow">
                ${status.isOpen ? 'OPEN' : 'CURFEW'}
              </div>
              <div class="w-5 h-5 rounded-full ${status.isOpen ? 'bg-emerald-500' : 'bg-rose-500'} border-2 border-white flex items-center justify-center text-[10px]">
                🚪
              </div>
            </div>
          `,
          iconSize: [50, 40],
          iconAnchor: [25, 35],
        });

        const m = L.marker([gate.lat, gate.lng], { icon: gateIcon });
        m.bindPopup(`
          <div class="p-1 min-w-[180px] text-slate-900 font-sans">
            <div class="font-bold text-xs text-indigo-900">${gate.name}</div>
            <div class="text-[11px] font-semibold ${status.isOpen ? 'text-emerald-700' : 'text-rose-700'} mt-0.5">
              ${status.message}
            </div>
            <p class="text-[10px] text-slate-600 mt-1">Campus gate access point</p>
          </div>
        `);
        layer.addLayer(m);
      });
    });
  }, [zones, activeZone, zoneMode, checkTime, drawingTarget]);

  // Render Live User Walking Position Marker
  useEffect(() => {
    const layer = liveUserLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!userLivePosition) return;

    const radar = L.circle([userLivePosition.lat, userLivePosition.lng], {
      radius: 25,
      color: '#38bdf8',
      fillColor: '#38bdf8',
      fillOpacity: 0.15,
      weight: 1,
    });
    layer.addLayer(radar);

    const userIcon = L.divIcon({
      className: 'custom-live-user-icon',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-7 h-7 rounded-full bg-sky-400 animate-ping opacity-75"></div>
          <div class="w-5 h-5 rounded-full bg-sky-500 border-2 border-white shadow-xl flex items-center justify-center">
            <div class="w-2 h-2 rounded-full bg-white"></div>
          </div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const marker = L.marker([userLivePosition.lat, userLivePosition.lng], { icon: userIcon });
    layer.addLayer(marker);
  }, [userLivePosition]);

  return (
    <div className={`relative w-full h-full min-h-0 flex-1 ${mapTheme === 'dark' ? 'map-dark' : ''}`}>
      <div ref={mapContainerRef} className="w-full h-full z-0 cursor-crosshair" />

      {/* Map Layers & Theme Bar */}
      <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-1 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-1 shadow-xl">
        <button
          type="button"
          onClick={() => handleToggleTheme('dark')}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
            mapTheme === 'dark'
              ? 'bg-slate-800 text-sky-400 border border-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          title="Dark map (CSS filtered tiles)"
        >
          <span>🌙 Dark</span>
        </button>
        <button
          type="button"
          onClick={() => handleToggleTheme('light')}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
            mapTheme === 'light'
              ? 'bg-slate-800 text-amber-400 border border-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
          title="Standard light OSM tiles"
        >
          <span>☀️ Light</span>
        </button>

        <div className="w-[1px] h-4 bg-slate-800 mx-0.5 hidden sm:block"></div>

        {/* Places Layer Toggle */}
        {onTogglePlaces && (
          <button
            type="button"
            onClick={onTogglePlaces}
            className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
              showPlaces
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Places & Hangout spots on map"
          >
            <span>☕ Places</span>
          </button>
        )}

        {/* Safe Havens Toggle */}
        {onToggleHavens && (
          <button
            type="button"
            onClick={onToggleHavens}
            className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
              showHavens
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Safe Havens on map"
          >
            <span>🛡️ Havens</span>
          </button>
        )}

        {/* Community Reports Toggle */}
        {onToggleReports && (
          <button
            type="button"
            onClick={onToggleReports}
            className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
              showReports
                ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Safety Incidents on map"
          >
            <span>⚠️ Reports</span>
          </button>
        )}
      </div>

      {/* Small Tile Loading Indicator */}
      {isTileLoading && (
        <div className="absolute bottom-6 left-4 z-10 px-2 py-1 bg-slate-900/80 backdrop-blur border border-slate-800 rounded-lg text-[10px] text-slate-300 flex items-center gap-1.5 shadow pointer-events-none">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
          <span>Loading tiles...</span>
        </div>
      )}

      {/* Non-blocking backup map switch toast */}
      {backupTileToast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 px-3.5 py-2 rounded-xl bg-slate-900/95 text-amber-300 text-xs font-medium border border-amber-500/50 shadow-2xl backdrop-blur flex items-center gap-2 animate-fade-in pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
          Switched to backup map
        </div>
      )}

      {/* Drawing mode banner */}
      {drawingTarget && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-2xl bg-indigo-950/95 text-indigo-200 text-xs font-medium border border-indigo-500/50 shadow-2xl backdrop-blur flex items-center gap-3">
          <span>Click on map to {drawingTarget.drawType === 'polygon' ? 'add boundary point' : drawingTarget.drawType === 'gate' ? 'place gate' : 'draw hazard point'}</span>
          {onFinishDrawing && (
            <button
              onClick={onFinishDrawing}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold"
            >
              Done Drawing
            </button>
          )}
        </div>
      )}

      {/* Tap map hint when click mode active */}
      {!drawingTarget && clickMode !== 'none' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-slate-900/90 text-amber-300 text-xs font-medium border border-amber-500/40 shadow-xl backdrop-blur flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          Click on map to place {clickMode === 'origin' ? 'Origin' : clickMode === 'destination' ? 'Destination' : 'Incident Pin'}
        </div>
      )}
    </div>
  );
};
