# PRD: DJI Mini 4 Pro Photogrammetric Flight Planner

## 1. Overview
A web-based tool to generate DJI-compatible KMZ flight plans (WPML format) for the DJI Mini 4 Pro, specifically optimized for photogrammetry and terrain-aware missions.

## 2. Target Hardware
- **Drone**: DJI Mini 4 Pro
- **Controller**: DJI RC 2 (Integrated Screen) or RC-N2 with Android device.
- **Software**: DJI Fly App (Waypoint Mission support).

## 3. Key Features
- **Interactive Map**: Leaflet.js with OSM and Satellite (Esri) layers. Deep zoom (level 22) for precise waypoint selection.
- **Grid Generation**: S-pattern flight strips based on GSD, overlap (Front/Side), and user-defined Flight Direction (0-359°).
- **Camera Support**: 
    - Standard Lens (6.78mm real focal length).
    - Wide Angle Adapter (4.8mm real focal length).
    - 1.2um pixel size, 1/1.3" sensor (9.6mm width).
- **Terrain Awareness**: Integration with Open-Elevation API for AMSL altitude calculation (Terrain + Flying Height).
- **Hybrid Trigger Strategy**:
    - **Precise Mode**: Waypoint-per-photo (max 200) with full camera control (ISO, Shutter, WB, Focus).
    - **Optimized Mode**: 4-waypoint-per-strip logic for large areas with manual interval instructions.
- **KMZ Management**: Export of DJI WPML (V2/V3) files and full editable import of existing missions.

## 4. Constraints
- **Waypoint Limit**: DJI Mini 4 Pro supports a maximum of 200 waypoints per mission.
- **WPML Support**: Limited camera action support on Mini 4 Pro; requires `reachPoint` triggers for high reliability.
- **Connectivity**: Requires internet for map tiles and elevation data (Online API).

## 5. Future Roadmap
- Offline elevation support (GeoTIFF/DEM).
- 3x Tele-camera support.
- Multi-battery mission splitting.
