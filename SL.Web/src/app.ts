import { SLApiClient } from "./slApiClient";
import { AppSettings, LineConfig, StationRouteSuggestions, UpcomingBusArrival, UpcomingBusQueryResult } from "./types";
import { loadSettings, saveSettings } from "./storage";

type ViewMode = "settings" | "mobile" | "classic";

export class App {
  private readonly root: HTMLElement;
  private settings: AppSettings | null = null;
  private viewMode: ViewMode = "settings";
  private menuOpen = false;
  private loading = false;
  private errorMessage = "";
  private result: UpcomingBusQueryResult | null = null;
  private refreshTimer: number | null = null;
  private refreshCountdownTimer: number | null = null;
  private nextRefreshAt: Date | null = null;
  private readonly refreshIntervalMs = 5 * 60 * 1000;
  private currentStationIndex = 0;
  private routeSuggestionsByStation: Record<string, StationRouteSuggestions> = {};
  private routeLookupDebounceTimers = new Map<number, number>();
  private routeLookupForceRefreshByRow = new Map<number, boolean>();

  constructor(root: HTMLElement) {
    this.root = root;
  }

  mount(): void {
    this.settings = loadSettings();
    this.viewMode = this.settings ? "mobile" : "settings";
    this.render();

    if (this.settings) {
      void this.loadResults();
      this.startAutoRefresh();
    }
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="page-shell">
        ${this.renderTopBar()}
        <main class="page-main">
          ${this.viewMode === "settings"
            ? this.renderSettingsView()
            : this.viewMode === "mobile"
              ? this.renderMobileDashboardView()
              : this.renderClassicDashboardView()}
        </main>
      </div>
    `;

    this.bindBaseEvents();
    if (this.viewMode === "settings") {
      this.bindSettingsEvents();
    } else {
      this.bindDashboardEvents();
    }
  }

  private renderTopBar(): string {
    return `
      <header class="topbar">
        <button id="menu-toggle" class="menu-button" aria-label="Open menu">☰</button>
        <h1 class="brand">SL Bus Tracker</h1>
      </header>
      <nav class="menu ${this.menuOpen ? "menu-open" : ""}" id="menu-panel">
        <button id="go-mobile" class="menu-item">Mobile View</button>
        <button id="go-classic" class="menu-item">Classic View</button>
        <button id="go-settings" class="menu-item">Settings</button>
      </nav>
    `;
  }

  private renderSettingsView(): string {
    const settings = this.settings ?? {
      apiKey: "",
      timeWindowMinutes: 60,
      lines: [{ stopGroupSearchName: "Brovaktarvagen", lineNumber: "704", origin: "Fruangen", destination: "Huddinge" }]
    } satisfies AppSettings;

    return `
      <section class="hero">
        <div class="icon-box">🚌</div>
        <h2>Welcome</h2>
        <p>Enter your bus route information</p>
      </section>

      ${this.errorMessage ? `<div class="error-banner">${escapeHtml(this.errorMessage)}</div>` : ""}

      <section class="card">
        <h3>Connection Settings</h3>
        <label>Trafiklab API Key</label>
        <input id="api-key" type="password" value="${escapeAttr(settings.apiKey)}" placeholder="Enter your API key" />

        <div class="two-columns">
          <div>
            <label>Time Window (minutes)</label>
            <input id="window-minutes" type="number" min="1" value="${settings.timeWindowMinutes}" />
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-row">
          <h3>Bus Lines</h3>
          <button id="add-line" class="ghost-button" type="button">+ Add Line</button>
        </div>

        <div id="lines-container" class="lines-list">
          ${settings.lines.map((line, index) => this.renderLineEditor(line, index)).join("")}
        </div>
      </section>

      <button id="save-settings" class="primary-button" type="button">Save Changes</button>
    `;
  }

  private renderLineEditor(line: LineConfig, index: number): string {
    const stationKey = normalizeKey(line.stopGroupSearchName);
    const stationRoutes = this.routeSuggestionsByStation[stationKey];
    const selectedLineRoutes = this.getRoutesForSelectedLine(stationRoutes, line.lineNumber);
    const routePairs = this.getRoutePairs(selectedLineRoutes, line.origin, line.destination);
    const selectedPairValue = encodePair(line.origin, line.destination);
    const routeDisabled = !line.stopGroupSearchName.trim() || normalizeLineToken(line.lineNumber).length === 0;

    return `
      <article class="line-item" data-line-index="${index}">
        <div class="line-header">
          <span>Line ${index + 1}</span>
          <button class="remove-line" data-remove-index="${index}" type="button">Remove</button>
        </div>
        <div class="line-grid">
          <div>
            <label>Station Name</label>
            <input data-field="stopGroupSearchName" type="text" value="${escapeAttr(line.stopGroupSearchName)}" placeholder="Type station name" />
          </div>
          <div>
            <label>Line Number</label>
            <input data-field="lineNumber" type="text" value="${escapeAttr(line.lineNumber)}" placeholder="Type line number" />
          </div>
          <div>
            <label>Origin-Destination</label>
            <select data-field="originDestinationPair" ${routeDisabled ? "disabled" : ""}>
              ${renderRoutePairOptions(routePairs, selectedPairValue, "Select route")}
            </select>
          </div>
        </div>
      </article>
    `;
  }

  private renderMobileDashboardView(): string {
    const loadingBlock = this.loading ? `<div class="loading-box">Loading bus data...</div>` : "";
    const errorBlock = this.errorMessage ? `<div class="error-banner">${escapeHtml(this.errorMessage)}</div>` : "";

    if (!this.settings) {
      return `
        <section class="card">
          <p>No settings found. Please configure the app first.</p>
          <button id="go-settings-inline" class="primary-button">Open Settings</button>
        </section>
      `;
    }

    const stations = this.getConfiguredStations();
    if (stations.length === 0) {
      return `
        <section class="card">
          <p>No station records found. Please add at least one line in settings.</p>
        </section>
      `;
    }

    if (this.currentStationIndex >= stations.length) {
      this.currentStationIndex = stations.length - 1;
    }

    const stationName = stations[this.currentStationIndex];
    const stationLines = this.settings.lines.filter((line) => equalsIgnoreCase(line.stopGroupSearchName, stationName));
    const stationPanel = this.renderStationPanel(stationName, stationLines, this.result);
    const navDisabled = stations.length <= 1;

    return `
      <div class="mobile-dashboard-frame">
        <section class="card station-nav-shell">
          <div class="card-row">
            <h3>Bus Arrival Times</h3>
            <div class="refresh-actions">
              <span class="refresh-timer">${this.getRefreshTimerLabel()}</span>
              <button id="refresh-now" class="ghost-button">Refresh now</button>
            </div>
          </div>
          <p class="muted">Stations: ${stations.length} | Window: ${this.settings.timeWindowMinutes} minutes</p>
        </section>

        ${loadingBlock}
        ${errorBlock}

        <section class="station-mobile-shell">
          ${stationPanel}
          <button id="prev-station" class="station-nav-button station-nav-left" ${navDisabled ? "disabled" : ""} aria-label="Previous station">◀</button>
          <button id="next-station" class="station-nav-button station-nav-right" ${navDisabled ? "disabled" : ""} aria-label="Next station">▶</button>
        </section>
      </div>
    `;
  }

  private renderClassicDashboardView(): string {
    const loadingBlock = this.loading ? `<div class="loading-box">Loading bus data...</div>` : "";
    const errorBlock = this.errorMessage ? `<div class="error-banner">${escapeHtml(this.errorMessage)}</div>` : "";

    if (!this.settings) {
      return `
        <section class="card">
          <p>No settings found. Please configure the app first.</p>
          <button id="go-settings-inline" class="primary-button">Open Settings</button>
        </section>
      `;
    }

    const content = this.result ? this.renderClassicResult(this.result) : "";

    return `
      <section class="card">
        <div class="card-row">
          <h3>Classic Results</h3>
          <div class="refresh-actions">
            <span class="refresh-timer">${this.getRefreshTimerLabel()}</span>
            <button id="refresh-now" class="ghost-button">Refresh now</button>
          </div>
        </div>
        <p class="muted">Records: ${this.settings.lines.length} | Window: ${this.settings.timeWindowMinutes} minutes</p>
      </section>
      ${loadingBlock}
      ${errorBlock}
      ${content}
    `;
  }

  private renderClassicResult(result: UpcomingBusQueryResult): string {
    return result.lines
      .map((line) => {
        const arrivals = result.arrivals.filter(
          (a) => a.lineNumber === line.lineNumber && a.configuredStopGroupName === line.configuredStopGroupName
        );

        return `
          <section class="card result-card">
            <h3>✅ Station: ${escapeHtml(line.configuredStopGroupName)} (areaId=${escapeHtml(line.configuredStopGroupAreaId)})</h3>
            <p>🧾 Matching upcoming ARRIVALS (next ${result.timeWindowMinutes} minutes) per configured line:</p>
            <p>- Line ${escapeHtml(line.lineNumber)} (origin contains: '${escapeHtml(line.configuredOrigin)}', dest contains: '${escapeHtml(line.configuredDestination)}'):</p>

            <div class="arrival-list">
              ${arrivals.length === 0 ? `<p>(No matching arrivals found right now for this line.)</p>` : arrivals.map((a) => `
                <article class="arrival-item">
                  <p>${formatTime(a.arrivalTime)} (in ~${a.minutesUntilArrival} min) Line ${escapeHtml(a.lineNumber)} ␦ ${escapeHtml(a.destination)}</p>
                  <p>Origin: ${escapeHtml(a.origin)} | Destination: ${escapeHtml(a.destination)} | Stop(Platform): ${escapeHtml(a.stationName)} (${escapeHtml(a.stationNumber)})</p>
                  <p>Trip: ${escapeHtml(a.tripId)} StartDate: ${escapeHtml(a.tripStartDate)}</p>
                </article>
              `).join("")}
            </div>

            <p>⭐ NEXT ARRIVAL for ${escapeHtml(line.lineNumber)}: ${formatTime(line.nextArrivalTime)} at ${escapeHtml(line.nextArrivalStationName)}</p>
            <p>📍 Bus position (best-effort, based on stop times):</p>
            ${line.position ? `
              <p>Last observed/passed stop: ${escapeHtml(line.position.lastStopName)}</p>
              <p>Next stop: ${escapeHtml(line.position.nextStopName)}</p>
              <p>Stops remaining until ${escapeHtml(line.nextArrivalStationName)} (platform ${escapeHtml(line.position.targetStationNumber)}): ${line.position.stopsRemainingToTarget ?? "-"}</p>
            ` : `<p>Could not infer position from available realtime/scheduled timestamps.</p>`}
            <p>ℹ️ Note: ${escapeHtml(result.note)}</p>
          </section>
        `;
      })
      .join("");
  }

  private renderStationPanel(
    stationName: string,
    stationLines: LineConfig[],
    result: UpcomingBusQueryResult | null
  ): string {
    const rows = stationLines.map((line) => {
      const nextArrival = this.findNearestArrivalForLine(result, stationName, line.lineNumber);
      const displayTime = nextArrival ? formatTime(nextArrival.arrivalTime) : "--:--:--";
      const actualOrigin = nextArrival?.origin ?? line.origin;
      const actualDestination = nextArrival?.destination ?? line.destination;

      return `
        <article class="mobile-line-card">
          <p class="mobile-line-title">Line ${escapeHtml(line.lineNumber)}</p>
          <p>Origin: ${escapeHtml(actualOrigin)}</p>
          <p>Destination: ${escapeHtml(actualDestination)}</p>
          <p class="mobile-line-time">${displayTime}</p>
        </article>
      `;
    }).join("");

    return `
      <section class="station-mobile-panel card">
        <h3>✅ Station: ${escapeHtml(stationName)}</h3>
        <div class="mobile-lines-stack">
          ${rows || `<p>No lines configured for this station.</p>`}
        </div>
      </section>
    `;
  }

  private findNearestArrivalForLine(
    result: UpcomingBusQueryResult | null,
    stationName: string,
    lineNumber: string
  ): UpcomingBusArrival | null {
    if (!result) return null;

    const candidates = result.arrivals
      .filter((arrival) => equalsIgnoreCase(arrival.configuredStopGroupName, stationName))
      .filter((arrival) => equalsIgnoreCase(arrival.lineNumber, lineNumber))
      .sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());

    return candidates[0] ?? null;
  }

  private getConfiguredStations(): string[] {
    if (!this.settings) return [];

    const unique: string[] = [];
    for (const line of this.settings.lines) {
      const station = line.stopGroupSearchName.trim();
      if (!station) continue;
      if (!unique.some((name) => equalsIgnoreCase(name, station))) {
        unique.push(station);
      }
    }

    return unique;
  }

  private moveStation(step: number): void {
    const stations = this.getConfiguredStations();
    if (stations.length <= 1) return;

    this.currentStationIndex = (this.currentStationIndex + step + stations.length) % stations.length;
    this.render();
  }

  private bindBaseEvents(): void {
    this.byId<HTMLButtonElement>("menu-toggle")?.addEventListener("click", () => {
      this.menuOpen = !this.menuOpen;
      this.render();
    });

    this.byId<HTMLButtonElement>("go-settings")?.addEventListener("click", () => {
      this.menuOpen = false;
      this.viewMode = "settings";
      this.render();
    });

    this.byId<HTMLButtonElement>("go-mobile")?.addEventListener("click", () => {
      this.menuOpen = false;
      this.viewMode = "mobile";
      this.render();
      if (this.settings && !this.result) {
        void this.loadResults();
      }
    });

    this.byId<HTMLButtonElement>("go-classic")?.addEventListener("click", () => {
      this.menuOpen = false;
      this.viewMode = "classic";
      this.render();
      if (this.settings && !this.result) {
        void this.loadResults();
      }
    });

    this.byId<HTMLButtonElement>("go-settings-inline")?.addEventListener("click", () => {
      this.viewMode = "settings";
      this.render();
    });
  }

  private bindSettingsEvents(): void {
    this.byId<HTMLInputElement>("api-key")?.addEventListener("input", () => {
      this.routeSuggestionsByStation = {};
      this.settings = this.collectSettingsFromForm();
    });

    this.root.querySelectorAll<HTMLInputElement>('input[data-field="stopGroupSearchName"]').forEach((input) => {
      input.addEventListener("input", () => {
        const row = input.closest<HTMLElement>(".line-item");
        if (row) {
          this.setRowValue(row, "originDestinationPair", "");
          this.updateRowControlState(row);
          this.scheduleRouteLookupForRow(row, true);
        }
        this.settings = this.collectSettingsFromForm();
      });

      input.addEventListener("paste", () => {
        window.setTimeout(() => {
          const row = input.closest<HTMLElement>(".line-item");
          if (row) {
            this.setRowValue(row, "originDestinationPair", "");
            this.updateRowControlState(row);
            this.scheduleRouteLookupForRow(row, true);
          }
          this.settings = this.collectSettingsFromForm();
        }, 0);
      });

      input.addEventListener("change", () => {
        const row = input.closest<HTMLElement>(".line-item");
        if (row) {
          this.setRowValue(row, "originDestinationPair", "");
          this.updateRowControlState(row);
          this.scheduleRouteLookupForRow(row, true);
        }
        this.settings = this.collectSettingsFromForm();
      });
    });

    this.root.querySelectorAll<HTMLInputElement>('input[data-field="lineNumber"]').forEach((input) => {
      input.addEventListener("input", () => {
        const row = input.closest<HTMLElement>(".line-item");
        if (row) {
          this.setRowValue(row, "originDestinationPair", "");
          this.updateRowControlState(row);
          this.scheduleRouteLookupForRow(row, false);
        }
        this.settings = this.collectSettingsFromForm();
      });

      input.addEventListener("paste", () => {
        window.setTimeout(() => {
          const row = input.closest<HTMLElement>(".line-item");
          if (row) {
            this.setRowValue(row, "originDestinationPair", "");
            this.updateRowControlState(row);
            this.scheduleRouteLookupForRow(row, false);
          }
          this.settings = this.collectSettingsFromForm();
        }, 0);
      });

      input.addEventListener("change", () => {
        const row = input.closest<HTMLElement>(".line-item");
        if (row) {
          this.setRowValue(row, "originDestinationPair", "");
          this.updateRowControlState(row);
          this.scheduleRouteLookupForRow(row, false);
        }
        this.settings = this.collectSettingsFromForm();
      });
    });

    this.root.querySelectorAll<HTMLSelectElement>('select[data-field="originDestinationPair"]').forEach((select) => {
      select.addEventListener("change", () => {
        this.settings = this.collectSettingsFromForm();
      });
    });

    this.byId<HTMLButtonElement>("add-line")?.addEventListener("click", () => {
      const settings = this.collectSettingsFromForm();
      settings.lines.push({ stopGroupSearchName: "", lineNumber: "", origin: "", destination: "" });
      this.settings = settings;
      this.render();
    });

    this.root.querySelectorAll<HTMLButtonElement>(".remove-line").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.removeIndex);
        const settings = this.collectSettingsFromForm();
        settings.lines.splice(index, 1);
        this.settings = settings;
        this.render();
      });
    });

    this.byId<HTMLButtonElement>("save-settings")?.addEventListener("click", async () => {
      try {
        const settings = this.collectSettingsFromForm();
        validateSettings(settings);

        saveSettings(settings);
        this.settings = settings;
        this.currentStationIndex = 0;
        this.viewMode = "mobile";
        this.errorMessage = "";
        this.result = null;
        this.render();
        await this.loadResults();
        this.startAutoRefresh();
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : "Unknown error while saving settings.";
        this.render();
      }
    });

  }

  private bindDashboardEvents(): void {
    this.byId<HTMLButtonElement>("refresh-now")?.addEventListener("click", () => {
      void this.loadResults(true);
    });

    this.byId<HTMLButtonElement>("prev-station")?.addEventListener("click", () => {
      this.moveStation(-1);
    });

    this.byId<HTMLButtonElement>("next-station")?.addEventListener("click", () => {
      this.moveStation(1);
    });
  }

  private collectSettingsFromForm(): AppSettings {
    const fallback = this.settings ?? {
      apiKey: "",
      timeWindowMinutes: 60,
      lines: [{ stopGroupSearchName: "", lineNumber: "", origin: "", destination: "" }]
    };

    const apiKey = this.byId<HTMLInputElement>("api-key")?.value.trim() ?? fallback.apiKey;
    const timeWindowMinutes = Number(this.byId<HTMLInputElement>("window-minutes")?.value ?? String(fallback.timeWindowMinutes));

    const lines: LineConfig[] = [];
    this.root.querySelectorAll<HTMLElement>(".line-item").forEach((item) => {
      const stopGroupSearchName = item.querySelector<HTMLInputElement>('input[data-field="stopGroupSearchName"]')?.value.trim() ?? "";
      const lineNumber = item.querySelector<HTMLInputElement>('input[data-field="lineNumber"]')?.value.trim() ?? "";
      const pairValue = item.querySelector<HTMLSelectElement>('select[data-field="originDestinationPair"]')?.value.trim() ?? "";
      const pair = decodePair(pairValue);
      const origin = pair?.origin ?? "";
      const destination = pair?.destination ?? "";

      lines.push({ stopGroupSearchName, lineNumber, origin, destination });
    });

    return {
      apiKey,
      timeWindowMinutes,
      lines
    };
  }

  private async loadRoutesForRow(row: HTMLElement, forceRefreshStation: boolean): Promise<void> {
    const stationName = row.querySelector<HTMLInputElement>('input[data-field="stopGroupSearchName"]')?.value.trim() ?? "";
    const lineNumber = row.querySelector<HTMLInputElement>('input[data-field="lineNumber"]')?.value.trim() ?? "";

    if (!stationName || !lineNumber) {
      this.render();
      return;
    }

    this.settings = this.collectSettingsFromForm();
    await this.updateStationRoutes(stationName, forceRefreshStation);
  }

  private scheduleRouteLookupForRow(row: HTMLElement, forceRefreshStation: boolean): void {
    const rowIndex = Number(row.dataset.lineIndex ?? "-1");
    if (rowIndex < 0) return;

    const currentForce = this.routeLookupForceRefreshByRow.get(rowIndex) ?? false;
    this.routeLookupForceRefreshByRow.set(rowIndex, currentForce || forceRefreshStation);

    const existingTimer = this.routeLookupDebounceTimers.get(rowIndex);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.routeLookupDebounceTimers.delete(rowIndex);
      const shouldForce = this.routeLookupForceRefreshByRow.get(rowIndex) ?? false;
      this.routeLookupForceRefreshByRow.delete(rowIndex);

      const liveRow = this.root.querySelector<HTMLElement>(`.line-item[data-line-index="${rowIndex}"]`);
      if (!liveRow) return;
      if (!this.isRowReadyForRouteLookup(liveRow)) return;

      void this.loadRoutesForRow(liveRow, shouldForce);
    }, 1000);

    this.routeLookupDebounceTimers.set(rowIndex, timer);
  }

  private async loadResults(resetRefreshTimer: boolean = false): Promise<void> {
    if (!this.settings) return;

    this.loading = true;
    this.errorMessage = "";
    this.render();

    try {
      const client = new SLApiClient(this.settings.apiKey);
      const rawResult = await client.getUpcomingBuses(this.settings);
      const result = sanitizeUpcomingBusResult(rawResult);

      if (!result) {
        throw new Error("No records found. Please check station, line, origin, and destination.");
      }

      this.result = result;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : "Error while loading bus data.";
    } finally {
      this.loading = false;
      if (resetRefreshTimer) {
        this.setNextRefreshFromNow();
      }
      this.render();
    }
  }

  private startAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
    }

    if (this.refreshCountdownTimer !== null) {
      window.clearInterval(this.refreshCountdownTimer);
    }

    this.setNextRefreshFromNow();

    this.refreshTimer = window.setInterval(() => {
      if (this.viewMode === "mobile" || this.viewMode === "classic") {
        void this.loadResults();
        this.setNextRefreshFromNow();
      }
    }, this.refreshIntervalMs);

    this.refreshCountdownTimer = window.setInterval(() => {
      this.updateRefreshTimerLabels();
    }, 1000);
  }

  private byId<T extends HTMLElement>(id: string): T | null {
    return this.root.querySelector<T>(`#${id}`);
  }

