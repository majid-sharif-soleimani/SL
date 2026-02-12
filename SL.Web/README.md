# SL.Web

A client-only TypeScript web app for tracking SL bus arrivals at a configured stop.

## Features

- One-time settings page with localStorage persistence
- Hamburger menu with quick access to settings and dashboard
- Configurable stop name, time window, API key, and multiple lines
- Optional origin and destination filters for each line
- Arrival output similar to `SL/Program.cs`
- No server-side code

## Run

```bash
cd SL.Web
npm install
npm run dev
```

Then open the local Vite URL (usually `http://localhost:5173`).

## Notes

- The app calls Trafiklab API directly from the browser.
- API key is saved in browser localStorage.
- If CORS is restricted by the API provider, browser calls may fail.

