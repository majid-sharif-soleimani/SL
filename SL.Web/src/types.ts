export interface LineConfig {
  stopGroupSearchName: string;
  lineNumber: string;
  origin: string;
  destination: string;
}

export interface AppSettings {
  apiKey: string;
  timeWindowMinutes: number;
  lines: LineConfig[];
}

export interface StopGroup {
  id: string;
  name: string;
}

export interface Arrival {
  realtime: Date;
  scheduled: Date;
  route: Route;
  trip: Trip;
  stop: Stop;
}

export interface Route {
  designation: string;
  transportMode: string;
  direction: string;
  originName: string;
  destinationName: string;
}

export interface Trip {
  tripId: string;
  startDate: string;
}

export interface Stop {
  id: string;
  name: string;
}

export interface TripCall {
  scheduledDeparture?: string;
  realtimeDeparture?: string;
  scheduledArrival?: string;
  realtimeArrival?: string;
  stopId?: string;
  stopName?: string;
}

export interface UpcomingBusArrival {
  configuredStopGroupName: string;
  lineNumber: string;
  origin: string;
  destination: string;
  direction: string;
  arrivalTime: Date;
  minutesUntilArrival: number;
  tripId: string;
  tripStartDate: string;
  stationName: string;
  stationNumber: string;
}

export interface InferredBusPosition {
  lastStopName: string;
  nextStopName: string;
  stopsRemainingToTarget?: number;
  targetStationNumber: string;
}

export interface UpcomingBusLineSummary {
  configuredStopGroupName: string;
  configuredStopGroupAreaId: string;
  lineNumber: string;
  configuredOrigin: string;
  configuredDestination: string;
  nextArrivalTime: Date;
  nextArrivalStationName: string;
  nextTripId: string;
  nextTripStartDate: string;
  position?: InferredBusPosition;
}

export interface UpcomingBusQueryResult {
  requestedAt: Date;
  timeWindowMinutes: number;
  arrivals: UpcomingBusArrival[];
  lines: UpcomingBusLineSummary[];
  note: string;
}

export interface StationLineRouteOptions {
  origins: string[];
  destinations: string[];
  pairs: Array<{ origin: string; destination: string }>;
}

export interface StationRouteSuggestions {
  lineNumbers: string[];
  origins: string[];
  destinations: string[];
  byLine: Record<string, StationLineRouteOptions>;
}
