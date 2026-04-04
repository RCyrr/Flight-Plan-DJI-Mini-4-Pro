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
- Dual-sidebar layout:
    - **Left Sidebar**: Flight parameters (Height, Overlap, Speed, Direction, Camera).
    - **Right Sidebar**: Waypoint details (Index, Action, Coordinates, Altitude, Camera Settings).
- **Search Bar**: Nominatim-based location search.

### 3.2. Grid Generation Logic (`app.js`)
- **`updateFlightPlan`**: Orchestrates the calculation of GSD, strip spacing, and photo interval.
- **`generateGrid`**: 
    1. Rotates the user-drawn polygon by the negative flight direction.
    2. Generates horizontal strips within the rotated bounding box.
    3. Clips strips to the polygon and adds waypoints (Precise or Optimized).
    4. Rotates waypoints back to the original orientation.
- **`renderWaypoints`**: Visualizes waypoints as clickable markers with popups and updates the right panel.

### 3.3. KMZ Export/Import (`app.js`)
- **`exportBtn.onclick`**: 
    1. Fetches elevation data for all waypoints.
    2. Generates `template.kml` and `waylines.wpml` using DJI WPML V2/V3 schema.
    3. Bundles into a `.kmz` file for download.
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
