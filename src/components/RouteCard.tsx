import React, { useState, useEffect } from 'react';
import { Shield, Clock, Navigation, AlertTriangle, ChevronRight, BarChart2, Sparkles } from 'lucide-react';
import { ScoredRouteResult, formatDuration, formatDistance } from '../lib/scoring';
import { RouteOption } from '../lib/routing';

interface RouteCardProps {
  route: RouteOption;
  scored: ScoredRouteResult;
  isSelected: boolean;
  onSelect: () => void;
  onOpenBreakdown: () => void;
  onStartLiveWalk: () => void;
  timeString: string;
  isCampusMode: boolean;
  isRecalculating?: boolean;
  benchmarkRoute?: { option: RouteOption; scored: ScoredRouteResult };
}

/**
 * Deterministic local explanation generated strictly from scored route numbers
 */
function buildDeterministicExplanation(
  route: RouteOption,
  scored: ScoredRouteResult,
  benchmark?: { option: RouteOption; scored: ScoredRouteResult }
): string {
  const parts: string[] = [];

  if (scored.hasLightingData && scored.litPercent >= 75) {
    parts.push(`${scored.litPercent}% illuminated with verified street lighting`);
  } else if (!scored.hasLightingData) {
    parts.push(`estimated ${scored.litPercent}% illuminated (unverified OSM lighting)`);
  } else if (scored.unlitDistanceMeters > 0) {
    parts.push(`contains a ${Math.round(scored.unlitDistanceMeters)}m dimmer stretch`);
  }

  if (scored.openHavensPassedCount > 0) {
    parts.push(`passes within 100m of ${scored.openHavensPassedCount} open safe haven${scored.openHavensPassedCount > 1 ? 's' : ''}`);
  } else {
    parts.push(`no open safe havens directly on this path`);
  }

  if (scored.openPlacesSummary && scored.openPlacesSummary.startsWith('Passes')) {
    parts.push(scored.openPlacesSummary.charAt(0).toLowerCase() + scored.openPlacesSummary.slice(1));
  } else if (scored.openPlacesCount > 0) {
    parts.push(`crosses ${scored.openPlacesCount} open businesses with pedestrian activity`);
  }

  if (benchmark && benchmark.scored.routeIndex !== scored.routeIndex) {
    const timeDiffMins = Math.round((route.duration - benchmark.option.duration) / 60);
    const scoreDiff = scored.safetyScore - benchmark.scored.safetyScore;

    if (Math.abs(timeDiffMins) > 0) {
      const diffStr = Math.abs(timeDiffMins) === 1 ? '1 min' : `${Math.abs(timeDiffMins)} mins`;
      if (timeDiffMins > 0) {
        return `This route is ${diffStr} longer than the fastest route, but ${parts.slice(0, 2).join(', ')}.`;
      } else {
        return `This route is ${diffStr} faster, keeping a ${scored.safetyScore}/100 safety score (${parts.slice(0, 2).join(', ')}).`;
      }
    }
  }

  return `Rated ${scored.safetyScore}/100: ${parts.slice(0, 3).join(', ')}.`;
}

