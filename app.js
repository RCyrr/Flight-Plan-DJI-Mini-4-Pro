// DJI Mini 4 Pro Camera Specs
const SENSOR_WIDTH = 9.6; // mm
const PIXEL_SIZE = 0.0012; // mm (1.2 micrometer)
const IMAGE_WIDTH = 8000; // px (approx for 9.6mm / 1.2um)
const IMAGE_HEIGHT = 4500; // px (16:9 ratio)
const SENSOR_HEIGHT = IMAGE_HEIGHT * PIXEL_SIZE; // mm

const DJI_INTERVALS = [2, 3, 5, 7, 10, 15, 20, 30, 60];

let map, drawnItems, polygonLayer;
let flightLines = [];
let waypoints = [];

// Initialize Map
function initMap() {
    map = L.map('map', {
        maxZoom: 22
    }).setView([48.7758, 9.1829], 13); // Stuttgart default

    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 22,
        maxNativeZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    });

    const baseMaps = {
        "Map": osm,
        "Satellite": satellite
    };

    L.control.layers(baseMaps).addTo(map);
    L.control.scale().addTo(map);

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
        edit: { featureGroup: drawnItems },
        draw: {
            polygon: true,
            polyline: false,
            rectangle: false,
            circle: false,
            marker: false,
            circlemarker: false
        }
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, function (event) {
        drawnItems.clearLayers();
        polygonLayer = event.layer;
        drawnItems.addLayer(polygonLayer);
        updateFlightPlan();
    });

    // Search functionality
    document.getElementById('search-btn').onclick = searchLocation;

    // Trigger mode change listener
    document.getElementById('triggerMode').onchange = function() {
        const preciseSettings = document.getElementById('precise-settings');
        preciseSettings.style.display = this.value === 'precise' ? 'block' : 'none';
        updateFlightPlan();
    };
}

async function searchLocation() {
    const query = document.getElementById('search-input').value;
    if (!query) return;
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (data.length > 0) {
        map.setView([data[0].lat, data[0].lon], 15);
    }
}

// Grid Generation Logic
function updateFlightPlan() {
    if (!polygonLayer) return;

    const height = parseFloat(document.getElementById('height').value);
    const frontOverlap = parseFloat(document.getElementById('frontOverlap').value) / 100;
    const sideOverlap = parseFloat(document.getElementById('sideOverlap').value) / 100;
    const speed = parseFloat(document.getElementById('speed').value);
    const direction = parseFloat(document.getElementById('direction').value);
    const focalLength = parseFloat(document.getElementById('focalLength').value);
    const triggerMode = document.getElementById('triggerMode').value;

    // Calculate GSD and Spacing
    // GSD = (H * sensor_w) / (f * image_w)
    const gsd = (height * SENSOR_WIDTH) / (focalLength * IMAGE_WIDTH);
    const footprintW = gsd * IMAGE_WIDTH;
    const footprintH = gsd * IMAGE_HEIGHT;

    const stripSpacing = footprintW * (1 - sideOverlap);
    const photoSpacing = footprintH * (1 - frontOverlap);
    let interval = photoSpacing / speed;

    // Round to nearest DJI interval
    interval = DJI_INTERVALS.reduce((prev, curr) => 
        Math.abs(curr - interval) < Math.abs(prev - interval) ? curr : prev
    );

    document.getElementById('stats').innerHTML = `
        GSD: ${(gsd * 100).toFixed(2)} cm/px<br>
        Interval: ${interval.toFixed(1)} s (DJI Match)<br>
        Calculating...
    `;

    generateGrid(polygonLayer.toGeoJSON(), stripSpacing, photoSpacing, direction, interval, speed, height, triggerMode);
}

