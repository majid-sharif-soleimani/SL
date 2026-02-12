using System;
using System.Globalization;
using System.Net.Http;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace SL.Lib;

public class SLApiClient : ISLApiClient
{
    private readonly HttpClient Http;
    private readonly string ApiKey;
    public SLApiClient(HttpClient httpClient, string apiKey)
    {
        Http = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        ApiKey = apiKey ?? throw new ArgumentNullException(nameof(apiKey));
    }

    public async Task<List<StopGroup>> FindStopGroupsAsync(string search)
    {
        var url = $"stops/name/{Uri.EscapeDataString(search)}/?key={Uri.EscapeDataString(ApiKey)}";
        var json = await Http.GetStringAsync(url);

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("stop_groups", out var groupsEl) || groupsEl.ValueKind != JsonValueKind.Array)
            return new List<StopGroup>();

        List<StopGroup> result = new List<StopGroup>();

        foreach (var g in groupsEl.EnumerateArray())
        {
            var id = g.GetProperty("id").GetString();
            var name = g.GetProperty("name").GetString();
            result.Add(new StopGroup(id, name));
        }

        return result;
    }

    public async Task<List<Arrival>> GetArrivalsAsync(string areaId)
    {
        var url = $"arrivals/{Uri.EscapeDataString(areaId)}?key={Uri.EscapeDataString(ApiKey)}";
        var json = await Http.GetStringAsync(url);

        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("arrivals", out var arrEl) || arrEl.ValueKind != JsonValueKind.Array)
            return new List<Arrival>();

        var list = new List<Arrival>();
        foreach (var a in arrEl.EnumerateArray())
        {
            var realtimeStr = a.GetProperty("realtime").GetString();
            var scheduledStr = a.GetProperty("scheduled").GetString();
            if (!DateTimeOffset.TryParse(realtimeStr, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var realtime))
                continue;
            DateTimeOffset.TryParse(scheduledStr, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var scheduled);

            var route = ParseRoute(a.GetProperty("route"));
            var trip = ParseTrip(a.GetProperty("trip"));
            var stop = ParseStop(a.GetProperty("stop"));

            list.Add(new Arrival(realtime, scheduled, route, trip, stop));
        }
        return list;
    }

    public async Task<TripDetailResponse?> GetTripDetailsAsync(string tripId, string startDate)
    {
        var url = $"trips/{Uri.EscapeDataString(tripId)}/{Uri.EscapeDataString(startDate)}?key={Uri.EscapeDataString(ApiKey)}";
        var json = await Http.GetStringAsync(url);

        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object) return null;

        var resp = new TripDetailResponse();

        if (root.TryGetProperty("timestamp", out var ts) && ts.ValueKind == JsonValueKind.String)
            resp.Timestamp = ts.GetString();

        if (root.TryGetProperty("route", out var routeEl) && routeEl.ValueKind == JsonValueKind.Object)
        {
            resp.Route = new RouteInfo
            {
                Designation = routeEl.TryGetProperty("designation", out var rdes) && rdes.ValueKind == JsonValueKind.String ? rdes.GetString() : null,
                TransportMode = routeEl.TryGetProperty("transport_mode", out var rtm) && rtm.ValueKind == JsonValueKind.String ? rtm.GetString() : null,
                TransportModeCode = routeEl.TryGetProperty("transport_mode_code", out var rtmc) && rtmc.ValueKind == JsonValueKind.Number ? rtmc.GetInt32() : null,
                Direction = routeEl.TryGetProperty("direction", out var rdir) && rdir.ValueKind == JsonValueKind.String ? rdir.GetString() : null,
                Origin = routeEl.TryGetProperty("origin", out var rorig) && rorig.ValueKind == JsonValueKind.Object ? new NamedStop(rorig.GetProperty("id").GetString(), rorig.GetProperty("name").GetString()) : null,
                Destination = routeEl.TryGetProperty("destination", out var rdst) && rdst.ValueKind == JsonValueKind.Object ? new NamedStop(rdst.GetProperty("id").GetString(), rdst.GetProperty("name").GetString()) : null
            };
        }

        if (root.TryGetProperty("trip", out var tripEl) && tripEl.ValueKind == JsonValueKind.Object)
        {
            resp.Trip = new TripInfo
            {
                TripId = tripEl.TryGetProperty("trip_id", out var tid) && tid.ValueKind == JsonValueKind.String ? tid.GetString() : null,
                StartDate = tripEl.TryGetProperty("start_date", out var sd) && sd.ValueKind == JsonValueKind.String ? sd.GetString() : null,
                TechnicalNumber = tripEl.TryGetProperty("technical_number", out var tn) && tn.ValueKind == JsonValueKind.Number ? tn.GetInt32() : null
            };
        }

        if (root.TryGetProperty("calls", out var callsEl) && callsEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var ce in callsEl.EnumerateArray())
            {
                var call = new TripCall
                {
                    ScheduledDeparture = ce.TryGetProperty("scheduledDeparture", out var sd) && sd.ValueKind == JsonValueKind.String ? sd.GetString() : null,
                    RealtimeDeparture = ce.TryGetProperty("realtimeDeparture", out var rd) && rd.ValueKind == JsonValueKind.String ? rd.GetString() : null,
                    ScheduledArrival = ce.TryGetProperty("scheduledArrival", out var sa) && sa.ValueKind == JsonValueKind.String ? sa.GetString() : null,
                    RealtimeArrival = ce.TryGetProperty("realtimeArrival", out var ra) && ra.ValueKind == JsonValueKind.String ? ra.GetString() : null,
                };

                if (ce.TryGetProperty("stop", out var stopEl) && stopEl.ValueKind == JsonValueKind.Object)
                {
                    call.Stop = new TripStop
                    {
                        Id = stopEl.TryGetProperty("id", out var sid) && sid.ValueKind == JsonValueKind.String ? sid.GetString() : null,
                        AreaId = stopEl.TryGetProperty("area_id", out var aid) && aid.ValueKind == JsonValueKind.String ? aid.GetString() : null,
                        Name = stopEl.TryGetProperty("name", out var sname) && sname.ValueKind == JsonValueKind.String ? sname.GetString() : null,
                        Lat = stopEl.TryGetProperty("lat", out var slat) && slat.ValueKind == JsonValueKind.Number ? slat.GetDouble() : null,
                        Lon = stopEl.TryGetProperty("lon", out var slon) && slon.ValueKind == JsonValueKind.Number ? slon.GetDouble() : null
                    };
                }

                resp.Calls.Add(call);
            }
        }

        return resp;
    }

    public async Task<List<UpcomingBusQueryResult>> GetUpcomingBusesAsync(
        string stopGroupSearchName,
        TimeSpan timeWindow,
        IReadOnlyCollection<string>? origins = null,
        IReadOnlyCollection<string>? destinations = null,
        DateTimeOffset? now = null)
    {
        List<UpcomingBusQueryResult> result = new List<UpcomingBusQueryResult>();

        if (string.IsNullOrWhiteSpace(stopGroupSearchName))
            throw new ArgumentException("Stop group search name is required.", nameof(stopGroupSearchName));
        if (timeWindow <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(timeWindow), "Time window must be greater than zero.");

        var current = now ?? DateTimeOffset.Now;
        var stopGroups = await FindStopGroupsAsync(stopGroupSearchName);
        if (stopGroups is null || stopGroups.Count == 0) return result;

        foreach(var stopGroup in stopGroups)        
        {
            var arrivals = await GetArrivalsAsync(stopGroup.Id);

            var filtered = arrivals
                .Where(a => string.Equals(a.Route.TransportMode, "BUS", StringComparison.OrdinalIgnoreCase))
                .Where(a => a.Realtime >= current.AddMinutes(-1))
                .Where(a => a.Realtime <= current.Add(timeWindow))
                .Where(a => origins is null || origins.Count == 0 || MatchAny(a.Route.Origin?.Name, origins))
                .Where(a => destinations is null || destinations.Count == 0 || MatchAny(a.Route.Destination?.Name, destinations))
                .OrderBy(a => a.Realtime)
                .ToList();

            var arrivalsResult = filtered.Select(a => new UpcomingBusArrival(
                LineNumber: a.Route.Designation ?? string.Empty,
                Origin: a.Route.Origin?.Name ?? string.Empty,
                Destination: a.Route.Destination?.Name ?? string.Empty,
                Direction: a.Route.Direction,
                ArrivalTime: a.Realtime,
                MinutesUntilArrival: (int)Math.Round((a.Realtime - current).TotalMinutes),
                TripId: a.Trip.TripId,
                TripStartDate: a.Trip.StartDate,
                StationName: a.Stop.Name,
                StationNumber: a.Stop.Id
            )).ToList();

            var lines = new List<UpcomingBusLineSummary>();
            foreach (var lineGroup in filtered.GroupBy(a => a.Route.Designation ?? string.Empty).OrderBy(g => g.Key))
            {
                var next = lineGroup.OrderBy(a => a.Realtime).First();
                InferredBusPosition? position = null;
                var tripDetails = await GetTripDetailsAsync(next.Trip.TripId, next.Trip.StartDate);
                if (tripDetails?.Calls is not null && tripDetails.Calls.Count > 0)
                {
                    var inferred = InferPosition(tripDetails.Calls, current, next.Stop.Id);
                    if (inferred is not null)
                    {
                        position = new InferredBusPosition(
                            LastStopName: inferred.LastStopName,
                            NextStopName: inferred.NextStopName,
                            StopsRemainingToTarget: inferred.StopsRemainingToTarget,
                            TargetStationNumber: next.Stop.Id
                        );
                    }
                }

                lines.Add(new UpcomingBusLineSummary(
                    LineNumber: lineGroup.Key,
                    NextArrivalTime: next.Realtime,
                    NextArrivalStationName: stopGroup.Name,
                    NextTripId: next.Trip.TripId,
                    NextTripStartDate: next.Trip.StartDate,
                    Position: position
                ));
            }

            result.Add(new UpcomingBusQueryResult(
                StopGroup: stopGroup,
                RequestedAt: current,
                TimeWindow: timeWindow,
                Arrivals: arrivalsResult,
                Lines: lines,
                Note: "SL bus GPS is not generally exposed via the public GTFS-RT VehiclePositions feed, so location is inferred from trip stop calls."
            ));
        }

        return result;
        
        static bool MatchAny(string? value, IReadOnlyCollection<string> patterns)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            foreach (var pattern in patterns)
            {
                if (!string.IsNullOrWhiteSpace(pattern) &&
                    value.Contains(pattern, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }
    }

    // -------------------- Parsing helpers & models --------------------

    private Route ParseRoute(JsonElement r)
    {
        return new Route(
            Name: r.TryGetProperty("name", out var n) ? n.GetString() : null,
            Designation: r.TryGetProperty("designation", out var d) ? d.GetString() : null,
            TransportMode: r.TryGetProperty("transport_mode", out var tm) ? tm.GetString() : null,
            Direction: r.TryGetProperty("direction", out var dir) ? dir.GetString() : null,
            Origin: r.TryGetProperty("origin", out var o) ? new NamedStop(o.GetProperty("id").GetString(), o.GetProperty("name").GetString()) : null,
            Destination: r.TryGetProperty("destination", out var dst) ? new NamedStop(dst.GetProperty("id").GetString(), dst.GetProperty("name").GetString()) : null
        );
    }

    private Trip ParseTrip(JsonElement t)
    {
        return new Trip(
            TripId: t.GetProperty("trip_id").GetString() ?? "",
            StartDate: t.GetProperty("start_date").GetString() ?? ""
        );
    }

    private Stop ParseStop(JsonElement s)
    {
        return new Stop(
            Id: s.GetProperty("id").GetString() ?? "",
            Name: s.GetProperty("name").GetString() ?? ""
        );
    }

    private static InferredPosition? InferPosition(List<TripCall> calls, DateTimeOffset now, string targetStopId)
    {
        DateTimeOffset? BestTime(TripCall c)
        {
            if (TryParse(c.RealtimeArrival, out var ra)) return ra;
            if (TryParse(c.RealtimeDeparture, out var rd)) return rd;
            if (TryParse(c.ScheduledArrival, out var sa)) return sa;
            if (TryParse(c.ScheduledDeparture, out var sd)) return sd;
            return null;
        }

        var withTimes = calls
            .Select((c, idx) => new { Call = c, Index = idx, Time = BestTime(c) })
            .Where(x => x.Time is not null)
            .ToList();

        if (withTimes.Count == 0) return null;

        var last = withTimes.Where(x => x.Time!.Value <= now).OrderBy(x => x.Time).LastOrDefault();
        var next = withTimes.Where(x => x.Time!.Value > now).OrderBy(x => x.Time).FirstOrDefault();

        int? remaining = null;
        if (next is not null)
        {
            var targetIdx = calls.FindIndex(c => string.Equals(c.Stop?.Id, targetStopId, StringComparison.OrdinalIgnoreCase));
            if (targetIdx >= 0)
            {
                var currentIdx = last?.Index ?? next.Index;
                if (currentIdx <= targetIdx)
                    remaining = targetIdx - currentIdx;
            }
        }

        return new InferredPosition(
            LastStopName: last?.Call.Stop?.Name ?? "(unknown)",
            NextStopName: next?.Call.Stop?.Name ?? "(unknown)",
            StopsRemainingToTarget: remaining
        );

        static bool TryParse(string? s, out DateTimeOffset dto)
        {
            dto = default;
            return !string.IsNullOrWhiteSpace(s) &&
                   DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out dto);
        }
    }

    private record InferredPosition(string LastStopName, string NextStopName, int? StopsRemainingToTarget);

}

