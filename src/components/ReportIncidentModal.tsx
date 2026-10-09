import React, { useState } from 'react';
import { X, AlertTriangle, Moon, Lightbulb, UserX, EyeOff, ShieldAlert, Loader2 } from 'lucide-react';
import { CrowdsourcedReport } from '../lib/scoring';

interface ReportIncidentModalProps {
  isOpen: boolean;
  onClose: () => void;
  coordinates: { lat: number; lng: number } | null;
  onSubmitReport: (report: {
    lat: number;
    lng: number;
    type: CrowdsourcedReport['type'];
    note?: string;
  }) => Promise<void>;
  onSelectPinOnMap: () => void;
}

export const REPORT_TYPES: {
  type: CrowdsourcedReport['type'];
  label: string;
  desc: string;
  icon: any;
  color: string;
}[] = [
  {
    type: 'dark_patch',
    label: 'Dark Patch / No Lights',
    desc: 'Unlit street section, shadows, non-functional illumination',
    icon: Moon,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  },
  {
    type: 'broken_streetlight',
    label: 'Broken Streetlight',
    desc: 'Flickering or damaged lighting fixture',
    icon: Lightbulb,
    color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  },
  {
    type: 'harassment',
    label: 'Harassment / Catcalling',
    desc: 'Hostile behaviour, verbal harassment, intimidation',
    icon: UserX,
    color: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  },
  {
    type: 'suspicious_activity',
    label: 'Suspicious Activity',
    desc: 'Loitering in dark alley, stalking, feeling unsafe',
    icon: EyeOff,
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  },
  {
    type: 'isolated_area',
    label: 'Unsafe / Deserted Area',
    desc: 'Empty road with zero exits, dead end, high perimeter walls',
    icon: ShieldAlert,
    color: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  },
  {
    type: 'other',
    label: 'Other Concern',
    desc: 'Any other safety hazard or barrier',
    icon: AlertTriangle,
    color: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
  },
];

export const ReportIncidentModal: React.FC<ReportIncidentModalProps> = ({
  isOpen,
  onClose,
  coordinates,
  onSubmitReport,
  onSelectPinOnMap,
}) => {
  const [selectedType, setSelectedType] = useState<CrowdsourcedReport['type']>('dark_patch');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!coordinates) {
      alert('Please select a location on the map first.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmitReport({
        lat: coordinates.lat,
        lng: coordinates.lng,
        type: selectedType,
        note: note.trim() || undefined,
      });
      onClose();
    } catch (err) {
      alert('Failed to submit report. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Report Safety Concern</h2>
              <p className="text-xs text-slate-400">Anonymous community crowdsourced report</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Location selector */}
        <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-400">Report Coordinates</div>
            <div className="text-xs font-mono font-medium text-slate-200 mt-0.5">
              {coordinates ? `${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}` : 'No location selected'}
            </div>
          </div>
          <button
            type="button"
            onClick={onSelectPinOnMap}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-medium border border-slate-700 transition"
          >
            {coordinates ? 'Change Pin' : 'Select on Map'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Incident Type Choice */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300">
              What hazard did you notice?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {REPORT_TYPES.map((item) => {
                const Icon = item.icon;
                const isSelected = selectedType === item.type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => setSelectedType(item.type)}
                    className={`p-2.5 rounded-2xl text-left border transition flex items-start gap-2.5 ${
                      isSelected
                        ? `${item.color} ring-2 ring-amber-500/50 bg-slate-800`
                        : 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-800/60 text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">{item.label}</div>
                      <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{item.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Note */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">
              Optional Note (Keep anonymous, no personal details)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Streetlamp flickering violently near bus stop shelter..."
              maxLength={250}
              rows={2}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none"
            />
          </div>

          <div className="text-[10px] text-slate-500 bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/60 leading-relaxed">
            🛡️ Reports undergo anti-abuse rate limits and decay exponentially over 14–30 days. Community confirmations increase their impact on future route scoring.
          </div>

          {/* Submit */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !coordinates}
              className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-amber-950 transition flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
