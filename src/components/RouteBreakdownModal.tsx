import React from 'react';
import { X, Shield, BarChart3, Sun, Users, MapPin, AlertTriangle, Clock } from 'lucide-react';
import { ScoredRouteResult, SafetyWeights } from '../lib/scoring';
import { RouteOption } from '../lib/routing';

interface RouteBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  route: RouteOption;
  scored: ScoredRouteResult;
  weights: SafetyWeights;
  timeString?: string;
}

export const RouteBreakdownModal: React.FC<RouteBreakdownModalProps> = ({
  isOpen,
  onClose,
  route,
  scored,
  weights,
  timeString,
}) => {
  if (!isOpen) return null;

  // Dev-time assertion: verify integrity of breakdown values against scored object
  if (process.env.NODE_ENV !== 'production') {
    if (typeof scored.litPercent !== 'number' || typeof scored.openHavensPassedCount !== 'number') {
      console.error('[NightOwl Integrity Error] RouteBreakdownModal received invalid scored object:', scored);
    }
  }

  const lightingDesc = scored.hasLightingData
    ? `${scored.litPercent}% verified illuminated. ${Math.round(scored.unlitDistanceMeters)}m unlit stretch.`
    : `Estimated ${scored.litPercent}% illuminated (OSRM road classification default; unverified OSM tags).`;

  const metrics = [
    {
      label: 'Street Lighting',
      icon: Sun,
      score: Math.round(scored.lightingScore * 100),
      weight: weights.lighting,
      color: 'bg-amber-400',
      description: lightingDesc,
    },
    {
      label: 'Pedestrian & Business Activity',
      icon: Users,
      score: Math.round(scored.activityScore * 100),
      weight: weights.activity,
      color: 'bg-emerald-400',
      description: scored.openPlacesSummary || `${scored.openPlacesCount} open businesses & transit hubs within 40m corridor.`,
    },
    {
      label: 'Road Infrastructure Safety',
      icon: MapPin,
      score: Math.round(scored.roadTypeScore * 100),
      weight: 15,
      color: 'bg-sky-400',
      description: 'Prefers wide pedestrian footpaths, sidewalks, and residential avenues.',
    },
    {
      label: 'Safe Haven Proximity',
      icon: Shield,
      score: Math.round(scored.havenProximityScore * 100),
      weight: weights.havens,
      color: 'bg-indigo-400',
      description: scored.hasHavensNearby
        ? `${scored.openHavensPassedCount} open havens passed (police, 24h pharmacy, hospital, ATM). Max gap: ${scored.longestHavenGapMeters}m.`
        : 'No safe havens mapped nearby on this corridor.',
    },
    {
      label: 'Reported Incidents Impact',
      icon: AlertTriangle,
      score: Math.max(0, 100 - Math.round(scored.incidentPenalty * 100)),
      weight: weights.incidents,
      color: 'bg-rose-400',
      description: scored.nearbyIncidentsCount > 0
        ? `${scored.nearbyIncidentsCount} community reports nearby (decayed by report age & votes).`
        : 'Zero active incidents reported on this corridor.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-400" />
                Safety Score Breakdown
              </h2>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-slate-400 truncate max-w-[200px]">{route.name}</p>
              {timeString && (
                <span className="text-[10px] bg-sky-950/70 text-sky-400 border border-sky-800/60 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Scoring for: {timeString}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Overall Score Banner */}
        <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 font-medium">Composite Safety Rating</div>
            <div className="text-2xl font-black text-emerald-400 mt-0.5">
              {scored.safetyScore} <span className="text-xs font-normal text-slate-400">/ 100</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">OSRM Duration</div>
            <div className="text-sm font-bold text-white mt-0.5">
              {Math.round(route.duration / 60)} mins ({Math.round(route.distance)}m)
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Data Confidence: {Math.round(scored.dataConfidence * 100)}%
            </div>
          </div>
        </div>

        {/* Breakdown Bars */}
        <div className="space-y-3.5 pt-1">
          {metrics.map((m, idx) => {
            const Icon = m.icon;
            return (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-medium text-slate-200">
                    <Icon className="w-3.5 h-3.5 text-slate-400" />
                    {m.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400">w: {m.weight}%</span>
                    <span className="font-mono font-bold text-white">{m.score}/100</span>
                  </div>
                </div>

                {/* Bar */}
                <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-full ${m.color} transition-all duration-500`}
                    style={{ width: `${Math.max(5, m.score)}%` }}
                  />
                </div>

                <div className="text-[10px] text-slate-400 leading-tight">
                  {m.description}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer / Formula info */}
        <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-500 text-center">
          Calculated using NightOwl Multi-Factor Engine with live OpenStreetMap tags & exponential incident decay.
        </div>
      </div>
    </div>
  );
};
