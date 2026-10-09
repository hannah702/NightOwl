import React, { useState, useEffect } from 'react';
import { Shield, Navigation, AlertTriangle, Clock, MapPin, RefreshCw, PhoneCall } from 'lucide-react';
import L from 'leaflet';

interface SpectatorLiveViewProps {
  sessionId: string;
  onExitSpectator: () => void;
}

export const SpectatorLiveView: React.FC<SpectatorLiveViewProps> = ({
  sessionId,
  onExitSpectator,
}) => {
  const [sessionData, setSessionData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapInstanceRef = React.useRef<L.Map | null>(null);
  const routeLayerRef = React.useRef<L.Polyline | null>(null);
  const markerRef = React.useRef<L.Marker | null>(null);

  // Poll session state
  useEffect(() => {
    let isCancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/share/${sessionId}`);
        if (!res.ok) {
          if (res.status === 410) {
            setError('This live walking session has expired or ended.');
          } else {
            setError('Walk session not found.');
          }
          return;
        }

        const data = await res.json();
        if (!isCancelled && data.session) {
          setSessionData(data.session);
          setLoading(false);
        }
      } catch (err: any) {
        if (!isCancelled) setError('Connection error checking live session.');
      }
    }

    poll();
    const interval = setInterval(poll, 4000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  // Init leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current || !sessionData) return;

    const map = L.map(mapContainerRef.current, {
      center: sessionData.currentLocation ? [sessionData.currentLocation.lat, sessionData.currentLocation.lng] : [26.843, 75.565],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
    });

    // OpenStreetMap's public tile servers are for light usage only; a self-hosted or commercial tile provider is needed for production.
    const standardTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    let switchedToBackup = false;
    standardTileLayer.on('tileerror', (error) => {
      if (!switchedToBackup) {
        switchedToBackup = true;
        console.warn('Spectator OSM tile error, switching to backup hot mirror:', error);
        standardTileLayer.setUrl('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png');
      }
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    mapInstanceRef.current = map;
  }, [sessionData]);

  // Update map polyline & live marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !sessionData) return;

    // Draw route
    if (sessionData.routeGeometry && sessionData.routeGeometry.length > 0) {
      const latLngs = sessionData.routeGeometry.map((c: [number, number]) => [c[1], c[0]] as [number, number]);

      if (routeLayerRef.current) {
        routeLayerRef.current.setLatLngs(latLngs);
      } else {
        routeLayerRef.current = L.polyline(latLngs, {
          color: '#10b981',
          weight: 6,
          opacity: 0.9,
        }).addTo(map);
      }

      if (!markerRef.current) {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
      }
    }

    // Update user marker
    if (sessionData.currentLocation) {
      const { lat, lng } = sessionData.currentLocation;
      const userIcon = L.divIcon({
        className: 'custom-spectator-user',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="absolute w-8 h-8 rounded-full bg-sky-400 animate-ping opacity-75"></div>
            <div class="w-6 h-6 rounded-full bg-sky-500 border-2 border-white shadow-xl flex items-center justify-center">
              <div class="w-2 h-2 rounded-full bg-white"></div>
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng], { icon: userIcon }).addTo(map);
        map.panTo([lat, lng]);
      }
    }
  }, [sessionData]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white p-4">
        <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mb-3" />
        <h2 className="text-base font-semibold">Connecting to Live Walk Session...</h2>
        <p className="text-xs text-slate-400 mt-1">Session ID: {sessionId}</p>
      </div>
    );
  }

  if (error || !sessionData) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white p-4 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
        <h2 className="text-lg font-bold text-white mb-1">Session Unavailable</h2>
        <p className="text-xs text-slate-400 max-w-sm mb-4">{error || 'This live link is no longer active.'}</p>
        <button
          onClick={onExitSpectator}
          className="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700"
        >
          Open NightOwl App
        </button>
      </div>
    );
  }

  const isAlert = sessionData.status === 'off_route_alert';
  const updatedSecondsAgo = sessionData.currentLocation?.updatedAt
    ? Math.max(0, Math.round((Date.now() - sessionData.currentLocation.updatedAt) / 1000))
    : 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-white overflow-hidden relative">
      {/* Top Header */}
      <header className="p-3.5 z-20 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
            🛡️
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-bold flex items-center gap-2">
              <span>NightOwl Live Contact View</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            </h1>
            <p className="text-[11px] text-slate-400">
              Tracking: {sessionData.originName} → {sessionData.destinationName}
            </p>
          </div>
        </div>

        <button
          onClick={onExitSpectator}
          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
        >
          Normal App
        </button>
      </header>

      {/* Alert Banner if off route */}
      {isAlert && (
        <div className="z-20 p-3 bg-rose-950 border-b border-rose-500 text-rose-200 text-xs flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-semibold">
              Warning: Walker has drifted away from the calculated route corridor.
            </span>
          </div>
          <a
            href="tel:112"
            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 shrink-0"
          >
            <PhoneCall className="w-3 h-3" /> Call 112
          </a>
        </div>
      )}

      {/* Map */}
      <main className="flex-1 relative">
        <div ref={mapContainerRef} className="w-full h-full dark-tiles" />

        {/* Live HUD card overlay */}
        <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-20 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl p-3.5 shadow-2xl space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200">Live Status</span>
            <span className="text-[10px] text-slate-400">Updated {updatedSecondsAgo}s ago</span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
            <span className="text-slate-400">Walker Position:</span>
            <span className="font-mono text-emerald-400 font-medium">
              {sessionData.currentLocation
                ? `${sessionData.currentLocation.lat.toFixed(4)}, ${sessionData.currentLocation.lng.toFixed(4)}`
                : 'Awaiting GPS lock'}
            </span>
          </div>

          <div className="text-[10px] text-slate-500 pt-1">
            This live track updates in real-time. Contact the walker if you see persistent deviations.
          </div>
        </div>
      </main>
    </div>
  );
};
