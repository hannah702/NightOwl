import React from 'react';
import { Shield, Sparkles, Sun, Users, MapPin, AlertCircle, X, ChevronRight } from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Welcome to NightOwl</h2>
              <p className="text-xs text-slate-400">Safety-Aware Walking Navigation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          Standard navigation maps optimize solely for distance and time. A short route through an unlit, deserted alley is not the same as a slightly longer walk down a well-lit commercial avenue. NightOwl scores pedestrian routes using five real-world public safety factors:
        </p>

        {/* 5 pillars */}
        <div className="space-y-2.5 pt-1">
          <div className="p-2.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">💡</span>
            <div>
              <h4 className="text-xs font-semibold text-slate-100">Street Lighting</h4>
              <p className="text-[11px] text-slate-400">Verified illuminated segments via OpenStreetMap <code className="text-amber-300">lit=yes</code> tags.</p>
            </div>
          </div>

          <div className="p-2.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">🏪</span>
            <div>
              <h4 className="text-xs font-semibold text-slate-100">Pedestrian Activity & Open Stores</h4>
              <p className="text-[11px] text-slate-400">Evaluates nearby cafes, pharmacies, and transit hubs open at your specific walk time.</p>
            </div>
          </div>

          <div className="p-2.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 shrink-0">🛡️</span>
            <div>
              <h4 className="text-xs font-semibold text-slate-100">Safe Havens Proximity</h4>
              <p className="text-[11px] text-slate-400">Tracks closeness to 24h stores, medical centers, emergency police booths, and hostel gates.</p>
            </div>
          </div>

          <div className="p-2.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-3">
            <span className="p-2 rounded-xl bg-rose-500/10 text-rose-400 shrink-0">⚠️</span>
            <div>
              <h4 className="text-xs font-semibold text-slate-100">Community Incident Reports</h4>
              <p className="text-[11px] text-slate-400">Crowdsourced dark patches, broken lights, and safety hazards decayed over time.</p>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="p-3.5 rounded-2xl bg-amber-950/40 border border-amber-800/50 text-amber-200/90 text-xs leading-relaxed flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-amber-300">Public Data Disclaimer:</span>
            <p className="mt-0.5 text-[11px] text-amber-200/80">
              Safety scores are heuristic estimates calculated from OpenStreetMap tags, time-of-day multipliers, and community reports. NightOwl does not guarantee personal safety. Always remain alert, trust your instincts, and call local emergency services immediately if you feel threatened.
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs sm:text-sm shadow-xl shadow-emerald-950 transition flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>Got It, Let's Navigate</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
