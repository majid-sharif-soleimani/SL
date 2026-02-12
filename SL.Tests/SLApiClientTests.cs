using System;
using System.Net.Http;
using System.Net;
using System.Threading.Tasks;
using Xunit;
using System.Collections.Generic;
using SL.Lib;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;

public class SLApiClientTests
{
    [Fact]
    public async Task FindStopGroupAsync_ReturnsExpectedStop()
    {
        var json = "{ \"stop_groups\": [ { \"id\": \"area-1\", \"name\": \"Brovaktarvägen\" } ] }";
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json)
        };

        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddHttpClient("SLApi").ConfigureHttpClient(c => c.BaseAddress = new System.Uri("http://test/"))
            .ConfigurePrimaryHttpMessageHandler(() => new FakeHttpMessageHandler(response));
        builder.Services.AddSingleton<ISLApiClient>(sp =>
        {
            var http = sp.GetRequiredService<IHttpClientFactory>().CreateClient("SLApi");
            return new SLApiClient(http, "key");
        });

        using var host = builder.Build();
        var client = host.Services.GetRequiredService<ISLApiClient>();

        var sg = await client.FindStopGroupAsync("Brovaktarvägen");
        Assert.NotNull(sg);
        Assert.Equal("area-1", sg!.Id);
        Assert.Equal("Brovaktarvägen", sg.Name);
    }

    [Fact]
    public async Task GetArrivalsAsync_ParsesArrival()
    {
        var json = "{ \"arrivals\": [ { \"realtime\": \"2026-02-12T12:00:00\", \"scheduled\": \"2026-02-12T12:05:00\", \"route\": { \"designation\": \"704\", \"transport_mode\": \"BUS\", \"origin\": { \"id\": \"orig1\", \"name\": \"Fruängen\" }, \"destination\": { \"id\": \"dst1\", \"name\": \"Huddinge\" } }, \"trip\": { \"trip_id\": \"trip-1\", \"start_date\": \"20260212\" }, \"stop\": { \"id\": \"stop-1\", \"name\": \"Brovaktarvägen\" } } ] }";
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json)
        };

        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddHttpClient("SLApi").ConfigureHttpClient(c => c.BaseAddress = new System.Uri("http://test/"))
            .ConfigurePrimaryHttpMessageHandler(() => new FakeHttpMessageHandler(response));
        builder.Services.AddSingleton<ISLApiClient>(sp =>
        {
            var http = sp.GetRequiredService<IHttpClientFactory>().CreateClient("SLApi");
            return new SLApiClient(http, "key");
        });

        using var host = builder.Build();
        var client = host.Services.GetRequiredService<ISLApiClient>();

        var arrivals = await client.GetArrivalsAsync("area-1");
        Assert.Single(arrivals);
        var a = arrivals[0];
        Assert.Equal("704", a.Route.Designation);
        Assert.Equal("BUS", a.Route.TransportMode);
        Assert.Equal("stop-1", a.Stop.Id);
        Assert.Equal("trip-1", a.Trip.TripId);
    }

    [Fact]
    public async Task GetTripDetailsAsync_ParsesCalls()
    {
        var json = "{ \"timestamp\": \"2026-02-12T11:50:00\", \"route\": { \"designation\": \"704\" }, \"trip\": { \"trip_id\": \"trip-1\", \"start_date\": \"20260212\" }, \"calls\": [ { \"scheduledDeparture\": \"2026-02-12T11:55:00\", \"realtimeDeparture\": \"2026-02-12T11:56:00\", \"scheduledArrival\": \"2026-02-12T12:00:00\", \"realtimeArrival\": \"2026-02-12T11:59:00\", \"stop\": { \"id\": \"stop-1\", \"name\": \"Brovaktarvägen\" } } ] }";
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json)
        };

        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddHttpClient("SLApi").ConfigureHttpClient(c => c.BaseAddress = new System.Uri("http://test/"))
            .ConfigurePrimaryHttpMessageHandler(() => new FakeHttpMessageHandler(response));
        builder.Services.AddSingleton<ISLApiClient>(sp =>
        {
            var http = sp.GetRequiredService<IHttpClientFactory>().CreateClient("SLApi");
            return new SLApiClient(http, "key");
        });

        using var host = builder.Build();
        var client = host.Services.GetRequiredService<ISLApiClient>();

        var details = await client.GetTripDetailsAsync("trip-1", "20260212");
        Assert.NotNull(details);
        Assert.NotNull(details!.Calls);
        Assert.Single(details.Calls);
        var call = details.Calls[0];
        Assert.Equal("stop-1", call.Stop?.Id);
        Assert.Equal("2026-02-12T11:59:00", call.RealtimeArrival);
    }

    [Fact]
    public async Task GetUpcomingBusesAsync_ReturnsFilteredBusesAndLineSummary()
    {
        var now = new DateTimeOffset(2026, 2, 12, 10, 20, 0, TimeSpan.Zero);
        var stopGroupsJson = "{ \"stop_groups\": [ { \"id\": \"740069165\", \"name\": \"Brovaktarvagen\" } ] }";
        var arrivalsJson = "{" +
            "\"arrivals\": [" +
            "{ \"realtime\": \"2026-02-12T10:25:00+00:00\", \"scheduled\": \"2026-02-12T10:25:00+00:00\", \"route\": { \"designation\": \"704\", \"transport_mode\": \"BUS\", \"direction\": \"Huddinge station\", \"origin\": { \"id\": \"orig1\", \"name\": \"Fruangen\" }, \"destination\": { \"id\": \"dst1\", \"name\": \"Huddinge station\" } }, \"trip\": { \"trip_id\": \"trip-704-1\", \"start_date\": \"2026-02-12\" }, \"stop\": { \"id\": \"9326\", \"name\": \"Brovaktarvagen\" } }," +
            "{ \"realtime\": \"2026-02-12T10:55:00+00:00\", \"scheduled\": \"2026-02-12T10:55:00+00:00\", \"route\": { \"designation\": \"704\", \"transport_mode\": \"BUS\", \"direction\": \"Huddinge station\", \"origin\": { \"id\": \"orig1\", \"name\": \"Fruangen\" }, \"destination\": { \"id\": \"dst1\", \"name\": \"Huddinge station\" } }, \"trip\": { \"trip_id\": \"trip-704-2\", \"start_date\": \"2026-02-12\" }, \"stop\": { \"id\": \"9326\", \"name\": \"Brovaktarvagen\" } }," +
            "{ \"realtime\": \"2026-02-12T10:20:00+00:00\", \"scheduled\": \"2026-02-12T10:20:00+00:00\", \"route\": { \"designation\": \"173\", \"transport_mode\": \"BUS\", \"direction\": \"Skarpnack\", \"origin\": { \"id\": \"orig2\", \"name\": \"Skondal\" }, \"destination\": { \"id\": \"dst2\", \"name\": \"Skarpnack\" } }, \"trip\": { \"trip_id\": \"trip-173-1\", \"start_date\": \"2026-02-12\" }, \"stop\": { \"id\": \"9326\", \"name\": \"Brovaktarvagen\" } }," +
            "{ \"realtime\": \"2026-02-12T11:30:00+00:00\", \"scheduled\": \"2026-02-12T11:30:00+00:00\", \"route\": { \"designation\": \"704\", \"transport_mode\": \"BUS\", \"direction\": \"Huddinge station\", \"origin\": { \"id\": \"orig1\", \"name\": \"Fruangen\" }, \"destination\": { \"id\": \"dst1\", \"name\": \"Huddinge station\" } }, \"trip\": { \"trip_id\": \"trip-704-3\", \"start_date\": \"2026-02-12\" }, \"stop\": { \"id\": \"9326\", \"name\": \"Brovaktarvagen\" } }" +
            "]" +
            "}";
        var tripJson = "{" +
            "\"calls\": [" +
            "{ \"scheduledArrival\": \"2026-02-12T09:55:00+00:00\", \"realtimeArrival\": \"2026-02-12T09:56:00+00:00\", \"stop\": { \"id\": \"100\", \"name\": \"Fruangen\" } }," +
            "{ \"scheduledArrival\": \"2026-02-12T10:15:00+00:00\", \"realtimeArrival\": \"2026-02-12T10:16:00+00:00\", \"stop\": { \"id\": \"200\", \"name\": \"Vantor\" } }," +
            "{ \"scheduledArrival\": \"2026-02-12T10:35:00+00:00\", \"realtimeArrival\": \"2026-02-12T10:36:00+00:00\", \"stop\": { \"id\": \"9326\", \"name\": \"Brovaktarvagen\" } }" +
            "]" +
            "}";

        var builder = Host.CreateApplicationBuilder();
        builder.Services.AddHttpClient("SLApi")
            .ConfigureHttpClient(c => c.BaseAddress = new System.Uri("http://test/"))
            .ConfigurePrimaryHttpMessageHandler(() => new FakeHttpMessageHandler(req =>
            {
                var uri = req.RequestUri!.ToString();
                if (uri.Contains("stops/name/", System.StringComparison.OrdinalIgnoreCase))
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(stopGroupsJson) };
                if (uri.Contains("arrivals/740069165", System.StringComparison.OrdinalIgnoreCase))
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(arrivalsJson) };
                if (uri.Contains("trips/trip-704-1/2026-02-12", System.StringComparison.OrdinalIgnoreCase))
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(tripJson) };

                return new HttpResponseMessage(HttpStatusCode.NotFound);
            }));

        builder.Services.AddSingleton<ISLApiClient>(sp =>
        {
            var http = sp.GetRequiredService<IHttpClientFactory>().CreateClient("SLApi");
            return new SLApiClient(http, "key");
        });

        using var host = builder.Build();
        var client = host.Services.GetRequiredService<ISLApiClient>();

        var result = await client.GetUpcomingBusesAsync(
            stopGroupSearchName: "Brovaktarvagen",
            timeWindow: System.TimeSpan.FromMinutes(60),
            origins: new[] { "Fruangen" },
            destinations: new[] { "Huddinge" },
            now: now);

        Assert.NotNull(result);
        Assert.Equal("740069165", result!.StopGroup.Id);
        Assert.Equal("Brovaktarvagen", result.StopGroup.Name);
        Assert.Equal(2, result.Arrivals.Count);
        Assert.All(result.Arrivals, a => Assert.Equal("704", a.LineNumber));

        var first = result.Arrivals[0];
        Assert.Equal("Fruangen", first.Origin);
        Assert.Equal("Huddinge station", first.Destination);
        Assert.Equal("trip-704-1", first.TripId);
        Assert.Equal("Brovaktarvagen", first.StationName);
        Assert.Equal("9326", first.StationNumber);

        Assert.Single(result.Lines);
        var line = result.Lines[0];
        Assert.Equal("704", line.LineNumber);
        Assert.Equal("trip-704-1", line.NextTripId);
        Assert.NotNull(line.Position);
        Assert.Equal("Vantor", line.Position!.LastStopName);
        Assert.Equal("Brovaktarvagen", line.Position.NextStopName);
        Assert.Equal(1, line.Position.StopsRemainingToTarget);
        Assert.Equal("9326", line.Position.TargetStationNumber);
    }
}
