# SL Bus Tracker

A real-time bus arrival tracker for Stockholm's public transit (SL), built on the [Trafiklab](https://developer.trafiklab.se) API.

The solution contains a **TypeScript web app** (the primary interface), a **C# library** that wraps the same API, and a small **console app** and **test suite** built on top of that library.

---

## Repository structure

```
SL/              .NET console app — quick CLI check of upcoming buses
SL.Lib/          C# library — Trafiklab API client, shared models
SL.Tests/        xUnit tests for SL.Lib
SL.Web/          TypeScript + Vite single-page web app (main UI)
SL.slnx          .NET solution file
```

---

## SL.Web — the web app

A client-only single-page app. No server required — it calls the Trafiklab API directly from the browser and stores all settings in `localStorage`.

### Prerequisites

- [Node.js](https://nodejs.org) 18 or later

### Getting started

```bash
cd SL.Web
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

### First-time setup

On first launch you land on the **Settings** page:

1. **API key** — get a free key from [developer.trafiklab.se](https://developer.trafiklab.se). Register or log in, then subscribe to the **SL Real-Time Data** API.
2. **Time window** — how many minutes ahead to look for arrivals (default 60).
3. **Bus lines** — add one entry per direction you want to track:
   - *Station name* — the stop name as it appears in Trafiklab (e.g. `Brovaktarvägen`)
   - *Line number* — e.g. `704`
   - *Origin → Destination* — choose from the dropdown that auto-populates once the station and line number are filled in

Click **Save Changes** to persist and load live data.

### Views

| View | Description |
|------|-------------|
| **Mobile** | One station at a time, swipeable with ◀ ▶ arrows. Each configured line shows its next arrival time. Click a card to open the filtered Classic view for that route. |
| **Classic** | Full detail view — all arrivals within the time window, inferred bus position (stops remaining), trip ID. |
| **Settings** | Edit API key, time window, and line configurations. |

Data auto-refreshes every **5 minutes**. Use **Refresh now** to force an immediate update.

---

## SL.Lib — C# library

A .NET library that wraps the Trafiklab real-time REST API.

**Key types**

| Type | Purpose |
|------|---------|
| `SLApiClient` | Main client. Inject via `IHttpClientFactory`. |
| `ISLApiClient` | Interface for DI / testing. |
| `UpcomingBusQueryResult` | Filtered arrivals + line summaries for a stop. |
| `InferredBusPosition` | Best-effort bus position derived from trip stop calls. |

**Main methods**

```csharp
// Find stop groups matching a name
Task<List<StopGroup>> FindStopGroupAsync(string search)

// Get raw arrivals for a stop area
Task<List<Arrival>> GetArrivalsAsync(string areaId)

// Get upcoming buses filtered by origin/destination and time window
Task<UpcomingBusQueryResult> GetUpcomingBusesAsync(
    string stopGroupSearchName,
    TimeSpan timeWindow,
    IReadOnlyCollection<string>? origins = null,
    IReadOnlyCollection<string>? destinations = null,
    DateTimeOffset? now = null)

// Get full stop sequence for a trip (used to infer bus position)
Task<TripDetailResponse?> GetTripDetailsAsync(string tripId, string startDate)
```

### Build

```bash
dotnet build SL.Lib
```

---

## SL.Tests — unit tests

xUnit tests for `SLApiClient` using a fake HTTP handler. Covers stop group lookup, arrival parsing, trip detail parsing, and the full `GetUpcomingBusesAsync` pipeline including position inference.

```bash
dotnet test SL.Tests
```

---

## SL — console app

A lightweight .NET console app that calls `SLApiClient` and prints upcoming buses to stdout. Useful for quick manual checks without opening a browser.

```bash
dotnet run --project SL
```

---

## Notes

- The web app calls the Trafiklab API directly from the browser. If the API provider restricts CORS, requests will fail — in that case a proxy or local backend would be needed.
- Your API key is stored only in your browser's `localStorage` and is never sent anywhere other than Trafiklab.
- Bus GPS positions are not exposed in the public Trafiklab feed; position is inferred from scheduled/realtime stop-call timestamps.