function generateGrid(polygon, spacing, photoSpacing, angle, interval, speed, height, triggerMode) {
    const bbox = turf.bbox(polygon);
    const center = turf.center(polygon);
    
    // Simplified grid: rotate polygon, generate horizontal lines, rotate back
    const rotatedPoly = turf.transformRotate(polygon, -angle, { pivot: center });
    const rBbox = turf.bbox(rotatedPoly);
    
    const waypointsList = [];
    let currentY = rBbox[1] + (spacing / 222640); // start offset
    let directionToggle = true;

    while (currentY < rBbox[3]) {
        const line = turf.lineString([[rBbox[0], currentY], [rBbox[2], currentY]]);
        const intersect = turf.lineIntersect(line, rotatedPoly);
        
        if (intersect.features.length >= 2) {
            // Sort intersections by X
            const pts = intersect.features.sort((a, b) => a.geometry.coordinates[0] - b.geometry.coordinates[0]);
            let start = pts[0].geometry.coordinates;
            let end = pts[pts.length - 1].geometry.coordinates;

            if (!directionToggle) {
                [start, end] = [end, start];
            }

            if (triggerMode === 'precise') {
                // Add a waypoint for every photo
                const stripVec = [end[0] - start[0], end[1] - start[1]];
                const len = Math.sqrt(stripVec[0]**2 + stripVec[1]**2);
                const photoDistDeg = photoSpacing / 111320;
                const numPhotos = Math.floor(len / photoDistDeg);
                
                for (let j = 0; j <= numPhotos; j++) {
                    const ratio = j / numPhotos;
                    const pos = [start[0] + stripVec[0] * ratio, start[1] + stripVec[1] * ratio];
                    waypointsList.push({ coord: pos, action: 'take_photo', label: 'Photo Point' });
                }
            } else {
                // Optimized mode: 4 waypoints per strip
                const bufferDistDeg = photoSpacing / 111320; 
                const stripVec = [end[0] - start[0], end[1] - start[1]];
                const len = Math.sqrt(stripVec[0]**2 + stripVec[1]**2);
                
                if (len > bufferDistDeg * 2.1) {
                    const offsetRatio = bufferDistDeg / len;
                    const startInner = [start[0] + stripVec[0] * offsetRatio, start[1] + stripVec[1] * offsetRatio];
                    const endInner = [end[0] - stripVec[0] * offsetRatio, end[1] - stripVec[1] * offsetRatio];

                    waypointsList.push({ coord: start, action: 'none', label: 'Start Strip' });
                    waypointsList.push({ coord: startInner, action: 'none', label: 'Entry Buffer' });
                    waypointsList.push({ coord: endInner, action: 'none', label: 'Exit Buffer' });
                    waypointsList.push({ coord: end, action: 'none', label: 'Stop Strip' });
                } else {
                    waypointsList.push({ coord: start, action: 'none', label: 'Start Strip' });
                    waypointsList.push({ coord: end, action: 'none', label: 'Stop Strip' });
                }
            }
            
            directionToggle = !directionToggle;
        }
        currentY += (spacing / 111320); // increment Y
    }

    // Rotate waypoints back
    waypoints = waypointsList.map(wp => {
        const pt = turf.point(wp.coord);
        const rotatedPt = turf.transformRotate(pt, angle, { pivot: center });
        return {
            lat: rotatedPt.geometry.coordinates[1],
            lng: rotatedPt.geometry.coordinates[0],
            action: wp.action,
            label: wp.label
        };
    });

    renderWaypoints(interval, height);
}

function renderWaypoints(interval, height) {
    if (window.flightPathLayer) map.removeLayer(window.flightPathLayer);
    if (window.markerLayer) map.removeLayer(window.markerLayer);
    
    window.markerLayer = L.layerGroup().addTo(map);
    const latlngs = waypoints.map((wp, i) => {
        const marker = L.circleMarker([wp.lat, wp.lng], {
            radius: 5,
            color: wp.action !== 'none' ? 'green' : 'blue',
            fillOpacity: 0.8
        }).addTo(window.markerLayer);
        
        marker.on('click', () => {
            const triggerMode = document.getElementById('triggerMode').value;
            const gimbalOverride = document.getElementById('gimbalOverride').value;
            const iso = document.getElementById('iso').value;
            const shutter = document.getElementById('shutterSpeed').value;
            const format = document.getElementById('imageFormat').value;
            const wb = document.getElementById('whiteBalance').value;

            document.getElementById('waypoint-info').innerHTML = `
                <div style="padding: 10px; background: white; border-radius: 4px; border: 1px solid #ddd;">
                    <strong>Waypoint ${i}</strong><br>
                    <hr>
                    <b>Action:</b> ${wp.label}<br>
                    <b>Lat:</b> ${wp.lat.toFixed(6)}<br>
                    <b>Lng:</b> ${wp.lng.toFixed(6)}<br>
                    <b>Alt (AMSL):</b> ${height}m<br>
                    ${triggerMode === 'precise' && wp.action === 'take_photo' ? `
                        <hr>
                        <b>Camera Settings:</b><br>
                        ISO: ${iso}<br>
                        Shutter: ${shutter}<br>
                        Format: ${format}<br>
                        WB: ${wb}<br>
                        Gimbal Pitch: ${gimbalOverride}°
                    ` : ''}
                    ${wp.action === 'start_interval' ? `<b>Interval:</b> ${interval}s` : ''}
                </div>
            `;
        });

        marker.bindPopup(`<b>Waypoint ${i}</b><br>${wp.label}`);
        return [wp.lat, wp.lng];
    });

    window.flightPathLayer = L.polyline(latlngs, { color: 'red', weight: 2 }).addTo(map);
    
    document.getElementById('stats').innerHTML = `
        Waypoints: ${waypoints.length} / 200<br>
        Interval: ${interval.toFixed(2)} s<br>
        Height: ${height} m
    `;
    
    document.getElementById('exportBtn').disabled = waypoints.length === 0 || waypoints.length > 200;
}

