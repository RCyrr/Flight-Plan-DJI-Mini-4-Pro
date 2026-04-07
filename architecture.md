# Architecture: DJI Mini 4 Pro Flight Planner

## 1. System Overview
A single-page application (SPA) built with HTML5, CSS3, and JavaScript. No backend is required, as all calculations and file generation (KMZ) are performed on the client side.

## 2. Tech Stack
- **Map Engine**: [Leaflet.js](https://leafletjs.com/) (v1.9.4)
- **Drawing Tools**: [Leaflet.draw](https://github.com/Leaflet/Leaflet.draw) (v0.4.14)
- **Geometry Engine**: [Turf.js](https://turfjs.org/) (v6) for polygon rotation, intersection, and grid generation.
- **KMZ Packaging**: [JSZip](https://stuk.github.io/jszip/) (v3.10.1) for bundling KML/WPML files into a ZIP.
- **Elevation Data**: [Open-Elevation API](https://open-elevation.com/) for terrain height fetching.
- **Map Tiles**: OpenStreetMap (OSM) and Esri World Imagery (Satellite).

## 3. Core Components
### 3.1. Map Interface (`index.html`)
- **Modern Overlay Layout**:
    - **Top Navigation Bar**: "Create Flight" menu, Location Search, Map Layer Toggle (OSM, Satellite, Topo, Esri Topo), and Global Camera Settings.
    - **Left Sidebar (Overlay)**: Dynamic flight parameters (GSD, Height, Speed, Overlap, Direction, Gimbal).
    - **Right Sidebar (Resizable/Toggleable)**: 
        - **Project Details**: Real-time Area calculation (Turf.js), Waypoint counter (200 limit), and Terrain Analysis (Min/Max).
        - **Waypoint Details**: Interactive metadata for selected points (Lat/Lng, AGL/AMSL Height, Camera Actions).
- **Polygon Drawing Toolbar**:
    - **DRAW**: Activate polygon drawing mode with Leaflet.draw.
    - **EDIT**: Activate vertex editing mode (drag vertices for live-preview regeneration).
    - **DELETE LAST**: Remove last vertex from current drawing.
    - **DONE**: Finalize drawing or editing session; restore normal state.
    - **CANCEL**: Abort drawing/editing without saving changes.
    - **DELETE**: Remove entire polygon and associated waypoints/flight lines.

### 3.2. Polygon Drawing & Editing Workflow (`app.js`)
#### Drawing Mode
- **`startPolygonDraw()`**: Activates `L.Draw.Polygon` handler with blue styling.
- **`activeDrawHandler`**: Manages the current Leaflet.draw instance.
- User draws polygon; each click adds a vertex.
- Double-click or DONE button finalizes the polygon.

#### Editing Mode  
- **`startPolygonEdit()`**: Activates `L.EditToolbar.Edit` handler on existing polygon.
- **`polygonEditHandler`**: Active edit session instance.
- **Live-Edit Polling** (200ms interval): 
    - Detects vertex coordinate changes via JSON hash comparison (`lastEditCoords`).
    - Automatically regenerates waypoints WITHOUT calling terrain API (`isEditingForPreview = true`).
    - Users see real-time flight path updates while dragging vertices.
- **Terrain Analysis Skip**: During preview, `isEditingForPreview` flag prevents API calls to avoid rate limiting.

#### Finalization
- **`finishPolygonDraw()`**: 
    - Disables active handler (Draw or Edit).
    - Sets `isEditingForPreview = false` to re-enable terrain analysis.
    - Calls `normalizePolygon()` to restore blue styling.
    - Updates button states via `updateDrawButtons(false, false)`.
- **`normalizePolygon()`**: Restores polygon to blue (#3498db) with 0.2 fill opacity after edit completion.
- **`cancelPolygonDraw()`**: Reverts changes without saving; only in EDIT mode.
- **`deletePolygon()`**: Removes polygon, clears all waypoints, removes flight path layer.

#### Button State Management
- **`updateDrawButtons(isDrawing, isEditing)`**: Central state manager; prevents orphaned incomplete code.
    - **DRAW/EDIT**: Disabled when drawing OR editing.
    - **DELETE LAST**: Disabled when NOT in drawing mode.
    - **DONE/CANCEL**: Enabled only during drawing/editing.
    - **DELETE**: Enabled when polygon exists and not editing.
    - Includes console logging for debugging state transitions.

#### Safety Checks
- **Single Definition Rule**: Functions must be defined only ONCE in the file.
    - Previous duplicate `finishPolygonDraw()`, `cancelPolygonDraw()`, `updateDrawButtons()` were deleted after discovery.
    - Added warning comments to prevent future duplicates.
- **Handler Nullification**: After disabling, handlers are set to `null` to avoid dangling references.

### 3.3. Grid Generation Logic (`app.js`)
- **Flight Direction Compass Conversion**:
    - User-defined Flight Direction (0-359°) follows **DJI compass**: 0° = North, 90° = East.
    - Grid stripes run **perpendicular** to flight direction.
    - Formula: `gridRunAngle = (direction + 90) % 360`
    - Example: Direction=0° (North flight) → Strips run East-West (gridRunAngle=90°).
- **`generateGrid`**: 
    1. Takes angle as perpendicular direction (NOT flight direction directly).
    2. Rotates the user-drawn polygon by `-angle`.
    3. Generates horizontal strips in rotated space.
    4. **Precise Mode**: Generates individual waypoints for every photo trigger point.
    5. **Optimized Mode**: Minimizes waypoints using timed shots (4 waypoints per strip).
    6. Rotates waypoints back to original coordinate system.
    7. Adds `heading` property: `(angle + 90) % 360` to convert back to DJI compass.
- **Terrain Analysis**: Generates a 25x25 internal grid to determine project elevation range.
- **API Rate Limiting**: 
    - Terrain queries batched in 40-point groups.
    - 300ms throttle between API calls.
    - Skipped during live-edit preview to optimize performance.

### 3.4. Waypoint Rendering & Visualization (`app.js`)
- **First Waypoint Marker** (Purple #9b59b6): Clearly marks flight start position.
- **Action Waypoints** (Green #28a745): Photo/capture actions.
- **Navigation Waypoints** (Blue #007bff): Path-only waypoints without actions.
- **Interactive Popups**: Click waypoint to show Lat/Lng, altitude, camera settings, and heading.

### 3.5. KMZ Export/Import (`app.js`)
- **Intelligent Elevation Logic**: 
    1. Fetches terrain data in stable batches of 40 points.
    2. **Threshold Check**: Compares terrain variation against a user-defined threshold (default 10%).
    3. **Conditional Mode**: Automatically uses `relativeToStartPoint` for flat terrain and offers `absolute` (AMSL) for significant variations.
- **Waypoint Heading**: 
    - Uses `wp.heading` property (calculated from grid angle).
    - Ensures consistent compass orientation in exported DJI mission.
    - Safe fallback: `wp.heading?.toFixed(1) ?? 0` to prevent undefined values.
- **`importFile.onchange`**: 
    1. Unzips the KMZ and parses the XML.
    2. Extracts coordinates and altitudes to populate the map and UI.

## 4. Data Flow
1. **User Input**: Draw polygon + set parameters + set flight direction.
2. **Grid Calculation**: 
    - Flight Direction converted to grid angle (perpendicular orientation).
    - Turf.js generates grid nodes based on direction-adjusted angle.
    - Live-preview during edit mode skips API calls for performance.
3. **Visualization**: 
    - Leaflet renders the flight path (red dashed polyline).
    - Circle markers at waypoints (purple for start, green/blue for others).
4. **Elevation**: Fetch terrain height via API (with throttling and batching).
5. **Export**: JSZip packages the DJI-compatible mission file with heading data.

## 5. Code Safety Practices

### Defensive Checks
- **Single Definition Rule**: All functions must be defined exactly ONCE.
    - Duplicates cause later definitions to overwrite earlier ones silently.
    - If discovered, all old duplicate definitions must be completely removed.
- **Button State Centralization**: `updateDrawButtons()` is the ONLY place where button disabled states are updated.
    - Prevents orphaned incomplete code from partial replacements.
- **Handler Nullification**: After disabling Leaflet.draw handlers, always set to `null` to prevent dangling references.
- **Edit Polling Cleanup**: `editCheckInterval` is cleared before starting draw/edit mode to prevent multiple timers.
- **API Safe Access**: Use optional chaining and nullish coalescing for waypoint heading: `wp.heading?.toFixed(1) ?? 0`.

### Known Issues & Resolutions
| Issue | Root Cause | Resolution | Lesson |
|-------|-----------|-----------|--------|
| DONE button state not updating | Duplicate `finishPolygonDraw()` at line 440 overwrote correct version at line 208 | Deleted all duplicates; verified via grep | Always search for duplicates before editing |
| Flight strips oriented East-West instead of North-South | Grid angle was direction instead of perpendicular orientation | Added angle conversion: `(direction + 90) % 360` | Flight direction ≠ strip orientation |
| Heading 0° computed as East instead of North | Web compass (0°=East) vs DJI compass (0°=North) mismatch | Added +90° offset in heading calculation | Document coordinate system assumptions |
| Syntax error after partial deletion | Orphaned orphaned `updateDrawButtons(true);` with no parent function | Removed orphaned code completely | Use exact multi-line replacement context |

## 6. Deployment
- **Platform**: GitHub Pages.
- **URL**: `https://RCyrr.github.io/Flight-Plan-DJI-Mini-4-Pro/`
- **Branch**: `dev` for development, `master` for stable releases.
