import React, { useState } from 'react';
import { X, Building, Plus, Trash2, Download, Upload, MapPin, ShieldAlert, Clock, Check, AlertCircle } from 'lucide-react';
import { CampusZone, CampusGate, RestrictedArea } from '../types/zones';

interface ZoneManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  zones: CampusZone[];
  onSaveZones: (zones: CampusZone[]) => void;
  onStartMapDraw: (zoneId: string, drawType: 'polygon' | 'gate' | 'restricted') => void;
  activeDrawingTarget: { zoneId: string; drawType: 'polygon' | 'gate' | 'restricted' } | null;
}

export const ZoneManagerModal: React.FC<ZoneManagerModalProps> = ({
  isOpen,
  onClose,
  zones,
  onSaveZones,
  onStartMapDraw,
  activeDrawingTarget,
}) => {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(zones[0]?.id || null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [showImportBox, setShowImportBox] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Form states for new zone
  const [newZoneName, setNewZoneName] = useState('');
  const [newGateName, setNewGateName] = useState('');
  const [newGateOpen, setNewGateOpen] = useState('06:00');
  const [newGateClose, setNewGateClose] = useState('22:00');
  const [newGateLat, setNewGateLat] = useState('');
  const [newGateLng, setNewGateLng] = useState('');

  if (!isOpen) return null;

  const currentZone = zones.find(z => z.id === selectedZoneId) || null;

  const handleCreateZone = () => {
    if (!newZoneName.trim()) return;
    const newId = `zone-${Date.now()}`;
    const newZone: CampusZone = {
      id: newId,
      name: newZoneName.trim(),
      polygon: [],
      gates: [],
      restrictedAreas: [],
    };
    const updated = [...zones, newZone];
    onSaveZones(updated);
    setSelectedZoneId(newId);
    setNewZoneName('');
    setIsCreatingNew(false);
  };

  const handleDeleteZone = (id: string) => {
    if (confirm('Are you sure you want to delete this campus zone?')) {
      const updated = zones.filter(z => z.id !== id);
      onSaveZones(updated);
      setSelectedZoneId(updated[0]?.id || null);
    }
  };

  const handleAddGate = () => {
    if (!currentZone || !newGateName.trim()) return;
    const lat = parseFloat(newGateLat);
    const lng = parseFloat(newGateLng);
    if (isNaN(lat) || isNaN(lng)) {
      alert('Please enter valid numeric latitude and longitude coordinates, or use "Click on Map" to place gate.');
      return;
    }

    const newGate: CampusGate = {
      id: `gate-${Date.now()}`,
      name: newGateName.trim(),
      lat,
      lng,
      opensAt: newGateOpen,
      closesAt: newGateClose,
    };

    const updated = zones.map(z => z.id === currentZone.id ? {
      ...z,
      gates: [...z.gates, newGate],
    } : z);

    onSaveZones(updated);
    setNewGateName('');
    setNewGateLat('');
    setNewGateLng('');
  };

  const handleDeleteGate = (gateId: string) => {
    if (!currentZone) return;
    const updated = zones.map(z => z.id === currentZone.id ? {
      ...z,
      gates: z.gates.filter(g => g.id !== gateId),
    } : z);
    onSaveZones(updated);
  };

  const handleDeleteRestricted = (resId: string) => {
    if (!currentZone) return;
    const updated = zones.map(z => z.id === currentZone.id ? {
      ...z,
      restrictedAreas: z.restrictedAreas.filter(r => r.id !== resId),
    } : z);
    onSaveZones(updated);
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(zones, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'nightowl-campus-zones.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportJson = () => {
    setImportError(null);
    try {
      const parsed = JSON.parse(importJsonText);
      if (!Array.isArray(parsed)) {
        throw new Error('Imported data must be an array of campus zones.');
      }
      onSaveZones(parsed);
      setSelectedZoneId(parsed[0]?.id || null);
      setShowImportBox(false);
      setImportJsonText('');
      alert('Campus zones imported successfully!');
    } catch (err: any) {
      setImportError(err?.message || 'Invalid JSON format.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Manage Campus Zones</h2>
              <p className="text-xs text-slate-400">Configure zone perimeters, operating gates, and curfews</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action bar: Export / Import / Add */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsCreatingNew(true)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              New Zone
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={handleExportJson}
              disabled={zones.length === 0}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-xl font-medium flex items-center gap-1 transition cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-sky-400" />
              Export JSON
            </button>
            <button
              onClick={() => setShowImportBox(!showImportBox)}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-medium flex items-center gap-1 transition cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              Import JSON
            </button>
          </div>
        </div>

        {/* JSON Import Box */}
        {showImportBox && (
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-2 text-xs">
            <label className="font-semibold text-slate-300">Paste Campus Zones JSON:</label>
            <textarea
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder='[{"id":"my-campus","name":"University Campus","polygon":[[...]],"gates":[]}]'
              rows={4}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 font-mono text-slate-200 text-xs focus:ring-1 focus:ring-indigo-500"
            />
            {importError && (
              <div className="text-rose-400 text-xs flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {importError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowImportBox(false)}
                className="px-3 py-1 bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleImportJson}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold"
              >
                Apply Import
              </button>
            </div>
          </div>
        )}

        {/* Create New Zone Form */}
        {isCreatingNew && (
          <div className="p-3 bg-indigo-950/30 border border-indigo-500/30 rounded-2xl space-y-2 text-xs">
            <label className="font-semibold text-indigo-300">Zone / Campus Name:</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. University North Campus"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-white"
              />
              <button
                onClick={handleCreateZone}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold"
              >
                Create
              </button>
              <button
                onClick={() => setIsCreatingNew(false)}
                className="px-2.5 py-1.5 bg-slate-800 text-slate-400 hover:text-white rounded-xl"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Zone Selection Tabs */}
        {zones.length === 0 ? (
          <div className="py-8 text-center text-slate-400 space-y-2">
            <Building className="w-8 h-8 mx-auto text-slate-600" />
            <div className="text-sm font-semibold text-slate-300">No Campus Zones Configured</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              NightOwl routes normally along public streets. You can create a zone above to enforce campus gate hours and restricted area avoidance.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Zone Selector Pill Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {zones.map(z => (
                <button
                  key={z.id}
                  onClick={() => setSelectedZoneId(z.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                    z.id === selectedZoneId
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {z.name} ({z.gates.length} gates)
                </button>
              ))}
            </div>

            {currentZone && (
              <div className="space-y-3 p-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl text-xs">
                {/* Zone Info & Delete */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div>
                    <h3 className="font-bold text-white text-sm">{currentZone.name}</h3>
                    <p className="text-slate-400 text-[11px]">
                      Perimeter: {currentZone.polygon.length} points • Gates: {currentZone.gates.length} • Restricted Areas: {currentZone.restrictedAreas.length}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onStartMapDraw(currentZone.id, 'polygon')}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                        activeDrawingTarget?.zoneId === currentZone.id && activeDrawingTarget?.drawType === 'polygon'
                          ? 'bg-amber-600 text-white border-amber-500'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                      }`}
                    >
                      {activeDrawingTarget?.zoneId === currentZone.id && activeDrawingTarget?.drawType === 'polygon'
                        ? 'Drawing Boundary...'
                        : 'Draw Boundary on Map'}
                    </button>
                    <button
                      onClick={() => handleDeleteZone(currentZone.id)}
                      className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-slate-800 rounded-lg transition"
                      title="Delete Zone"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Gates Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-emerald-400" />
                      Operating Gates ({currentZone.gates.length}):
                    </span>
                    <button
                      onClick={() => onStartMapDraw(currentZone.id, 'gate')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                        activeDrawingTarget?.zoneId === currentZone.id && activeDrawingTarget?.drawType === 'gate'
                          ? 'bg-emerald-600 text-white border-emerald-500'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                      }`}
                    >
                      {activeDrawingTarget?.zoneId === currentZone.id && activeDrawingTarget?.drawType === 'gate'
                        ? 'Click Map to Place Gate'
                        : '+ Click Map for Gate'}
                    </button>
                  </div>

                  {/* Gates List */}
                  {currentZone.gates.length === 0 ? (
                    <div className="text-slate-500 text-[11px] italic">No gates defined. All perimeter points open.</div>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto">
                      {currentZone.gates.map(gate => (
                        <div
                          key={gate.id}
                          className="flex items-center justify-between p-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px]"
                        >
                          <div>
                            <span className="font-semibold text-slate-100">{gate.name}</span>
                            <span className="text-slate-400 ml-2">
                              Hours: {gate.opensAt} – {gate.closesAt}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDeleteGate(gate.id)}
                            className="p-1 text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Manual Add Gate Form */}
                  <div className="pt-2 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                    <input
                      type="text"
                      placeholder="Gate Name"
                      value={newGateName}
                      onChange={(e) => setNewGateName(e.target.value)}
                      className="col-span-2 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-white"
                    />
                    <input
                      type="text"
                      placeholder="Lat (e.g. 8.50)"
                      value={newGateLat}
                      onChange={(e) => setNewGateLat(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-white font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Lng (e.g. 76.95)"
                      value={newGateLng}
                      onChange={(e) => setNewGateLng(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-white font-mono"
                    />
                    <button
                      onClick={handleAddGate}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-2 py-1 text-[11px] font-semibold"
                    >
                      Add Gate
                    </button>
                  </div>
                </div>

                {/* Restricted Areas Section */}
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                      Restricted Areas ({currentZone.restrictedAreas.length}):
                    </span>
                    <button
                      onClick={() => onStartMapDraw(currentZone.id, 'restricted')}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border ${
                        activeDrawingTarget?.zoneId === currentZone.id && activeDrawingTarget?.drawType === 'restricted'
                          ? 'bg-rose-600 text-white border-rose-500'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                      }`}
                    >
                      {activeDrawingTarget?.zoneId === currentZone.id && activeDrawingTarget?.drawType === 'restricted'
                        ? 'Drawing Hazard...'
                        : '+ Draw Hazard Polygon'}
                    </button>
                  </div>

                  {currentZone.restrictedAreas.map(res => (
                    <div
                      key={res.id}
                      className="flex items-center justify-between p-2 rounded-xl bg-rose-950/20 border border-rose-500/20 text-[11px]"
                    >
                      <div>
                        <span className="font-semibold text-rose-300">{res.name}</span>
                        {res.reason && <span className="text-slate-400 ml-2">({res.reason})</span>}
                      </div>
                      <button
                        onClick={() => handleDeleteRestricted(res.id)}
                        className="p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="pt-2 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
