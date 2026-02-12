import {
  AppSettings,
  Arrival,
  InferredBusPosition,
  LineConfig,
  StopGroup,
  StationRouteSuggestions,
  TripCall,
  UpcomingBusArrival,
  UpcomingBusLineSummary,
  UpcomingBusQueryResult
} from "./types";

const DEFAULT_BASE_URL = "https://realtime-api.trafiklab.se/v1";
const STATIONS_CACHE_KEY = "sl_all_stations_cache_v1";
const STATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class SLApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private static stationsMemoryCache: string[] | null = null;

  constructor(apiKey: string, baseUrl: string = DEFAULT_BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getUpcomingBuses(settings: AppSettings, now: Date = new Date()): Promise<UpcomingBusQueryResult | null> {
    const allArrivals: UpcomingBusArrival[] = [];
    const lineSummaries: UpcomingBusLineSummary[] = [];

    for (const line of settings.lines) {
      const stopGroups = await this.findStopGroups(line.stopGroupSearchName);
      if (stopGroups.length === 0) continue;

      for (const stopGroup of stopGroups) {
        const arrivals = await this.getArrivals(stopGroup.id);
        const filtered = this.filterArrivals(arrivals, line, settings.timeWindowMinutes, now)
          .filter((arrival) => arrival.route.designation.trim().length > 0);

        allArrivals.push(
          ...filtered
            .map((arrival) => this.mapArrival(arrival, line.stopGroupSearchName, now))
            .filter((arrival) => arrival.lineNumber.trim().length > 0)
        );

        if (filtered.length === 0) continue;

        const next = filtered[0];
        const calls = await this.getTripCalls(next.trip.tripId, next.trip.startDate);
        const position = inferPosition(calls, now, next.stop.id);

        lineSummaries.push({
          configuredStopGroupName: line.stopGroupSearchName,
          configuredStopGroupAreaId: stopGroup.id,
          lineNumber: line.lineNumber,
          configuredOrigin: line.origin,
          configuredDestination: line.destination,
          nextArrivalTime: next.realtime,
          nextArrivalStationName: stopGroup.name,
          nextTripId: next.trip.tripId,
          nextTripStartDate: next.trip.startDate,
          position
        });
      }
    }

    if (lineSummaries.length === 0 && allArrivals.length === 0) {
      return null;
    }

    return {
      requestedAt: now,
      timeWindowMinutes: settings.timeWindowMinutes,
      arrivals: allArrivals.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime()),
      lines: lineSummaries,
      note: "SL bus GPS is not generally exposed via the public GTFS-RT VehiclePositions feed, so location is inferred from trip stop calls."
    };
  }

  async searchStations(query: string, limit: number = 15): Promise<string[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const json = await this.fetchJson(`stops/name/${encodeURIComponent(trimmed)}/?key=${encodeURIComponent(this.apiKey)}`) as {
      stop_groups?: Array<{ name?: string }>;
    };

    const names = (json.stop_groups ?? [])
      .map((group) => group.name ?? "")
      .filter((name) => name.trim().length > 0);

    return uniqueNonEmpty(names).slice(0, limit);
  }

  async getAllStations(forceRefresh: boolean = false): Promise<string[]> {
    if (!forceRefresh && SLApiClient.stationsMemoryCache && SLApiClient.stationsMemoryCache.length > 0) {
      return SLApiClient.stationsMemoryCache;
    }

    if (!forceRefresh) {
      const cached = this.readStationsCache();
      if (cached.length > 0) {
        SLApiClient.stationsMemoryCache = cached;
        return cached;
      }
    }

    let stations = await this.tryFetchAllStationsDirect();
    if (stations.length === 0) {
      stations = await this.fetchAllStationsBySearchSweep();
    }

    stations = uniqueNonEmpty(stations);
    if (stations.length > 0) {
      SLApiClient.stationsMemoryCache = stations;
      this.writeStationsCache(stations);
    }

    return stations;
  }

  async getRouteSuggestionsByStationName(stationName: string): Promise<StationRouteSuggestions> {
    const stopGroups = await this.findStopGroups(stationName);
    if (stopGroups.length === 0) {
      return { lineNumbers: [], origins: [], destinations: [], byLine: {} };
    }

    const buses: Arrival[] = [];
    for (const stopGroup of stopGroups) {
      const arrivals = await this.getArrivals(stopGroup.id);
      buses.push(...arrivals.filter((arrival) => equalIgnoreCase(arrival.route.transportMode, "BUS")));
    }

    const byLine: Record<string, { origins: string[]; destinations: string[]; pairs: Array<{ origin: string; destination: string }> }> = {};
    for (const bus of buses) {
      const line = bus.route.designation.trim();
      if (!line) continue;
      const origin = bus.route.originName.trim();
      const destination = bus.route.destinationName.trim();
      if (!byLine[line]) {
        byLine[line] = { origins: [], destinations: [], pairs: [] };
      }

      if (origin && !byLine[line].origins.some((v) => equalIgnoreCase(v, origin))) {
        byLine[line].origins.push(origin);
      }
      if (destination && !byLine[line].destinations.some((v) => equalIgnoreCase(v, destination))) {
        byLine[line].destinations.push(destination);
      }
      if (origin && destination && !byLine[line].pairs.some((p) => equalIgnoreCase(p.origin, origin) && equalIgnoreCase(p.destination, destination))) {
        byLine[line].pairs.push({ origin, destination });
      }
    }

    return {
      lineNumbers: uniqueNonEmpty([
        ...buses.map((arrival) => arrival.route.designation),
        ...Object.keys(byLine)
      ]),
      origins: uniqueNonEmpty(buses.map((arrival) => arrival.route.originName)),
      destinations: uniqueNonEmpty(buses.map((arrival) => arrival.route.destinationName)),
      byLine
    };
  }

  private async findStopGroups(search: string): Promise<StopGroup[]> {
    const json = await this.fetchJson(`stops/name/${encodeURIComponent(search)}/?key=${encodeURIComponent(this.apiKey)}`) as {
      stop_groups?: Array<{ id?: string; name?: string }>;
    };

    const groups = (json.stop_groups ?? [])
      .filter((g) => !!g.id && !!g.name)
      .map((g) => ({ id: g.id!, name: g.name! }));

    const exact = groups.filter((g) => equalIgnoreCase(g.name, search));
    if (exact.length > 0) return exact;

    return groups.filter((g) => containsIgnoreCase(g.name, search));
  }

  private async getArrivals(areaId: string): Promise<Arrival[]> {
    const json = await this.fetchJson(`arrivals/${encodeURIComponent(areaId)}?key=${encodeURIComponent(this.apiKey)}`) as {
      arrivals?: Array<Record<string, unknown>>;
    };

    return (json.arrivals ?? [])
      .map((raw) => this.parseArrival(raw))
      .filter((item): item is Arrival => item !== null);
  }

  private filterArrivals(arrivals: Arrival[], line: LineConfig, timeWindowMinutes: number, now: Date): Arrival[] {
    const from = new Date(now.getTime() - 60 * 1000);
    const to = new Date(now.getTime() + timeWindowMinutes * 60 * 1000);

    return arrivals
      .filter((a) => equalIgnoreCase(a.route.transportMode, "BUS"))
      .filter((a) => a.realtime >= from && a.realtime <= to)
      .filter((a) => equalIgnoreCase(a.route.designation, line.lineNumber))
      .filter((a) => containsIgnoreCase(a.route.originName, line.origin))
      .filter((a) => containsIgnoreCase(a.route.destinationName, line.destination))
      .sort((a, b) => a.realtime.getTime() - b.realtime.getTime());
  }

  private mapArrival(arrival: Arrival, configuredStopGroupName: string, now: Date): UpcomingBusArrival {
    const minutesUntilArrival = Math.round((arrival.realtime.getTime() - now.getTime()) / 60000);

    return {
      configuredStopGroupName,
      lineNumber: arrival.route.designation,
      origin: arrival.route.originName,
      destination: arrival.route.destinationName,
      direction: arrival.route.direction,
      arrivalTime: arrival.realtime,
      minutesUntilArrival,
      tripId: arrival.trip.tripId,
      tripStartDate: arrival.trip.startDate,
      stationName: arrival.stop.name,
      stationNumber: arrival.stop.id
    };
  }

  private async getTripCalls(tripId: string, startDate: string): Promise<TripCall[]> {
    const json = await this.fetchJson(`trips/${encodeURIComponent(tripId)}/${encodeURIComponent(startDate)}?key=${encodeURIComponent(this.apiKey)}`) as {
      calls?: Array<Record<string, unknown>>;
    };

    return (json.calls ?? []).map((call) => ({
      scheduledDeparture: asString(call.scheduledDeparture),
      realtimeDeparture: asString(call.realtimeDeparture),
      scheduledArrival: asString(call.scheduledArrival),
      realtimeArrival: asString(call.realtimeArrival),
      stopId: asString((call.stop as Record<string, unknown> | undefined)?.id),
      stopName: asString((call.stop as Record<string, unknown> | undefined)?.name)
    }));
  }

  private parseArrival(raw: Record<string, unknown>): Arrival | null {
    const realtime = parseDate(raw.realtime);
    if (!realtime) return null;

    const scheduled = parseDate(raw.scheduled) ?? realtime;
    const routeRaw = (raw.route ?? {}) as Record<string, unknown>;
    const tripRaw = (raw.trip ?? {}) as Record<string, unknown>;
    const stopRaw = (raw.stop ?? {}) as Record<string, unknown>;
    const originRaw = (routeRaw.origin ?? {}) as Record<string, unknown>;
    const destinationRaw = (routeRaw.destination ?? {}) as Record<string, unknown>;

    return {
      realtime,
      scheduled,
      route: {
        designation: asString(routeRaw.designation),
        transportMode: asString(routeRaw.transport_mode),
        direction: asString(routeRaw.direction),
        originName: asString(originRaw.name),
        destinationName: asString(destinationRaw.name)
      },
      trip: {
        tripId: asString(tripRaw.trip_id),
        startDate: asString(tripRaw.start_date)
      },
      stop: {
        id: asString(stopRaw.id),
        name: asString(stopRaw.name)
      }
    };
  }

  private async fetchJson(pathAndQuery: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/${pathAndQuery}`);
    if (!response.ok) {
      throw new Error(`SL API request failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    if (isApiErrorPayload(json)) {
      throw new Error(`SL API error: ${json.errorCode}${json.errorDetail ? ` (${json.errorDetail})` : ""}`);
    }

    return json;
  }

  private async tryFetchAllStationsDirect(): Promise<string[]> {
    try {
      const json = await this.fetchJson(`stops?key=${encodeURIComponent(this.apiKey)}`) as {
        stop_groups?: Array<{ name?: string }>;
        stops?: Array<{ name?: string }>;
      };

      return uniqueNonEmpty([
        ...(json.stop_groups ?? []).map((x) => x.name ?? ""),
        ...(json.stops ?? []).map((x) => x.name ?? "")
      ]);
    } catch {
      return [];
    }
  }

  private async fetchAllStationsBySearchSweep(): Promise<string[]> {
    const buckets = [
      "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
      "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
      "å", "ä", "ö"
    ];

    const all: string[] = [];
    for (const query of buckets) {
      try {
        const part = await this.searchStations(query, 200);
        all.push(...part);
      } catch {
        // Ignore partial errors and continue.
      }
    }
    return uniqueNonEmpty(all);
  }

  private readStationsCache(): string[] {
    try {
      const raw = localStorage.getItem(STATIONS_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { savedAt?: number; stations?: string[] };
      if (!parsed?.savedAt || !Array.isArray(parsed.stations)) return [];
      if (Date.now() - parsed.savedAt > STATIONS_CACHE_TTL_MS) return [];
      return uniqueNonEmpty(parsed.stations);
    } catch {
      return [];
    }
  }

  private writeStationsCache(stations: string[]): void {
    try {
      localStorage.setItem(STATIONS_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        stations
      }));
    } catch {
      // Ignore storage failures.
    }
  }
}

