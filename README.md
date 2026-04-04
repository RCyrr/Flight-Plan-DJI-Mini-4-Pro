# Drone Planner

## Overview
Drone Planner is a browser-based application for creating and managing drone flight plans. It allows users to design flight patterns by drawing polygons on a map, calculate optimal flight strips with proper overlap, and export the results in several formats including KML with elevation information.

## Key Features
- Drone model selection with automatic parameter configuration
- Polygon drawing/import for defining flight areas
- Automatic flight strip calculation with configurable parameters
- Photo point generation with overlap configuration
- Elevation data integration from Open Elevation API
- Export options (CSV, JSON, KML with elevation)
- Photo point filtering for streamlined missions
- Multilingual UI (English/German)

## Tech Stack
- HTML/CSS (single-file app)
- Vanilla JavaScript
- Leaflet.js for map rendering
- Turf.js for geospatial calculations
- Exifr for EXIF reading
- shapefile.js for shapefile import

## File Layout
- `index.html` — main application single-file SPA
- `README.md` — this documentation
- shapefile and sample data files in repo root

## How it works
1. Select or configure a drone (focal length, pixel size, sensor size).
2. Draw a polygon on the map or import a shapefile defining the survey area.
3. Configure flight parameters: direction, GSD or height, overlaps.
4. Click "Calculate Flight Strips" to generate strips and photo points.
5. The app fetches terrain elevation data and computes absolute altitudes.
6. Export results (CSV, JSON, KML). KML includes altitude and altitudeMode to show 3D in Google Earth.

## Elevation integration details
- Batch requests to Open Elevation API endpoint `https://api.open-elevation.com/api/v1/lookup` (POST JSON: { locations: [{latitude, longitude}, ...] }).
- Batches of up to 1000 points to respect API limits.
- Progress indicator shown during fetching (`#loadingElevation`).
- On success, terrain elevation is added to flight height to produce absolute altitude.
- On failure or timeout, the app falls back to zero elevation for affected points.

## KML export details
- Coordinates are written as `longitude,latitude,altitude`.
- Includes `<altitudeMode>absolute</altitudeMode>` to instruct Google Earth to use provided elevations.
- Uses `<extrude>1</extrude>` for strips to visualize vertical connection to the ground.

## Data structures
- Photo point object:
```javascript
{
  lat: Number,
  lng: Number,
  stripIndex: Number,
  pointIndex: Number,
  marker: L.CircleMarker,
  elevation: Number,         // terrain elevation (m)
  absoluteAltitude: Number   // terrain + flight height (m)
}
```
- Strip elevation storage:
```javascript
window.stripElevations = {
  <layerId>: [ {lat,lng,elevation,absoluteAltitude}, ... ],
  ...
}
```

## Development guidelines
- Keep code documented with inline comments when adding features.
- Add translations to `TRANSLATIONS` for new UI text.
- Add unit tests for geometric calculations where possible (Turf-based outputs).
- Use console logging for long-running tasks that may require inspection.

## Troubleshooting
- If KML shows features clamped to ground in Google Earth: ensure `<altitudeMode>absolute</altitudeMode>` is present and KML is opened with 3D terrain enabled.
- If elevations are missing: check console logs for Open Elevation request/response, and check network (CORS) restrictions.
- If the loading indicator causes errors: ensure `#loadingElevation` exists in the DOM; the app creates it programmatically if missing.

## Testing checklist
- [ ] Draw polygon and calculate strips
- [ ] Confirm `Points to fetch elevation for` appears in console
- [ ] Confirm elevations returned and `absoluteAltitude` set
- [ ] Export KML and open in Google Earth; verify photo points and strips at expected altitude
- [ ] Test KML with filters applied (filteredPhotoPoints)

## Future improvements
- Split JS into modules for maintainability
- Add unit/integration tests
- Add caching of elevation tiles to reduce API calls
- Support additional elevation providers (Mapbox, Google Elevation) with selectable fallback
- Add offline mode and persistent project save/load

## Contributing
- Fork the repo, make changes, and submit a PR.
- Keep changes small and focused.
- Update README and add any required assets.

## License
MIT

## Contact
For questions or help, open an issue in the repo or contact the maintainer.