// Public model types exported by the library
public record StopGroup(string Id, string Name);

public record Arrival(
    DateTimeOffset Realtime,
    DateTimeOffset Scheduled,
    Route Route,
    Trip Trip,
    Stop Stop
);

public record Route(
    string? Name,
    string? Designation,
    string? TransportMode,
    string? Direction,
    NamedStop? Origin,
    NamedStop? Destination
);

public record Trip(string TripId, string StartDate);

public record Stop(string Id, string Name);

public record TripDetailResponse
{
    [JsonPropertyName("timestamp")]
    public string? Timestamp { get; set; }

    [JsonPropertyName("route")]
    public RouteInfo? Route { get; set; }

    [JsonPropertyName("trip")]
    public TripInfo? Trip { get; set; }

    [JsonPropertyName("calls")]
    public List<TripCall> Calls { get; set; } = new();
}

public record RouteInfo
{
    [JsonPropertyName("designation")]
    public string? Designation { get; set; }

    [JsonPropertyName("transport_mode")]
    public string? TransportMode { get; set; }

    [JsonPropertyName("transport_mode_code")]
    public int? TransportModeCode { get; set; }

    [JsonPropertyName("direction")]
    public string? Direction { get; set; }

    [JsonPropertyName("origin")]
    public NamedStop? Origin { get; set; }

