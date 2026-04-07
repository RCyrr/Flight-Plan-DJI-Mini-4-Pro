# Drone Planner

## Overview
Drone Planner is a browser-based application for creating and managing drone flight plans. It allows users to design flight patterns by drawing polygons on a map, calculate optimal flight strips with proper overlap, and export the results in several formats including KML with elevation information.

## Key Features
- **Modern UI**: Clean, professional interface with overlay sidebars and resizable panels.
- **Intelligent Terrain Follow**: Automatic terrain analysis with a 25x25 grid and smart switching between relative and absolute altitudes based on a configurable threshold.
- **Real-time Calculators**: Bidirectional GSD/Height calculation and color-coded Capture Interval warnings.
- **Advanced Mapping**: Support for "Precise" (Waypoint per Photo) and "Optimized" trigger modes.
- **Multiple Map Layers**: Toggle between OSM, Satellite, OpenTopoMap, and Esri World Topo.
- **DJI Mini 4 Pro Optimized**: Tailored for the 200-waypoint limit and specific sensor specifications.

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
1. **Draw or Select Survey Area**:
   - Click **DRAW** to start drawing a polygon on the map (click to add vertices, double-click to finish).
2. **Configure Flight Parameters**:
   - Set Flight Height (AGL), Flight Speed, Front Overlap, Side Overlap, and **Flight Direction** (0-359°).
   - Flight Direction 0° = North; 90° = East (standard DJI compass).
   - Strips automatically orient **perpendicular** to the flight direction (e.g., Direction=0° → Strips run East-West).
3. **Edit Polygon if Needed**:
   - Click **EDIT** to modify polygon by dragging vertices.
   - Waypoints update **live** every 200ms as you drag (without terrain API calls for performance).
   - Click **DONE** when satisfied with changes.
4. **Generate Flight Plan**:
   - Click **"GENERATE FLIGHT PLAN"** button or modify height/speed/direction to auto-generate.
5. **Review Waypoints**:
   - **Purple waypoint** = Flight start position.
   - **Green waypoints** = Photo capture actions.
   - **Blue waypoints** = Navigation waypoints.
   - Click any waypoint to see altitude, heading, and camera settings.
6. **Fetch Terrain Data** (if enabled):
   - App fetches elevation data in batches of 40 points from Open-Elevation API.
   - Compares terrain variation against threshold (default 10%).
   - Chooses altitude mode: `relativeToStartPoint` for flat terrain or `absolute` (AMSL) for hilly terrain.
7. **Export Results**:
   - Click **Export** to download KMZ file.
   - Import into DJI Fly app using the file replacement workaround.

### Polygon Editing Deep Dive
- **DRAW**: Creates a new polygon. Click to add vertices, double-click to finish, or click DONE.
- **EDIT**: Modifies the existing polygon. Drag vertices to reshape; waypoints regenerate in real-time.
- **DELETE LAST**: Removes the last vertex during drawing.
- **DONE**: Finalizes drawing/editing and applies terrain analysis.
- **CANCEL**: Aborts active operation (only during drawing/editing).
- **DELETE**: Completely removes polygon and all associated waypoints/flight paths.

**Pro Tip**: During EDIT mode, terrain analysis is skipped for better performance. Terrain is recalculated after you click DONE.

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

### Flight Strips Oriented Wrong (East-West instead of North-South)
- **Issue**: Setting direction=0° (North) should create North-South strips, but you see East-West strips.
- **Cause**: Flight direction was being passed directly to the grid generator instead of as perpendicular angle.
- **Fix**: Update `updateFlightPlan()` to convert direction to grid angle: `gridRunAngle = (direction + 90) % 360`.
- **Lesson**: Flight Direction ≠ Strip Orientation. Strips run perpendicular to flight direction.

### Waypoint Heading is 90° Off
- **Issue**: Exported KML shows heading 90° off from expected value (e.g., expecting North, got East).
- **Cause**: Web coordinate system (0°=East) vs DJI compass system (0°=North) mismatch.
- **Fix**: Add +90° offset in heading calculation: `heading = (angle + 90) % 360`.
- **Lesson**: Always clarify compass conventions before calculations; document assumptions.

### Map Shows a White Screen After Reload
- **Issue**: Map doesn't render after code changes; syntax error in console.
- **Cause**: Orphaned incomplete code from partial function deletions (e.g., `updateDrawButtons(true);` with no parent).
- **Fix**: Use exact multi-line context when replacing code to avoid leaving orphaned statements.
- **Lesson**: When deleting functions, ensure ALL related code is removed. Use tools that show exact whitespace.

### DONE Button Doesn't Finalize Editing
- **Issue**: After clicking DONE during polygon editing, buttons remain disabled and polygon styling isn't restored.
- **Cause**: Duplicate function definitions. Old simple version at line 440 overwrites correct version at line 208.
- **Fix**: Grep for all function definitions; delete all old duplicates. Keep only the original complete versions.
- **Lesson**: Always check for duplicates after edits: `grep -n "^function functionName" app.js`

### Delete Button Never Enables
- **Issue**: DELETE button remains disabled even after finishing drawing/editing.
- **Cause**: `updateDrawButtons()` called with incomplete logic, or duplicate version missing DELETE button handling.
- **Fix**: Ensure all button state updates go through single `updateDrawButtons()` function; log each call for debugging.
- **Lesson**: Centralize all UI state updates in one function to prevent inconsistencies.

### Elevation Data Not Updating During Live Edit
- **Issue**: Dragging polygon vertices doesn't regenerate waypoints with terrain data.
- **Cause**: API rate limiting. Terrain analysis is intentionally skipped during live preview.
- **Fix**: This is by design. Terrain fetches resume after clicking DONE.
- **Lesson**: Document performance optimizations; users need to know why something is "not working."

### KML Shows 0° Wrong Direction
- **Issue**: Exported waypoints have heading 0° pointing East instead of North.
- **Cause**: Heading calculated without compass system conversion.
- **Fix**: Use `heading?.toFixed(1) ?? 0` with +90° conversion: `heading = (grid_angle + 90) % 360`.

### If KML shows features clamped to ground in Google Earth
- Ensure `<altitudeMode>absolute</altitudeMode>` is present in exported KML.
- Open KML with 3D terrain enabled in Google Earth.

### If elevations are missing
- Check console logs for Open-Elevation request/response errors.
- Verify API batching: requests should be 40-point batches.
- Check network tab (CORS restrictions) if API calls fail silently.

### If the loading indicator causes errors
- Ensure `#loadingElevation` element exists in the DOM.
- App creates it programmatically if missing; verify in browser console.

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