// Export Logic (KMZ)
document.getElementById('exportBtn').onclick = async () => {
    const zip = new JSZip();
    const wpmz = zip.folder("wpmz");
    
    const height = parseFloat(document.getElementById('height').value);
    const speed = parseFloat(document.getElementById('speed').value);
    const cameraAngle = parseFloat(document.getElementById('cameraAngle').value);
    const triggerMode = document.getElementById('triggerMode').value;
    const gimbalOverride = parseFloat(document.getElementById('gimbalOverride').value);
    
    // Precise Settings
    const iso = document.getElementById('iso').value;
    const shutter = document.getElementById('shutterSpeed').value;
    const format = document.getElementById('imageFormat').value;
    const wb = document.getElementById('whiteBalance').value;
    const focusMode = document.getElementById('focusMode').value;
    
    const frontOverlap = parseFloat(document.getElementById('frontOverlap').value) / 100;
    const sideOverlap = parseFloat(document.getElementById('sideOverlap').value) / 100;
    const focalLength = parseFloat(document.getElementById('focalLength').value);
    
    // Calculate GSD and Interval
    const gsd = (height * SENSOR_WIDTH) / (focalLength * IMAGE_WIDTH);
    const photoSpacing = (gsd * IMAGE_HEIGHT) * (1 - frontOverlap);
    const interval = photoSpacing / speed;

    // Fetch Elevation (Terrain Follow)
    const terrainFollow = document.getElementById('terrainFollow').checked;
    let elevations = [];
    if (terrainFollow) {
        const coords = waypoints.map(wp => `${wp.lat},${wp.lng}`).join('|');
        const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${coords}`);
        const data = await response.json();
        elevations = data.results.map(r => r.elevation);
    }

    // Generate template.kml
    const templateKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:author>DJI Flight Planner</wpml:author>
    <wpml:createTime>${Date.now()}</wpml:createTime>
    <wpml:updateTime>${Date.now()}</wpml:updateTime>
    <wpml:missionConfig>
      <wpml:flyToWayPointMode>safely</wpml:flyToWayPointMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goHome</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${speed}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneModelKey>67</wpml:droneModelKey>
        <wpml:droneEnumValue>67</wpml:droneEnumValue>
      </wpml:droneInfo>
    </wpml:missionConfig>
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineInterpolateConfig>
        <wpml:waylineInterpolateType>linear</wpml:waylineInterpolateType>
      </wpml:waylineInterpolateConfig>
      <wpml:autoFlightSpeed>${speed}</wpml:autoFlightSpeed>
      ${waypoints.map((wp, i) => {
        const terrainAlt = terrainFollow ? (elevations[i] || 0) : 0;
        const absoluteAlt = terrainAlt + height;
        return `
      <Placemark>
        <Point>
          <coordinates>${wp.lng},${wp.lat}</coordinates>
        </Point>
        <wpml:index>${i}</wpml:index>
        <wpml:ellipsoidHeight>${absoluteAlt.toFixed(2)}</wpml:ellipsoidHeight>
        <wpml:height>${absoluteAlt.toFixed(2)}</wpml:height>
        <wpml:useGlobalTransitionalSpeed>1</wpml:useGlobalTransitionalSpeed>
        <wpml:useGlobalHeadingMode>1</wpml:useGlobalHeadingMode>
        <wpml:useGlobalTurnMode>1</wpml:useGlobalTurnMode>
        <wpml:gimbalPitchAngle>${triggerMode === 'precise' ? gimbalOverride : cameraAngle}</wpml:gimbalPitchAngle>
        <wpml:actionGroup>
          <wpml:actionGroupId>${i}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${i}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>
          ${i === 0 && triggerMode === 'precise' ? `
          <wpml:action>
            <wpml:actionId>10</wpml:actionId>
            <wpml:actionType>cameraFocusMode</wpml:actionType>
            <wpml:actionActuatorFuncParam>
              <wpml:focusMode>${focusMode === 'AUTO' ? 'auto' : 'manual'}</wpml:focusMode>
            </wpml:actionActuatorFuncParam>
          </wpml:action>
          ${focusMode === 'INFINITY' ? `
          <wpml:action>
            <wpml:actionId>11</wpml:actionId>
            <wpml:actionType>cameraFocusTarget</wpml:actionType>
            <wpml:actionActuatorFuncParam>
              <wpml:focusTarget>1.0</wpml:focusTarget>
            </wpml:actionActuatorFuncParam>
          </wpml:action>` : focusMode === 'NEAR' ? `
          <wpml:action>
            <wpml:actionId>11</wpml:actionId>
            <wpml:actionType>cameraFocusTarget</wpml:actionType>
            <wpml:actionActuatorFuncParam>
              <wpml:focusTarget>0.0</wpml:focusTarget>
            </wpml:actionActuatorFuncParam>
          </wpml:action>` : ''}` : ''}
          ${wp.action === 'take_photo' ? `
          <wpml:action>
            <wpml:actionId>0</wpml:actionId>
            <wpml:actionType>takePhoto</wpml:actionType>
          </wpml:action>
          <wpml:action>
            <wpml:actionId>1</wpml:actionId>
            <wpml:actionType>cameraFileFormat</wpml:actionType>
            <wpml:actionActuatorFuncParam>
              <wpml:fileFormat>${format}</wpml:fileFormat>
            </wpml:actionActuatorFuncParam>
          </wpml:action>
          ${iso !== 'AUTO' ? `
          <wpml:action>
            <wpml:actionId>2</wpml:actionId>
            <wpml:actionType>cameraISO</wpml:actionType>
            <wpml:actionActuatorFuncParam>
              <wpml:iso>${iso}</wpml:iso>
            </wpml:actionActuatorFuncParam>
          </wpml:action>` : ''}
          ${shutter !== 'AUTO' ? `
          <wpml:action>
            <wpml:actionId>3</wpml:actionId>
            <wpml:actionType>cameraShutterSpeed</wpml:actionType>
            <wpml:actionActuatorFuncParam>
              <wpml:shutterSpeed>${shutter}</wpml:shutterSpeed>
            </wpml:actionActuatorFuncParam>
          </wpml:action>` : ''}
          ${wb !== 'AUTO' ? `
          <wpml:action>
            <wpml:actionId(4)</wpml:actionId>
            <wpml:actionType>cameraWhiteBalance</wpml:actionType>
            <wpml:actionActuatorFuncParam>
              <wpml:whiteBalance>${wb}</wpml:whiteBalance>
            </wpml:actionActuatorFuncParam>
          </wpml:action>` : ''}` : ''}
        </wpml:actionGroup>
      </Placemark>`;
      }).join('')}
    </Folder>
  </Document>
</kml>`;

    wpmz.file("template.kml", templateKml);
    wpmz.file("waylines.wpml", templateKml); // For simplicity, DJI Pilot 2 often uses the same for both

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "flight_plan.kmz";
    link.click();
};

document.getElementById('generateBtn').onclick = updateFlightPlan;

// KMZ Import Logic
document.getElementById('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const zip = await JSZip.loadAsync(file);
    const kmlFile = zip.file("wpmz/template.kml") || zip.file("wpmz/waylines.wpml");
    if (!kmlFile) {
        alert("Invalid DJI KMZ: Could not find template.kml or waylines.wpml");
        return;
    }

    const kmlText = await kmlFile.async("text");
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(kmlText, "text/xml");

    // Extract Waypoints
    const placemarks = xmlDoc.getElementsByTagName("Placemark");
    const importedWaypoints = [];
    let avgAlt = 0;

    for (let i = 0; i < placemarks.length; i++) {
        const coords = placemarks[i].getElementsByTagName("coordinates")[0].textContent.split(",");
        const alt = parseFloat(placemarks[i].getElementsByTagName("wpml:height")[0]?.textContent || 0);
        const action = placemarks[i].getElementsByTagName("wpml:actionType")[0]?.textContent || 'none';
        
        importedWaypoints.push({
            lng: parseFloat(coords[0]),
            lat: parseFloat(coords[1]),
            alt: alt,
            action: action === 'takePhoto' ? 'take_photo' : 'none',
            label: action === 'takePhoto' ? 'Imported Photo' : 'Imported Waypoint'
        });
        avgAlt += alt;
    }

    if (importedWaypoints.length > 0) {
        waypoints = importedWaypoints;
        map.setView([waypoints[0].lat, waypoints[0].lng], 18);
        renderWaypoints(0, (avgAlt / waypoints.length).toFixed(1));
        alert(`Imported ${waypoints.length} waypoints successfully.`);
    }
};

window.onload = initMap;