    [JsonPropertyName("destination")]
    public NamedStop? Destination { get; set; }
}

public record TripInfo
{
    [JsonPropertyName("trip_id")]
    public string? TripId { get; set; }

    [JsonPropertyName("start_date")]
    public string? StartDate { get; set; }

    [JsonPropertyName("technical_number")]
    public int? TechnicalNumber { get; set; }
}

public record NamedStop(
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("name")] string? Name
);

public record TripCall
{
    [JsonPropertyName("scheduledDeparture")]
    public string? ScheduledDeparture { get; set; }

    [JsonPropertyName("realtimeDeparture")]
    public string? RealtimeDeparture { get; set; }

    [JsonPropertyName("scheduledArrival")]
    public string? ScheduledArrival { get; set; }

    [JsonPropertyName("realtimeArrival")]
    public string? RealtimeArrival { get; set; }

    [JsonPropertyName("stop")]
    public TripStop? Stop { get; set; }
}

public record TripStop
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("area_id")]
    public string? AreaId { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("lat")]
    public double? Lat { get; set; }

    [JsonPropertyName("lon")]
    public double? Lon { get; set; }
}

public record UpcomingBusQueryResult(
    StopGroup StopGroup,
    DateTimeOffset RequestedAt,
    TimeSpan TimeWindow,
    List<UpcomingBusArrival> Arrivals,
    List<UpcomingBusLineSummary> Lines,
    string Note
);

public record UpcomingBusArrival(
    string LineNumber,
    string Origin,
    string Destination,
    string? Direction,
    DateTimeOffset ArrivalTime,
    int MinutesUntilArrival,
    string TripId,
    string TripStartDate,
    string StationName,
    string StationNumber
);

public record UpcomingBusLineSummary(
    string LineNumber,
    DateTimeOffset NextArrivalTime,
    string NextArrivalStationName,
    string NextTripId,
    string NextTripStartDate,
    InferredBusPosition? Position
);

public record InferredBusPosition(
    string LastStopName,
    string NextStopName,
    int? StopsRemainingToTarget,
    string TargetStationNumber
);
