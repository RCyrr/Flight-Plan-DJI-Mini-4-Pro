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

### 3.2. Grid Generation Logic (`app.js`)
- **Bidirectional GSD/Height**: Real-time recalculation of Height based on GSD and vice versa using DJI Mini 4 Pro sensor specs.
- **Capture Interval Calculator**: Dynamic interval calculation with color-coded warnings (Red < 3s, Orange 3-5s, Green > 5s).
- **`generateGrid`**: 
    1. Rotates the user-drawn polygon.
    2. Generates horizontal strips.
    3. **Precise Mode**: Generates individual waypoints for every photo trigger point.
    4. **Optimized Mode**: Minimizes waypoints using timed shots.
- **Terrain Analysis**: Generates a 25x25 internal grid to determine project elevation range.

### 3.3. KMZ Export/Import (`app.js`)
- **Intelligent Elevation Logic**: 
    1. Fetches terrain data in stable batches of 40 points.
    2. **Threshold Check**: Compares terrain variation against a user-defined threshold (default 10%).
    3. **Conditional Mode**: Automatically uses `relativeToStartPoint` for flat terrain and offers `absolute` (AMSL) for significant variations.
- **`importFile.onchange`**: 
    1. Unzips the KMZ and parses the XML.
    2. Extracts coordinates and altitudes to populate the map and UI.

## 4. Data Flow
1. **User Input**: Draw polygon + set parameters.
2. **Calculation**: Turf.js generates the grid nodes.
3. **Visualization**: Leaflet renders the path and markers.
4. **Elevation**: Fetch terrain height via API.
5. **Export**: JSZip packages the DJI-compatible mission file.

## 5. Deployment
- **Platform**: GitHub Pages.
- **URL**: `https://RCyrr.github.io/Flight-Plan-DJI-Mini-4-Pro/`
