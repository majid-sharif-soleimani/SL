using System;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using SL.Lib;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System.Net.Http;

static class Program
{
    private const string ApiKeyEnvVar = "TRAFIKLAB_KEY";
    private const string StopGroupSearchName = "Tranvägen";
    private static readonly string[] Origins = { "Skärholmen" };
    private static readonly string[] Destinations = { "Sörskogen" };
    private static readonly TimeSpan TimeWindow = TimeSpan.FromMinutes(60);

    public static async Task Main()
    {
        var key = Environment.GetEnvironmentVariable(ApiKeyEnvVar);
        if (string.IsNullOrWhiteSpace(key))
        {
            Console.WriteLine($"❌ Missing API key. Set env var {ApiKeyEnvVar} first.");
            return;
        }

        // 1) Configure Host-based DI and create SLApiClient
        var builder = Host.CreateApplicationBuilder(args: Array.Empty<string>());
        builder.Services.AddHttpClient("SLApi", c => c.BaseAddress = new Uri("https://realtime-api.trafiklab.se/v1/"));

        builder.Services.AddSingleton<ISLApiClient>(sp =>
        {
            var factory = sp.GetRequiredService<IHttpClientFactory>();
            var http = factory.CreateClient("SLApi");
            var cfgKey = builder.Configuration[ApiKeyEnvVar] ?? Environment.GetEnvironmentVariable(ApiKeyEnvVar);
            return new SLApiClient(http, cfgKey ?? key);
        });

        using var host = builder.Build();
        var client = host.Services.GetRequiredService<ISLApiClient>();

        var results = await client.GetUpcomingBusesAsync(
            stopGroupSearchName: StopGroupSearchName,
            timeWindow: TimeWindow,
            origins: Origins,
            destinations: Destinations);

        if (results.Count == 0)
        {
            Console.WriteLine($"❌ Could not find stop group for: {StopGroupSearchName}");
            return;
        }

        foreach(var result in results)
        {
            Console.WriteLine($"✅ Stop group: {result.StopGroup.Name} (areaId={result.StopGroup.Id})");

            Console.WriteLine();
            Console.WriteLine($"🧾 Matching upcoming ARRIVALS (next {(int)result.TimeWindow.TotalMinutes} minutes) per configured line:");

            foreach (var line in result.Arrivals.GroupBy(a => a.LineNumber).OrderBy(g => g.Key))
            {
                Console.WriteLine();
                Console.WriteLine($"- Line {line.Key} (origin contains: '{string.Join(" | ", Origins)}', dest contains: '{string.Join(" | ", Destinations)}'):");

                foreach (var a in line.Take(10))
                {
                    Console.WriteLine($"  {a.ArrivalTime:HH:mm:ss} (in ~{a.MinutesUntilArrival} min)  Line {a.LineNumber} → {a.Direction}");
                    Console.WriteLine($"      Origin: {a.Origin} | Destination: {a.Destination} | Stop(Platform): {a.StationName} ({a.StationNumber})");
                    Console.WriteLine($"      Trip: {a.TripId}  StartDate: {a.TripStartDate}");
                }

                var summary = result.Lines.FirstOrDefault(l => string.Equals(l.LineNumber, line.Key, StringComparison.OrdinalIgnoreCase));
                if (summary is null) continue;

                Console.WriteLine();
                Console.WriteLine($"⭐ NEXT ARRIVAL for {summary.LineNumber}: {summary.NextArrivalTime:HH:mm:ss} at {summary.NextArrivalStationName}");

                Console.WriteLine();
                Console.WriteLine("📍 Bus position (best-effort, based on stop times):");
                if (summary.Position is null)
                {
                    Console.WriteLine("  Could not infer position from available realtime/scheduled timestamps.");
                }
                else
                {
                    Console.WriteLine($"  Last observed/passed stop: {summary.Position.LastStopName}");
                    Console.WriteLine($"  Next stop: {summary.Position.NextStopName}");
                    if (summary.Position.StopsRemainingToTarget is not null)
                        Console.WriteLine($"  Stops remaining until {summary.NextArrivalStationName} (platform {summary.Position.TargetStationNumber}): {summary.Position.StopsRemainingToTarget}");
                }
            }

            Console.WriteLine();
            Console.WriteLine($"ℹ️ Note: {result.Note}");
        }
    }
}