export const RouteCard: React.FC<RouteCardProps> = ({
  route,
  scored,
  isSelected,
  onSelect,
  onOpenBreakdown,
  onStartLiveWalk,
  timeString,
  isCampusMode,
  isRecalculating = false,
  benchmarkRoute,
}) => {
  // Deterministic template first; server AI only enhances if available
  const defaultExplanation = buildDeterministicExplanation(route, scored, benchmarkRoute);
  const [explanation, setExplanation] = useState<string>(defaultExplanation);
  const [isLoadingExplanation, setIsLoadingExplanation] = useState(false);

  // Dev-time assertion: verify integrity between card and breakdown expectations
  if (process.env.NODE_ENV !== 'production') {
    if (typeof scored.litPercent !== 'number' || typeof scored.openHavensPassedCount !== 'number') {
      console.error('[NightOwl Integrity Error] RouteCard litPercent or openHavensPassedCount is missing/corrupt:', scored);
    }
  }

  // Safety score badge styling
  const score = scored.safetyScore;
  const scoreColor =
    score >= 75
      ? 'text-emerald-400 bg-emerald-500/15 border-emerald-500/40'
      : score >= 50
      ? 'text-amber-400 bg-amber-500/15 border-amber-500/40'
      : 'text-rose-400 bg-rose-500/15 border-rose-500/40';

  // Update explanation when scored object or timeString changes
  useEffect(() => {
    let isCancelled = false;
    const fallbackText = buildDeterministicExplanation(route, scored, benchmarkRoute);
    setExplanation(fallbackText);

    async function fetchServerExplanation() {
      setIsLoadingExplanation(true);
      try {
        const payload = {
          selectedRouteStats: {
            name: route.name,
            safetyScore: scored.safetyScore,
            rawDuration: scored.rawDuration,
            rawDistance: scored.rawDistance,
            litPercent: scored.litPercent,
            unlitDistanceMeters: scored.unlitDistanceMeters,
            openPlacesCount: scored.openPlacesCount,
            openHavensPassedCount: scored.openHavensPassedCount,
            longestHavenGapMeters: scored.longestHavenGapMeters,
            nearbyIncidentsCount: scored.nearbyIncidentsCount,
          },
          alternativeRouteStats: benchmarkRoute && benchmarkRoute.scored.routeIndex !== scored.routeIndex ? {
            name: benchmarkRoute.option.name,
            safetyScore: benchmarkRoute.scored.safetyScore,
            rawDuration: benchmarkRoute.scored.rawDuration,
            rawDistance: benchmarkRoute.scored.rawDistance,
            litPercent: benchmarkRoute.scored.litPercent,
            openHavensPassedCount: benchmarkRoute.scored.openHavensPassedCount,
          } : undefined,
          timeString,
          isCampusMode,
        };

        const res = await fetch('/api/routes/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && data.explanation) {
            setExplanation(data.explanation);
          }
        }
      } catch {
        // Deterministic template already set as fallback
      } finally {
        if (!isCancelled) setIsLoadingExplanation(false);
      }
    }

    fetchServerExplanation();

    return () => {
      isCancelled = true;
    };
  }, [route.id, scored.safetyScore, scored.litPercent, scored.openHavensPassedCount, timeString, isCampusMode]);

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl p-3.5 transition-all cursor-pointer border relative overflow-hidden ${
        isSelected
          ? 'bg-slate-900 border-emerald-500/60 shadow-xl ring-2 ring-emerald-500/20'
          : 'bg-slate-900/60 hover:bg-slate-900/90 border-slate-800 shadow-md'
      }`}
    >
      {/* Recalculating Shimmer Overlay (<300 ms feedback) */}
      {isRecalculating && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center z-10 animate-pulse pointer-events-none">
          <span className="text-[10px] bg-slate-800 text-sky-400 px-2 py-0.5 rounded-full border border-sky-500/40 font-mono">
            Recalculating for {timeString}...
          </span>
        </div>
      )}

      {/* Top Header: Title, Score Badge */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-slate-100 truncate">
              {route.name}
            </h3>
            {isSelected && (
              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-medium shrink-0">
                Selected
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
            <span className="flex items-center gap-1 font-medium text-slate-200">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              {formatDuration(route.duration)}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Navigation className="w-3.5 h-3.5 text-slate-400" />
              {formatDistance(route.distance)}
            </span>
            <span>•</span>
            <span className="text-slate-400">
              Confidence: {Math.round(scored.dataConfidence * 100)}%
            </span>
          </div>
          {/* Active Scoring Time Sub-label */}
          <div className="text-[10px] text-sky-400/90 font-mono mt-0.5">
            Scoring for: {timeString}
          </div>
        </div>

        {/* Safety Score Badge */}
        <div className={`flex flex-col items-center justify-center px-2.5 py-1.5 rounded-xl border ${scoreColor} shrink-0`}>
          <span className="text-lg font-bold leading-none">{score}</span>
          <span className="text-[9px] font-semibold tracking-wider uppercase mt-0.5">Safety</span>
        </div>
      </div>

      {/* Campus Notice if gate closed */}
      {route.campusNotice && route.campusNotice.trim().length > 0 && !route.campusNotice.includes('()') && (
        <div className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-800/40 px-2.5 py-1.5 rounded-xl mb-2 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
          <span>{route.campusNotice}</span>
        </div>
      )}

      {/* Feature Metric Chips */}
      <div className="flex flex-wrap gap-1.5 mb-2.5 text-[11px]">
        <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700/60 flex items-center gap-1">
          💡 {scored.litPercent}% Lit {!scored.hasLightingData && <span className="text-[9px] text-slate-400">(est)</span>}
        </span>
        <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700/60 flex items-center gap-1">
          🛡️ {scored.openHavensPassedCount} Open Havens
        </span>
        {scored.hasHavensNearby && scored.longestHavenGapMeters > 0 ? (
          <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700/60 flex items-center gap-1">
            Max Haven Gap: {formatDistance(scored.longestHavenGapMeters)}
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-lg bg-slate-800/70 text-slate-400 border border-slate-700/60 flex items-center gap-1">
            No safe havens mapped nearby
          </span>
        )}
        {scored.openPlacesCount > 0 && (
          <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700/60 flex items-center gap-1">
            🏪 {scored.openPlacesCount} Open Shops
          </span>
        )}
      </div>

      {/* Natural Language Route Explanation */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 mb-3 text-xs text-slate-300 leading-relaxed">
        {isLoadingExplanation ? (
          <div className="flex items-center gap-2 text-slate-400 text-xs">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Generating safety explanation...
          </div>
        ) : (
          <p className="flex items-start gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
            <span>{explanation}</span>
          </p>
        )}
      </div>

      {/* Actions: View Breakdown & Start Walk */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenBreakdown();
          }}
          className="text-xs text-slate-400 hover:text-emerald-400 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Score Breakdown
        </button>

        {isSelected && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartLiveWalk();
            }}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-950 flex items-center gap-1.5 transition cursor-pointer"
          >
            <Navigation className="w-3.5 h-3.5" />
            Start Live Walk
          </button>
        )}
      </div>
    </div>
  );
};
