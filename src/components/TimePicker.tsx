import React from 'react';
import { Clock, Moon, Sun, AlertTriangle } from 'lucide-react';

interface TimePickerProps {
  selectedTime: Date;
  onChangeTime: (date: Date) => void;
}

export const TimePicker: React.FC<TimePickerProps> = ({ selectedTime, onChangeTime }) => {
  // Validate selectedTime is valid date
  const safeTime = (!selectedTime || isNaN(selectedTime.getTime())) ? new Date() : selectedTime;
  const hour = safeTime.getHours();
  const isNight = hour >= 21 || hour < 5;
  const isLateNight = hour >= 23 || hour < 4;

  const setPreset = (preset: 'now' | '7pm' | '10pm' | '1am') => {
    const now = new Date();
    if (preset === 'now') {
      onChangeTime(now);
      return;
    }

    const target = new Date(now);
    let targetHour = 19;
    if (preset === '7pm') targetHour = 19;
    else if (preset === '10pm') targetHour = 22;
    else if (preset === '1am') targetHour = 1;

    target.setHours(targetHour, 0, 0, 0);

    // If target hour has already passed today, advance to the next occurrence (tomorrow)
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    if (!isNaN(target.getTime())) {
      onChangeTime(target);
    }
  };

  const handleCustomTime = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [h, m] = val.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return;

    const target = new Date(safeTime);
    target.setHours(h, m, 0, 0);
    if (!isNaN(target.getTime())) {
      onChangeTime(target);
    }
  };

  const formattedTimeLabel = (() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(safeTime);
    } catch {
      return 'Now';
    }
  })();

  const timeInputVal = `${String(safeTime.getHours()).padStart(2, '0')}:${String(safeTime.getMinutes()).padStart(2, '0')}`;

  return (
    <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-2xl p-3 shadow-2xl">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Clock className="w-3.5 h-3.5 text-sky-400" />
          <span>Walk Time:</span>
          <span className="text-sky-400 font-mono">{formattedTimeLabel}</span>
        </div>

        <div className="relative flex items-center">
          <input
            type="time"
            value={timeInputVal}
            onChange={handleCustomTime}
            className="bg-slate-800 text-slate-200 text-xs px-2 py-1 rounded-lg border border-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-400 font-mono"
            aria-label="Custom walk time"
          />
        </div>
      </div>

      {/* Quick Select Buttons */}
      <div className="grid grid-cols-4 gap-1.5 text-[11px] font-medium">
        <button
          type="button"
          onClick={() => setPreset('now')}
          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition flex items-center justify-center gap-1 cursor-pointer"
        >
          <Sun className="w-3 h-3 text-amber-400" />
          Now
        </button>
        <button
          type="button"
          onClick={() => setPreset('7pm')}
          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition flex items-center justify-center gap-1 cursor-pointer"
        >
          7 PM
        </button>
        <button
          type="button"
          onClick={() => setPreset('10pm')}
          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition flex items-center justify-center gap-1 cursor-pointer"
        >
          <Moon className="w-3 h-3 text-indigo-400" />
          10 PM
        </button>
        <button
          type="button"
          onClick={() => setPreset('1am')}
          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition flex items-center justify-center gap-1 cursor-pointer"
        >
          <Moon className="w-3 h-3 text-violet-400" />
          1 AM
        </button>
      </div>

      {/* Night-time warning context */}
      {isNight && (
        <div className="mt-2.5 text-[10px] text-amber-300/90 bg-amber-950/40 border border-amber-800/40 px-2 py-1.5 rounded-lg flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          <span>
            {isLateNight
              ? 'Night Multiplier Active: Foot traffic is sparse. Lighting and open havens weighted heavily.'
              : 'Evening Mode: Lighting and active storefronts weighted higher.'}
          </span>
        </div>
      )}
    </div>
  );
};