  private setNextRefreshFromNow(): void {
    this.nextRefreshAt = new Date(Date.now() + this.refreshIntervalMs);
    this.updateRefreshTimerLabels();
  }

  private getRefreshTimerLabel(): string {
    if (!this.nextRefreshAt) return "Next refresh in --:--";

    const msRemaining = this.nextRefreshAt.getTime() - Date.now();
    const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `Next refresh in ${pad2(minutes)}:${pad2(seconds)}`;
  }

  private updateRefreshTimerLabels(): void {
    const label = this.getRefreshTimerLabel();
    this.root.querySelectorAll<HTMLElement>(".refresh-timer").forEach((element) => {
      element.textContent = label;
    });
  }

  private async updateStationRoutes(stationName: string, forceRefresh: boolean, rerender: boolean = true): Promise<void> {
    if (this.viewMode !== "settings") return;

    const trimmedStation = stationName.trim();
    if (!trimmedStation) {
      this.errorMessage = "";
      if (rerender) this.render();
      return;
    }

    const settings = this.collectSettingsFromForm();
    this.settings = settings;
    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      this.errorMessage = "API key is required.";
      if (rerender) this.render();
      return;
    }

    const stationKey = normalizeKey(trimmedStation);
    if (!forceRefresh && this.routeSuggestionsByStation[stationKey]) {
      this.errorMessage = "";
      if (rerender) this.render();
      return;
    }

