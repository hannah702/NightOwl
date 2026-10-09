declare module 'opening_hours' {
  export default class opening_hours {
    constructor(openingHoursString: string, nominatimObject?: unknown, mode?: unknown);
    getState(date?: Date): boolean;
    getNextChange?(date?: Date): Date | undefined;
    getComment(date?: Date): string;
    getOpenIntervals(from?: Date, to?: Date): Array<[Date, Date, boolean, string]>;
    getMatchingRule(date?: Date): unknown;
  }
}
