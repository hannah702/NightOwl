export interface CampusGate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  opensAt: string;  // "HH:MM" 24h
  closesAt: string; // "HH:MM" 24h
}

export interface RestrictedArea {
  id: string;
  name: string;
  reason?: string;
  polygon: [number, number][]; // [lat, lng]
}

export interface CampusZone {
  id: string;
  name: string;
  polygon: [number, number][]; // [lat, lng]
  gates: CampusGate[];
  restrictedAreas: RestrictedArea[];
  curfew?: {
    start: string; // "HH:MM"
    end: string;   // "HH:MM"
  };
}