    try {
      const client = new SLApiClient(apiKey);
      const suggestions = await client.getRouteSuggestionsByStationName(trimmedStation);
      this.routeSuggestionsByStation[stationKey] = suggestions;
      this.errorMessage = "";
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : "Error while loading station routes.";
    }

    if (rerender) {
      this.render();
    }
  }

  private getRoutesForSelectedLine(stationRoutes: StationRouteSuggestions | undefined, lineNumber: string): {
    origins: string[];
    destinations: string[];
    pairs: Array<{ origin: string; destination: string }>;
  } {
    if (!stationRoutes) return { origins: [], destinations: [], pairs: [] };

    const wanted = normalizeLineToken(lineNumber);
    const exactKey = Object.keys(stationRoutes.byLine).find((key) => normalizeLineToken(key) === wanted);
    if (!exactKey) {
      return {
        origins: stationRoutes.origins,
        destinations: stationRoutes.destinations,
        pairs: []
      };
    }

    return stationRoutes.byLine[exactKey];
  }

  private getRoutePairs(
    selected: { origins: string[]; destinations: string[]; pairs: Array<{ origin: string; destination: string }> },
    currentOrigin: string,
    currentDestination: string
  ): Array<{ origin: string; destination: string }> {
    const pairs = [...selected.pairs];
    if (currentOrigin.trim() && currentDestination.trim()) {
      if (!pairs.some((p) => equalsIgnoreCase(p.origin, currentOrigin) && equalsIgnoreCase(p.destination, currentDestination))) {
        pairs.unshift({ origin: currentOrigin.trim(), destination: currentDestination.trim() });
      }
    }
    return pairs;
  }

  private updateRowControlState(row: HTMLElement): void {
    const stationValue = row.querySelector<HTMLInputElement>('input[data-field="stopGroupSearchName"]')?.value.trim() ?? "";
    const lineValue = row.querySelector<HTMLInputElement>('input[data-field="lineNumber"]')?.value.trim() ?? "";
    const routeSelect = row.querySelector<HTMLSelectElement>('select[data-field="originDestinationPair"]');
    if (!routeSelect) return;

    routeSelect.disabled = stationValue.length === 0 || normalizeLineToken(lineValue).length === 0;
  }

  private setRowValue(row: HTMLElement, field: string, value: string): void {
    const select = row.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`);
    if (select) {
      select.value = value;
    }
  }

  private isRowReadyForRouteLookup(row: HTMLElement): boolean {
    const stationValue = row.querySelector<HTMLInputElement>('input[data-field="stopGroupSearchName"]')?.value.trim() ?? "";
    const lineValue = row.querySelector<HTMLInputElement>('input[data-field="lineNumber"]')?.value.trim() ?? "";
    return stationValue.length > 0 && normalizeLineToken(lineValue).length > 0;
  }

}

function validateSettings(settings: AppSettings): void {
  if (!settings.apiKey) throw new Error("API key is required.");
  if (!Number.isFinite(settings.timeWindowMinutes) || settings.timeWindowMinutes <= 0) {
    throw new Error("Time window must be a number greater than zero.");
  }
  if (settings.lines.length === 0) throw new Error("At least one bus line record is required.");

  for (const line of settings.lines) {
    if (!line.stopGroupSearchName || !line.lineNumber || !line.origin || !line.destination) {
      throw new Error("Each record must include station name, line number, origin, and destination.");
    }
  }
}

function equalsIgnoreCase(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function renderRoutePairOptions(
  pairs: Array<{ origin: string; destination: string }>,
  selectedValue: string,
  placeholder: string
): string {
  const options = pairs.map((pair) => {
    const value = encodePair(pair.origin, pair.destination);
    const selectedAttr = value === selectedValue ? " selected" : "";
    const label = `Origin: ${pair.origin} - Destination: ${pair.destination}`;
    return `<option value="${escapeAttr(value)}"${selectedAttr}>${escapeHtml(label)}</option>`;
  });

  options.unshift(`<option value="" ${selectedValue ? "" : "selected"}>${escapeHtml(placeholder)}</option>`);
  return options.join("");
}

function encodePair(origin: string, destination: string): string {
  return `${origin}|||${destination}`;
}

function decodePair(value: string): { origin: string; destination: string } | null {
  if (!value) return null;
  const [origin, destination] = value.split("|||");
  if (!origin || !destination) return null;
  return { origin, destination };
}

function normalizeKey(value: string): string {
  return foldText(value.trim());
}

function normalizeLineToken(value: string): string {
  return foldText(value)
    .replace(/^line\s*/i, "")
    .replace(/\s+/g, "");
}

function sanitizeUpcomingBusResult(result: UpcomingBusQueryResult | null): UpcomingBusQueryResult | null {
  if (!result) return null;

  const lines = result.lines.filter((line) => line.lineNumber.trim().length > 0);
  const arrivals = result.arrivals.filter((arrival) => arrival.lineNumber.trim().length > 0);
  if (lines.length === 0 && arrivals.length === 0) {
    return null;
  }

  return {
    ...result,
    lines,
    arrivals
  };
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
