import React, { useState, useEffect, useRef } from 'react';
import {
  Navigation,
  AlertTriangle,
  ShieldCheck,
  Share2,
  PhoneCall,
  Check,
  X,
  Copy,
  Volume2,
  VolumeX,
  ArrowRight,
  Clock,
  Radio,
  Sparkles,
} from 'lucide-react';
import { RouteOption } from '../lib/routing';
import { ScoredRouteResult, getDistanceMeters } from '../lib/scoring';
import { playDeviationAlert, playChime, startSirenAlert, stopSirenAlert } from '../lib/audio';

interface LiveWalkModeProps {
  route: RouteOption;
  scored: ScoredRouteResult;
  onStopWalk: () => void;
  onReroute: (currentCoords: [number, number]) => void;
  onUpdateUserLocation: (location: { lat: number; lng: number; heading?: number }) => void;
}

export const LiveWalkMode: React.FC<LiveWalkModeProps> = ({
  route,
  scored,
  onStopWalk,
  onReroute,
  onUpdateUserLocation,
}) => {
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [distanceRemaining, setDistanceRemaining] = useState<number>(route.distance);
  const [isOffRouteAlert, setIsOffRouteAlert] = useState(false);
  const [deviationDistance, setDeviationDistance] = useState(0);
  const [shareSessionId, setShareSessionId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isCopiedShare, setIsCopiedShare] = useState(false);
  const [alertDismissedUntil, setAlertDismissedUntil] = useState<number>(0);

  // Feature 2: Deterrent Siren & Flash Alarm
  const [isSirenActive, setIsSirenActive] = useState<boolean>(false);

  // Feature 3: Safe Arrival Watchdog & Check-in Timer
  // Expected walking duration + 5 min grace buffer
  const initialDurationSeconds = Math.max(120, route.duration);
  const [secondsRemainingCountdown, setSecondsRemainingCountdown] = useState<number>(initialDurationSeconds + 300);
  const [isArrivalConfirmed, setIsArrivalConfirmed] = useState<boolean>(false);
  const [showCheckInModal, setShowCheckInModal] = useState<boolean>(false);
  const [isOverdueAlert, setIsOverdueAlert] = useState<boolean>(false);

  const offRouteTimerRef = useRef<NodeJS.Timeout | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Stop siren on unmount
  useEffect(() => {
    return () => {
      stopSirenAlert();
    };
  }, []);

  // Safe Arrival Countdown Timer
  useEffect(() => {
    if (isArrivalConfirmed) return;

    const timer = setInterval(() => {
      setSecondsRemainingCountdown((prev) => {
        if (prev <= 1) {
          setIsOverdueAlert(true);
          setShowCheckInModal(true);
          playDeviationAlert();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isArrivalConfirmed]);

  // Destination Proximity Detection (<= 45m triggers Arrival Check-in)
  useEffect(() => {
    if (distanceRemaining <= 45 && !isArrivalConfirmed && !showCheckInModal) {
      setShowCheckInModal(true);
      playChime();
    }
  }, [distanceRemaining, isArrivalConfirmed, showCheckInModal]);

  // Computes distance from current point to nearest point along route polyline
  const computeMinDistanceToRoute = (userLat: number, userLng: number): number => {
    const coords = route.geometry.coordinates;
    let minD = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const p1 = coords[i];
      const p2 = coords[i + 1];
      for (let step = 0; step <= 4; step++) {
        const frac = step / 4;
        const lat = p1[1] + (p2[1] - p1[1]) * frac;
        const lng = p1[0] + (p2[0] - p1[0]) * frac;
        const d = getDistanceMeters(userLat, userLng, lat, lng);
        if (d < minD) minD = d;
      }
    }
    return minD;
  };

  // Start Geolocation watch
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported on this browser');
      return;
    }

    playChime();

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading } = pos.coords;
        const userLoc = { lat: latitude, lng: longitude, accuracy };
        setCurrentPosition(userLoc);
        onUpdateUserLocation({ lat: latitude, lng: longitude, heading: heading || undefined });

        const dToRoute = computeMinDistanceToRoute(latitude, longitude);
        setDeviationDistance(Math.round(dToRoute));

        const destCoord = route.geometry.coordinates[route.geometry.coordinates.length - 1];
        if (destCoord) {
          const rem = getDistanceMeters(latitude, longitude, destCoord[1], destCoord[0]);
          setDistanceRemaining(Math.round(rem));
        }

        const now = Date.now();
        if (dToRoute > 50 && now > alertDismissedUntil) {
          if (!offRouteTimerRef.current && !isOffRouteAlert) {
            offRouteTimerRef.current = setTimeout(() => {
              setIsOffRouteAlert(true);
              playDeviationAlert();
              if (navigator.vibrate) {
                navigator.vibrate([300, 150, 300, 150, 400]);
              }
            }, 10000);
          }
        } else {
          if (offRouteTimerRef.current) {
            clearTimeout(offRouteTimerRef.current);
            offRouteTimerRef.current = null;
          }
          if (dToRoute <= 40) {
            setIsOffRouteAlert(false);
          }
        }
      },
      (err) => {
        console.warn('Geolocation error during walk mode:', err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (offRouteTimerRef.current) {
        clearTimeout(offRouteTimerRef.current);
      }
    };
  }, [route, alertDismissedUntil]);

  // Periodic push to live share session (every 5 seconds)
  useEffect(() => {
    if (!shareSessionId || !currentPosition) return;

    const interval = setInterval(async () => {
      try {
        let status: 'active' | 'off_route_alert' = 'active';
        let alertMessage: string | undefined = undefined;

        if (isOffRouteAlert) {
          status = 'off_route_alert';
          alertMessage = `User has drifted ${deviationDistance}m off expected route`;
        } else if (isOverdueAlert && !isArrivalConfirmed) {
          status = 'off_route_alert';
          alertMessage = `Safe arrival check-in timer expired! User may need assistance.`;
        }

        await fetch(`/api/share/${shareSessionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentLocation: {
              lat: currentPosition.lat,
              lng: currentPosition.lng,
              accuracy: currentPosition.accuracy,
            },
            status,
            alertMessage,
          }),
        });
      } catch (err) {
        console.warn('Live share update ping failed:', err);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [shareSessionId, currentPosition, isOffRouteAlert, deviationDistance, isOverdueAlert, isArrivalConfirmed]);

  const handleStartShare = async () => {
    setIsSharing(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originName: 'Walk Starting Point',
          destinationName: 'Destination',
          routeGeometry: route.geometry.coordinates,
          currentLocation: currentPosition ? {
            lat: currentPosition.lat,
            lng: currentPosition.lng,
          } : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setShareSessionId(data.sessionId);
      }
    } catch (err) {
      console.error('Failed to create live share session:', err);
    }
  };

  const handleCopyShareLink = () => {
    if (!shareSessionId) return;
    const url = `${window.location.origin}/?share=${shareSessionId}`;
    navigator.clipboard.writeText(url);
    setIsCopiedShare(true);
    setTimeout(() => setIsCopiedShare(false), 2500);
  };

  const handleDismissAlert = () => {
    setIsOffRouteAlert(false);
    setAlertDismissedUntil(Date.now() + 2 * 60 * 1000);
  };

  const handleRerouteFromHere = () => {
    if (currentPosition) {
      setIsOffRouteAlert(false);
      onReroute([currentPosition.lng, currentPosition.lat]);
    }
  };

  const handleToggleSiren = () => {
    if (isSirenActive) {
      stopSirenAlert();
      setIsSirenActive(false);
    } else {
      startSirenAlert();
      setIsSirenActive(true);
      if (navigator.vibrate) {
        navigator.vibrate([400, 200, 400, 200, 500]);
      }
    }
  };

  const handleConfirmArrival = () => {
    setIsArrivalConfirmed(true);
    setShowCheckInModal(false);
    setIsOverdueAlert(false);
    playChime();
    setTimeout(() => {
      onStopWalk();
    }, 800);
  };

  const handleEmergencyAlert = () => {
    const lat = currentPosition?.lat.toFixed(5) || 'Unknown';
    const lng = currentPosition?.lng.toFixed(5) || 'Unknown';
    const shareLink = shareSessionId ? `${window.location.origin}/?share=${shareSessionId}` : '';
    const sosMessage = `🚨 NightOwl Alert: I am walking and need assistance. My current GPS: https://maps.google.com/?q=${lat},${lng} ${shareLink ? `Live Walk Track: ${shareLink}` : ''}`;

    navigator.clipboard.writeText(sosMessage);
    alert(`Emergency SOS message copied to clipboard:\n\n${sosMessage}`);
  };

  const minsRemaining = Math.max(1, Math.round(distanceRemaining / 72)); // ~1.2 m/s verified pace
  const countdownMins = Math.floor(secondsRemainingCountdown / 60);
  const countdownSecs = secondsRemainingCountdown % 60;

  return (
    <>
      {/* Visual Emergency Flash Strobe Overlay when Siren is Active */}
      {isSirenActive && (
        <div className="fixed inset-0 z-50 pointer-events-none animate-pulse bg-rose-600/30 border-8 border-rose-500" />
      )}

      {/* Arrival Check-in Modal */}
      {showCheckInModal && !isArrivalConfirmed && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 shadow-2xl text-center space-y-4 animate-scale-up">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-base font-bold text-white">Safe Arrival Check-in</h3>
              <p className="text-xs text-slate-300 mt-1">
                {distanceRemaining <= 45
                  ? "You have reached your destination. Please confirm you're safe!"
                  : "Your estimated arrival time has reached. Are you safely at your destination?"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={handleConfirmArrival}
                className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-950"
              >
                <Check className="w-4 h-4" />
                I'm Safe Here
              </button>
              <button
                onClick={() => {
                  setShowCheckInModal(false);
                  setSecondsRemainingCountdown(300); // add 5 more minutes
                }}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer border border-slate-700"
              >
                Still Walking (+5m)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Floating Live Walk HUD */}
      <div className="fixed bottom-0 left-0 right-0 z-40 p-3 sm:p-4 bg-slate-950/95 border-t border-slate-800 backdrop-blur-xl shadow-2xl animate-slide-up">
        <div className="max-w-xl mx-auto space-y-3">
          {/* Deviation Alert Banner (Audio + Vibrate + Visual) */}
          {isOffRouteAlert && (
            <div className="p-3.5 rounded-2xl bg-rose-950/90 border border-rose-500 shadow-2xl text-white space-y-2 animate-bounce-subtle">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 animate-pulse" />
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-white">
                      Route Deviation Detected ({deviationDistance}m off route)
                    </h4>
                    <p className="text-[11px] text-rose-200">
                      You have drifted away from your safe navigation corridor.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <button
                  onClick={handleDismissAlert}
                  className="py-2 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold text-center border border-slate-700 cursor-pointer"
                >
                  I'm Fine
                </button>
                <button
                  onClick={handleRerouteFromHere}
                  className="py-2 px-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold text-center cursor-pointer"
                >
                  Re-Route
                </button>
                <button
                  onClick={handleEmergencyAlert}
                  className="py-2 px-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold text-center flex items-center justify-center gap-1 cursor-pointer"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  Alert SOS
                </button>
              </div>
            </div>
          )}

          {/* Live Tracking HUD */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400">
                  <Navigation className="w-5 h-5 animate-pulse" />
                </div>
                <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-slate-950"></span>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">Live Walk Active</h4>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                    Safety {scored.safetyScore}
                  </span>
                </div>
                <div className="text-xs text-slate-300 flex items-center gap-2">
                  <span>~{minsRemaining} min left ({distanceRemaining}m)</span>
                  <span>•</span>
                  <span className="text-[11px] font-mono text-cyan-300">
                    ⏱️ Watchdog: {countdownMins}:{countdownSecs.toString().padStart(2, '0')}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-2">
              {/* Deterrent Siren Button */}
              <button
                onClick={handleToggleSiren}
                className={`p-2 rounded-xl text-xs font-bold transition flex items-center gap-1 cursor-pointer border ${
                  isSirenActive
                    ? 'bg-rose-600 text-white border-rose-400 animate-bounce'
                    : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border-slate-700'
                }`}
                title={isSirenActive ? 'Stop Loud Deterrent Siren' : 'Trigger Loud Deterrent Siren Alarm'}
              >
                {isSirenActive ? <VolumeX className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                <span className="hidden xs:inline">{isSirenActive ? 'Silence' : 'Siren'}</span>
              </button>

              {/* End Walk Button */}
              <button
                onClick={onStopWalk}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-400 hover:text-rose-300 border border-slate-700 text-xs font-semibold transition cursor-pointer"
              >
                End
              </button>
            </div>
          </div>

          {/* Share Live Link Bar & Safe Arrival Check-in Shortcut */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
            {!shareSessionId ? (
              <button
                onClick={handleStartShare}
                className="flex-1 py-1.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-sky-400" />
                Share Live Track with Contact
              </button>
            ) : (
              <div className="flex-1 flex items-center justify-between bg-slate-900 border border-sky-500/40 rounded-xl px-3 py-1.5">
                <div className="flex items-center gap-2 text-sky-300 text-xs">
                  <span className="inline-block w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
                  <span>Live Track Active ({shareSessionId})</span>
                </div>
                <button
                  onClick={handleCopyShareLink}
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition cursor-pointer"
                >
                  {isCopiedShare ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {isCopiedShare ? 'Copied' : 'Copy Link'}
                </button>
              </div>
            )}

            <button
              onClick={() => setShowCheckInModal(true)}
              className="py-1.5 px-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-medium flex items-center gap-1 cursor-pointer shrink-0"
              title="Confirm Safe Arrival"
            >
              <Check className="w-3.5 h-3.5" />
              <span>I'm Safe</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
