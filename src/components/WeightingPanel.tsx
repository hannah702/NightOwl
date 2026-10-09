import React from 'react';
import { Sliders, Shield, Zap, Sparkles, Moon, RotateCcw } from 'lucide-react';
import { SafetyWeights } from '../lib/scoring';

interface WeightingPanelProps {
  weights: SafetyWeights;
  onChangeWeights: (weights: SafetyWeights) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  countBarsAsSafeStops?: boolean;
  onToggleCountBarsAsSafeStops?: (val: boolean) => void;
}

export const PRESETS: Record<string, SafetyWeights> = {
  Balanced: { lighting: 35, activity: 25, havens: 20, incidents: 20, speed: 20 },
  Safest: { lighting: 45, activity: 30, havens: 35, incidents: 40, speed: 0 },
  Fastest: { lighting: 15, activity: 10, havens: 5, incidents: 10, speed: 60 },
  'Late night': { lighting: 50, activity: 15, havens: 40, incidents: 45, speed: 5 },
};

export const WeightingPanel: React.FC<WeightingPanelProps> = ({
  weights,
  onChangeWeights,
  isOpen,
  onToggleOpen,
  countBarsAsSafeStops = false,
  onToggleCountBarsAsSafeStops,
}) => {
  const updateSlider = (key: keyof SafetyWeights, val: number) => {
    onChangeWeights({
      ...weights,
      [key]: val,
    });
  };

  const applyPreset = (presetName: keyof typeof PRESETS) => {
    onChangeWeights(PRESETS[presetName]);
  };

  return (
    <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl overflow-hidden transition-all">
      <button
        onClick={onToggleOpen}
        className="w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/50 transition cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <span className="text-xs sm:text-sm font-semibold text-slate-100">
            What Matters to Me (Weights)
          </span>
        </div>
        <span className="text-[11px] text-emerald-400 font-medium">
          {isOpen ? 'Collapse ▲' : 'Customize Sliders ▼'}
        </span>
      </button>

      {isOpen && (
        <div className="p-3.5 pt-1 space-y-3.5 border-t border-slate-800/80">
          {/* Preset Buttons */}
          <div>
            <div className="text-[11px] font-medium text-slate-400 mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              Presets:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {Object.keys(PRESETS).map((p) => (
                <button
                  key={p}
                  onClick={() => applyPreset(p)}
                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700/80 transition text-center cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-2.5 text-xs">
            {/* Lighting */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span className="flex items-center gap-1">
                  💡 Street Lighting
                </span>
                <span className="font-mono text-emerald-400">{weights.lighting}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.lighting}
                onChange={(e) => updateSlider('lighting', Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
            </div>

            {/* Pedestrian Activity / Open Shops */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span className="flex items-center gap-1">
                  👥 Crowds & Open Businesses
                </span>
                <span className="font-mono text-emerald-400">{weights.activity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.activity}
                onChange={(e) => updateSlider('activity', Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
            </div>

            {/* Safe Havens */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span className="flex items-center gap-1">
                  🛡️ Proximity to Safe Havens (24h/Medical/Police)
                </span>
                <span className="font-mono text-emerald-400">{weights.havens}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.havens}
                onChange={(e) => updateSlider('havens', Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
            </div>

            {/* Reported Incidents */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span className="flex items-center gap-1">
                  ⚠️ Avoid Reported Incidents (Dark spots/harassment)
                </span>
                <span className="font-mono text-emerald-400">{weights.incidents}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.incidents}
                onChange={(e) => updateSlider('incidents', Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
            </div>

            {/* Speed vs Safety */}
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span className="flex items-center gap-1">
                  ⚡ Speed / Brevity Preference
                </span>
                <span className="font-mono text-emerald-400">{weights.speed}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={weights.speed}
                onChange={(e) => updateSlider('speed', Number(e.target.value))}
                className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
            </div>

            {/* Bars & Pubs as Safe Stops Toggle */}
            {onToggleCountBarsAsSafeStops && (
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <span>🍺</span>
                    <span>Count bars and pubs as safe stops</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Include active nightlife venues in safe havens when open
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onToggleCountBarsAsSafeStops(!countBarsAsSafeStops)}
                  className={`w-10 h-6 flex items-center rounded-full p-1 cursor-pointer transition ${
                    countBarsAsSafeStops ? 'bg-emerald-600 justify-end' : 'bg-slate-700 justify-start'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white shadow-md transform transition" />
                </button>
              </div>
            )}
          </div>

          <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400">
            <span>Routes re-rank immediately as weights change.</span>
            <button
              onClick={() => applyPreset('Balanced')}
              className="flex items-center gap-1 text-slate-300 hover:text-white"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