function inferPosition(calls: TripCall[], now: Date, targetStopId: string): InferredBusPosition | undefined {
  const withTimes = calls
    .map((call, index) => ({ call, index, time: bestTime(call) }))
    .filter((item): item is { call: TripCall; index: number; time: Date } => item.time !== undefined);

  if (withTimes.length === 0) return undefined;

  const last = [...withTimes]
    .filter((item) => item.time.getTime() <= now.getTime())
    .sort((a, b) => a.time.getTime() - b.time.getTime())
    .at(-1);

  const next = [...withTimes]
    .filter((item) => item.time.getTime() > now.getTime())
    .sort((a, b) => a.time.getTime() - b.time.getTime())[0];

  let stopsRemainingToTarget: number | undefined;
  if (next) {
    const targetIndex = calls.findIndex((c) => equalIgnoreCase(c.stopId, targetStopId));
    if (targetIndex >= 0) {
      const currentIndex = last?.index ?? next.index;
      if (currentIndex <= targetIndex) {
        stopsRemainingToTarget = targetIndex - currentIndex;
      }
    }
  }

  return {
    lastStopName: last?.call.stopName ?? "(unknown)",
    nextStopName: next?.call.stopName ?? "(unknown)",
    stopsRemainingToTarget,
    targetStationNumber: targetStopId
  };
}

function bestTime(call: TripCall): Date | undefined {
  return parseDate(call.realtimeArrival)
    ?? parseDate(call.realtimeDeparture)
    ?? parseDate(call.scheduledArrival)
    ?? parseDate(call.scheduledDeparture);
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function equalIgnoreCase(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function containsIgnoreCase(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return foldText(a).includes(foldText(b));
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function uniqueNonEmpty(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (!result.some((item) => item.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0)) {
      result.push(trimmed);
    }
  }
  return result;
}

function isApiErrorPayload(value: unknown): value is { errorCode: string; errorDetail?: string } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.errorCode === "string";
}
