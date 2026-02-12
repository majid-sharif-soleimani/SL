using System.Collections.Generic;
using System.Threading.Tasks;

namespace SL.Lib;

public interface ISLApiClient
{
    Task<List<StopGroup>> FindStopGroupsAsync(string search);
    Task<List<Arrival>> GetArrivalsAsync(string areaId);
    Task<TripDetailResponse?> GetTripDetailsAsync(string tripId, string startDate);
    Task<List<UpcomingBusQueryResult>> GetUpcomingBusesAsync(
        string stopGroupSearchName,
        TimeSpan timeWindow,
        IReadOnlyCollection<string>? origins = null,
        IReadOnlyCollection<string>? destinations = null,
        DateTimeOffset? now = null
    );
}
