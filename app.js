// Debugging Utility
const Debug = {
    log: (module, message, data = null) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] [${module}] ${message}`, data || '');
    },
    error: (module, message, err) => {
        console.error(`[ERROR] [${module}] ${message}`, err);
    }
};

// DJI Mini 4 Pro Camera Specs
const SENSOR_WIDTH = 9.6; // mm
const PIXEL_SIZE = 0.0012; // mm (1.2 micrometer)
const IMAGE_WIDTH = 8000; // px (approx for 9.6mm / 1.2um)
const IMAGE_HEIGHT = 4500; // px (16:9 ratio)
const SENSOR_HEIGHT = IMAGE_HEIGHT * PIXEL_SIZE; // mm

const DJI_INTERVALS = [2, 3, 5, 7, 10, 15, 20, 30, 60];

// Polyfill for deprecated Leaflet API
if (!L.LineUtil.isFlat) {
    L.LineUtil.isFlat = function(latlngs) {
        return !Array.isArray(latlngs[0]) || 
               (typeof latlngs[0][0] !== 'object');
    };
}

let map, drawnItems, polygonLayer, centerMarker, activeDrawHandler;
let osmLayer, satelliteLayer, topoLayer, esriTopoLayer;
let flightLines = [];
let waypoints = [];
let currentTab = 'mapping';

// Edit mode state tracking
let polygonEditHandler = null;
let editCheckInterval = null;
let lastEditCoords = null;
let isEditingForPreview = false; // Skip terrain analysis during live edits

// UI State Management
function headerCreateFlight() {
    const sidebar = document.getElementById('sidebar');
    sidebar.style.display = 'flex';
    showModeSelection();
}

// Polygon Drawing Logic
function startPolygonDraw() {
    if (activeDrawHandler) activeDrawHandler.disable();
    
    activeDrawHandler = new L.Draw.Polygon(map, {
        shapeOptions: {
            color: '#3498db',
            fillOpacity: 0.2
        }
    });
    activeDrawHandler.enable();
    
    updateDrawButtons(true);
}

function startPolygonEdit() {
    Debug.log('Draw', '=== EDIT MODE START ===');
    Debug.log('Draw', 'startPolygonEdit called');
    
    if (!polygonLayer) {
        Debug.error('Draw', 'Cannot edit: polygonLayer is null');
        return;
    }
    
    // Disable any existing handler first
    if (polygonEditHandler) {
        Debug.log('Draw', 'Disabling existing polygonEditHandler');
        try {
            polygonEditHandler.disable();
        } catch (e) {
            Debug.error('Draw', 'Error disabling old handler', e);
        }
        polygonEditHandler = null;
    }
    
    if (activeDrawHandler) {
        Debug.log('Draw', 'Disabling existing activeDrawHandler');
        try {
            activeDrawHandler.disable();
        } catch (e) {
            Debug.error('Draw', 'Error disabling draw handler', e);
        }
        activeDrawHandler = null;
    }
    
    // Get current coordinates
    let coords = polygonLayer.getLatLngs();
    Debug.log('Draw', `Raw coords length: ${coords.length}, structure:`, coords);
    
    // Analyze the nested structure
    if (coords.length > 0) {
        Debug.log('Draw', `coords[0] type: ${typeof coords[0]}, is array: ${Array.isArray(coords[0])}`);
        if (Array.isArray(coords[0])) {
            Debug.log('Draw', `coords[0].length: ${coords[0].length}`);
            if (coords[0].length > 0) {
                Debug.log('Draw', `coords[0][0]: ${JSON.stringify(coords[0][0])}`);
            }
        }
    }
    
    // Handle nested coordinate structure
    if (Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
        Debug.log('Draw', '⚠️ Multi-polygon detected (nested arrays), using coords[0][0]');
        coords = coords[0][0];
    } else if (Array.isArray(coords[0]) && coords[0][0] && typeof coords[0][0].lat === 'number') {
        Debug.log('Draw', '⚠️ Multi-ring polygon detected, using coords[0]');
        coords = coords[0];
    } else {
        Debug.log('Draw', '✓ Simple polygon detected, using coords as-is');
    }
    
    // Final validation
    Debug.log('Draw', `Final coords to use - length: ${coords.length}, type: ${typeof coords}`);
    if (!Array.isArray(coords)) {
        Debug.error('Draw', 'ERROR: Final coords is not an array!', typeof coords);
        return;
    }
    if (coords.length < 3) {
        Debug.error('Draw', `ERROR: Not enough points (${coords.length} < 3)`);
        return;
    }
    
    // Validate coordinate format
    const firstCoord = coords[0];
    Debug.log('Draw', `First coordinate: ${JSON.stringify(firstCoord)}`);
    if (!firstCoord.lat || !firstCoord.lng) {
        Debug.error('Draw', 'ERROR: Coordinates missing lat/lng properties', firstCoord);
        return;
    }
    
    try {
        // Update polygon with normalized coordinates
        const oldCoords = JSON.stringify(polygonLayer.getLatLngs());
        const newCoords = JSON.stringify(coords);
        
        if (oldCoords !== newCoords) {
            Debug.log('Draw', 'Updating polygon coordinates');
            polygonLayer.setLatLngs(coords);
            Debug.log('Draw', 'Coordinates updated successfully');
        } else {
            Debug.log('Draw', 'Coordinates already normalized, no update needed');
        }
        
        Debug.log('Draw', 'Creating EditToolbar with drawnItems:', drawnItems ? 'present' : 'MISSING');
        Debug.log('Draw', 'drawnItems layer count:', drawnItems ? drawnItems.getLayers().length : 'N/A');
        
        polygonEditHandler = new L.EditToolbar.Edit(map, {
            featureGroup: drawnItems,
            selectedPathOptions: {
                dashArray: '10, 10',
                fill: true,
                fillColor: '#fe57a1',
                fillOpacity: 0.1,
                maintainColor: false
            }
        });
        
        Debug.log('Draw', 'EditToolbar created, enabling...');
        polygonEditHandler.enable();
        
        // Start polling for live coordinate changes during edit
        lastEditCoords = JSON.stringify(polygonLayer.getLatLngs());
        isEditingForPreview = true;
        
        // Stop any existing interval
        if (editCheckInterval) {
            clearInterval(editCheckInterval);
            editCheckInterval = null;
        }
        
        // Poll every 200ms to detect coordinate changes during vertex drag
        editCheckInterval = setInterval(function() {
            if (!polygonEditHandler) {
                // Edit mode ended, stop polling
                clearInterval(editCheckInterval);
                editCheckInterval = null;
                isEditingForPreview = false;
                return;
            }
            
            const currentCoords = JSON.stringify(polygonLayer.getLatLngs());
            if (currentCoords !== lastEditCoords) {
                Debug.log('Draw', '→ Vertex moved, regenerating flight plan LIVE (terrain analysis skipped)');
                updateFlightPlan();
                lastEditCoords = currentCoords;
            }
        }, 200);
        
        Debug.log('Draw', '✓✓✓ EditToolbar handler enabled successfully');
        updateDrawButtons(false, true);
        
    } catch (e) {
        Debug.error('Draw', 'FAILED to enable EditToolbar', e);
        Debug.error('Draw', 'Stack trace:', e.stack);
        polygonEditHandler = null;
        alert('Bearbeitungsmodus konnte nicht aktiviert werden: ' + e.message);
        updateDrawButtons(false, false);
    }
}

function finishPolygonDraw() {
    console.log('*** finishPolygonDraw ENTRY POINT ***');
    Debug.log('Draw', '========== FINISH POLYGON BUTTON PRESSED ==========');
    Debug.log('Draw', `polygonEditHandler exists: ${!!polygonEditHandler}`);
    Debug.log('Draw', `activeDrawHandler exists: ${!!activeDrawHandler}`);
    
    // Stop edit polling if running
    if (editCheckInterval) {
        clearInterval(editCheckInterval);
        editCheckInterval = null;
        Debug.log('Draw', 'Edit polling stopped');
    }
    
    // Case 1: Finishing an EDIT session
    if (polygonEditHandler) {
        Debug.log('Draw', '→ Case 1: Finishing EDIT - disabling handler');
        try {
            Debug.log('Draw', `Before disable - polygonEditHandler type: ${typeof polygonEditHandler}, has disable: ${typeof polygonEditHandler.disable}`);
            polygonEditHandler.disable();
            Debug.log('Draw', 'polygonEditHandler.disable() called successfully');
            
            polygonEditHandler = null;
            Debug.log('Draw', 'polygonEditHandler set to null');
            
            // Re-enable terrain analysis
            isEditingForPreview = false;
            Debug.log('Draw', 'isEditingForPreview set to false');
            
            Debug.log('Draw', 'Calling updateFlightPlan with terrain analysis...');
            updateFlightPlan();
            Debug.log('Draw', 'updateFlightPlan completed');
            
            Debug.log('Draw', 'Calling normalizePolygon...');
            normalizePolygon();
            Debug.log('Draw', 'normalizePolygon completed');
            
            Debug.log('Draw', 'Calling updateDrawButtons(false, false)...');
            updateDrawButtons(false, false);
            Debug.log('Draw', '✓ EDIT session finished successfully');
            return;
        } catch (e) {
            Debug.error('Draw', 'Error in EDIT finish', e);
            Debug.error('Draw', 'Stack:', e.stack);
            polygonEditHandler = null;
        }
    }
    
    // Case 2: Finishing a NEW drawing
    if (activeDrawHandler && typeof activeDrawHandler.completeShape === 'function') {
        Debug.log('Draw', '→ Case 2: Finishing NEW drawing');
        try {
            activeDrawHandler.completeShape();
            activeDrawHandler.disable();
            activeDrawHandler = null;
        } catch (e) {
            Debug.error('Draw', 'Error in completeShape', e);
            activeDrawHandler = null;
        }
        updateDrawButtons(false);
        return;
    }

    Debug.log('Draw', '⚠️ No active handler found in finishPolygonDraw');
    updateDrawButtons(false);
}

function cancelPolygonDraw() {
    Debug.log('Draw', 'cancelPolygonDraw called');
    
    // Stop edit polling if running
    if (editCheckInterval) {
        clearInterval(editCheckInterval);
        editCheckInterval = null;
        Debug.log('Draw', 'Edit polling stopped');
    }
    
    // Case 1: Cancel an EDIT session (revert changes but keep polygon)
    if (polygonEditHandler) {
        Debug.log('Draw', '→ Canceling EDIT mode - reverting changes');
        try {
            polygonEditHandler.revertLayers();
            polygonEditHandler.disable();
            polygonEditHandler = null;
            Debug.log('Draw', '✓ Edit changes reverted, polygon intact');
            // Re-enable terrain analysis for final calculation
            isEditingForPreview = false;
            // Regenerate flight plan with original polygon - WITH terrain
            updateFlightPlan();
        } catch (e) {
            Debug.error('Draw', 'Error reverting edit', e);
            polygonEditHandler = null;
        }
        updateDrawButtons(false);
        return;
    }
    
    // Case 2: Cancel a NEW drawing (abort drawing, polygon doesn't exist yet)
    if (activeDrawHandler) {
        Debug.log('Draw', '→ Canceling DRAW mode - aborting new polygon');
        try {
            activeDrawHandler.disable();
            activeDrawHandler = null;
            Debug.log('Draw', '✓ Drawing cancelled');
        } catch (e) {
            Debug.error('Draw', 'Error canceling draw', e);
            activeDrawHandler = null;
        }
    }
    
    updateDrawButtons(false);
}

function updateDrawButtons(isDrawing, isEditing = false) {
    const hasPolygon = !!polygonLayer;
    const btnDraw = document.getElementById('btn-draw-poly');
    const btnEdit = document.getElementById('btn-edit-poly');
    const btnDeleteLast = document.getElementById('btn-delete-last');
    const btnDone = document.getElementById('btn-done-draw');
    const btnCancel = document.getElementById('btn-cancel-draw');
    const btnDelete = document.getElementById('btn-delete-poly');

    // Log button existence
    Debug.log('UI', `Button check - Delete exists: ${!!btnDelete}, Edit: ${!!btnEdit}, Done: ${!!btnDone}`);

    if (btnDraw) btnDraw.disabled = isDrawing || isEditing;
    if (btnEdit) btnEdit.disabled = isDrawing || isEditing || !hasPolygon;
    if (btnDeleteLast) btnDeleteLast.disabled = !isDrawing || isEditing;
    if (btnDone) btnDone.disabled = !(isDrawing || isEditing);
    if (btnCancel) btnCancel.disabled = !(isDrawing || isEditing);
    if (btnDelete) {
        const deleteDisabled = isDrawing || isEditing || !hasPolygon;
        btnDelete.disabled = deleteDisabled;
        Debug.log('UI', `DELETE Button state: disabled=${deleteDisabled}, isDrawing=${isDrawing}, isEditing=${isEditing}, hasPolygon=${hasPolygon}`);
    } else {
        Debug.log('UI', '⚠️ DELETE Button element not found in DOM!');
    }
    
    Debug.log('UI', `DrawButtons updated: Draw=${btnDraw?.disabled}, Edit=${btnEdit?.disabled}, DeleteLast=${btnDeleteLast?.disabled}, Done=${btnDone?.disabled}, Cancel=${btnCancel?.disabled}, Delete=${btnDelete?.disabled}`);
}

function normalizePolygon() {
    // Restore polygon to normal blue color after edit is finalized
    if (polygonLayer) {
        polygonLayer.setStyle({
            color: '#3498db',
            fillOpacity: 0.2,
            weight: 2,
            dashArray: null // Remove dashed style from edit mode
        });
        Debug.log('Draw', 'Polygon normalized to blue');
    }
}

function deletePolygon() {
    Debug.log('Draw', 'deletePolygon called');
    
    // Stop edit polling if running
    if (editCheckInterval) {
        clearInterval(editCheckInterval);
        editCheckInterval = null;
        Debug.log('Draw', 'Edit polling stopped');
    }
    
    // Re-enable terrain analysis
    isEditingForPreview = false;
    
    if (!polygonLayer) {
        Debug.log('Draw', 'No polygon to delete');
        return;
    }
    
    try {
        // Remove polygon and all associated elements
        Debug.log('Draw', 'Removing polygon from map');
        drawnItems.removeLayer(polygonLayer);
        polygonLayer = null;
        
        // Clear waypoints
        Debug.log('Draw', 'Clearing waypoints');
        waypoints = [];
        
        // Remove flight lines from map
        Debug.log('Draw', 'Removing flight lines');
        flightLines.forEach(line => {
            map.removeLayer(line);
        });
        flightLines = [];
        
        // Update UI
        Debug.log('Draw', 'Updating UI elements');
        updateFlightPlan();
        updateDrawButtons(false);
        
        Debug.log('Draw', '✓✓✓ Polygon deleted completely');
        
    } catch (e) {
        Debug.error('Draw', 'Error deleting polygon', e);
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.style.display = sidebar.style.display === 'flex' ? 'none' : 'flex';
}

function deleteLastPoint() {
    if (activeDrawHandler && activeDrawHandler.deleteLastVertex) {
        activeDrawHandler.deleteLastVertex();
    }
}



function toggleRightPanel() {
    const panel = document.getElementById('right-panel');
    const toggle = document.getElementById('panel-toggle');
    const isCollapsed = panel.classList.toggle('collapsed');
    toggle.innerText = isCollapsed ? '◀' : '▶';
    if (map) map.invalidateSize();
}

// Resize Logic
let isResizing = false;
function initResizer() {
    const resizer = document.getElementById('panel-resizer');
    const panel = document.getElementById('right-panel');
    
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const container = document.getElementById('main-container');
        const containerRect = container.getBoundingClientRect();
        const newWidth = containerRect.right - e.clientX;
        
        if (newWidth > 200 && newWidth < 600) {
            panel.style.width = `${newWidth}px`;
            if (map) map.invalidateSize();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
        }
    });
}

function toggleCameraModal() {
    const modal = document.getElementById('camera-modal');
    const overlay = document.getElementById('modal-overlay');
    const isVisible = modal.style.display === 'block';
    modal.style.display = isVisible ? 'none' : 'block';
    overlay.style.display = isVisible ? 'none' : 'block';
}

function startSetup(mode) {
    document.getElementById('mode-selection').style.display = 'none';
    document.getElementById('back-to-modes').style.display = 'flex';
    document.getElementById('new-flight-label').style.display = 'none';
    
    if (mode === 'mapping') {
        document.getElementById('mapping-setup').style.display = 'block';
        document.getElementById('inspection-setup').style.display = 'none';
        switchTab('mapping');
    } else if (mode === 'inspection') {
        document.getElementById('mapping-setup').style.display = 'none';
        document.getElementById('inspection-setup').style.display = 'block';
        switchTab('inspection');
    }
}

function showModeSelection() {
    document.getElementById('mode-selection').style.display = 'flex';
    document.getElementById('back-to-modes').style.display = 'none';
    document.getElementById('new-flight-label').style.display = 'block';
    document.getElementById('mapping-setup').style.display = 'none';
    document.getElementById('inspection-setup').style.display = 'none';
}

function setBaseLayer(type) {
    const buttons = {
        'osm': document.getElementById('btn-osm'),
        'satellite': document.getElementById('btn-satellite'),
        'topo': document.getElementById('btn-topo'),
        'esri-topo': document.getElementById('btn-esri-topo')
    };

    // Remove all layers
    map.removeLayer(osmLayer);
    map.removeLayer(satelliteLayer);
    map.removeLayer(topoLayer);
    map.removeLayer(esriTopoLayer);

    // Reset button styles
    Object.values(buttons).forEach(btn => {
        if (buttons) {
            btn.style.background = 'transparent';
            btn.style.color = '#aaa';
        }
    });

    // Add selected layer and highlight button
    if (type === 'osm') {
        map.addLayer(osmLayer);
        buttons['osm'].style.background = '#444';
        buttons['osm'].style.color = 'white';
    } else if (type === 'satellite') {
        map.addLayer(satelliteLayer);
        buttons['satellite'].style.background = '#444';
        buttons['satellite'].style.color = 'white';
    } else if (type === 'topo') {
        map.addLayer(topoLayer);
        buttons['topo'].style.background = '#444';
        buttons['topo'].style.color = 'white';
    } else if (type === 'esri-topo') {
        map.addLayer(esriTopoLayer);
        buttons['esri-topo'].style.background = '#444';
        buttons['esri-topo'].style.color = 'white';
    }
}

function switchTab(tab) {
    currentTab = tab;
    // Update draw controls based on tab
    if (tab === 'inspection') {
        // In inspection mode, we want a single point
        if (window.drawControl) map.removeControl(window.drawControl);
        window.drawControl = new L.Control.Draw({
            position: 'topright',
            draw: { marker: true, polygon: false, polyline: false, rectangle: false, circle: false, circlemarker: false }
        });
        map.addControl(window.drawControl);
    } else {
        if (window.drawControl) map.removeControl(window.drawControl);
        window.drawControl = new L.Control.Draw({
            position: 'topright',
            draw: { polygon: true, marker: false, polyline: false, rectangle: false, circle: false, circlemarker: false }
        });
        map.addControl(window.drawControl);
    }
}

// Initialize Map
function initMap() {
    console.log("Initializing Map...");
    map = L.map('map', {
        maxZoom: 22,
        zoomControl: false
    }).setView([48.7758, 9.1829], 13);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 22,
        maxNativeZoom: 19,
        attribution: 'Tiles &copy; Esri'
    });

    topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
    });

    esriTopoLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
    });

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    // Initial draw control (mapping)
    switchTab('mapping');

    map.on(L.Draw.Event.CREATED, function (event) {
        Debug.log('Draw', 'Event CREATED triggered', event.layerType);
        drawnItems.clearLayers();
        if (currentTab === 'mapping') {
            polygonLayer = event.layer;
            drawnItems.addLayer(polygonLayer);
            Debug.log('Draw', 'polygonLayer assigned', polygonLayer);
            updateFlightPlan();
        } else {
            centerMarker = event.layer;
            drawnItems.addLayer(centerMarker);
            generateInspectionPlan();
        }
        
        // Force update buttons and ensure EDIT is enabled if we have a polygon
        setTimeout(() => {
            updateDrawButtons(false, false);
            const btnEdit = document.getElementById('btn-edit-poly');
            if (polygonLayer && btnEdit) {
                btnEdit.disabled = false;
                Debug.log('UI', 'Manually enabled EDIT button');
            }
        }, 200);
    });

    // Search functionality
    document.getElementById('search-btn').onclick = searchLocation;

    // GSD / Height Bidirectional Logic
    const gsdInput = document.getElementById('gsd-input');
    const heightInput = document.getElementById('height');
    const focalSelect = document.getElementById('focalLength');

    function updateGSD() {
        const h = parseFloat(heightInput.value);
        const f = parseFloat(focalSelect.value);
        // GSD [cm/px] = (H [m] * S_width [mm] * 100) / (F [mm] * Img_width [px])
        const gsd = (h * SENSOR_WIDTH * 100) / (f * IMAGE_WIDTH);
        gsdInput.value = gsd.toFixed(2);
        updateInterval();
        updateFlightPlan();
    }

    function updateHeight() {
        const gsd = parseFloat(gsdInput.value);
        const f = parseFloat(focalSelect.value);
        // H [m] = (GSD [cm/px] * F [mm] * Img_width [px]) / (S_width [mm] * 100)
        const h = (gsd * f * IMAGE_WIDTH) / (SENSOR_WIDTH * 100);
        heightInput.value = Math.round(h);
        updateInterval();
        updateFlightPlan();
    }

    function updateInterval() {
        const h = parseFloat(heightInput.value);
        const speed = parseFloat(document.getElementById('speed').value);
        const overlap = parseFloat(document.getElementById('frontOverlap').value);
        const f = parseFloat(focalSelect.value);

        // Footprint Height [m] = (H [m] * S_height [mm]) / F [mm]
        const footprintHeight = (h * SENSOR_HEIGHT) / f;
        // Distance between photos [m] = FootprintHeight * (1 - Overlap/100)
        const distBetweenPhotos = footprintHeight * (1 - (overlap / 100));
        // Interval [s] = Distance / Speed
        const interval = distBetweenPhotos / speed;

        const display = document.getElementById('capture-interval-display');
        display.innerText = interval.toFixed(1) + 's';
        
        display.className = 'info-val';
        if (interval < 3) display.classList.add('interval-red');
        else if (interval <= 5) display.classList.add('interval-orange');
        else display.classList.add('interval-green');
    }

    heightInput.oninput = updateGSD;
    gsdInput.oninput = updateHeight;
    focalSelect.onchange = updateGSD;
    document.getElementById('speed').oninput = updateInterval;
    document.getElementById('frontOverlap').oninput = updateInterval;

    // Trigger mode change listener
    document.getElementById('triggerMode').onchange = function() {
        updateFlightPlan();
    };
    
    // Initial calculation
    updateGSD();
    initResizer();
    
    // Initialize UI state
    showModeSelection();
}

async function generateInspectionPlan() {
    if (!centerMarker) return;
    const center = centerMarker.getLatLng();
    const objRadius = parseFloat(document.getElementById('objRadius').value);
    const objDistance = parseFloat(document.getElementById('objDistance').value);
    const objHeight = parseFloat(document.getElementById('objHeight').value);
    const segments = parseInt(document.getElementById('objSegments').value);
    const levels = parseInt(document.getElementById('objLevels').value);
    const cameraPitch = parseFloat(document.getElementById('objCameraAngle').value);
    
    const flightRadius = objRadius + objDistance;
    const waypointsList = [];
    
    // Fetch terrain height for center
    const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${center.lat},${center.lng}`);
    const data = await response.json();
    const terrainAlt = data.results[0].elevation;

    for (let l = 1; l <= levels; l++) {
        const levelHeight = (objHeight / levels) * l;
        const absAlt = terrainAlt + levelHeight;
        
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            const dx = flightRadius * Math.cos(angle);
            const dy = flightRadius * Math.sin(angle);
            
            // Convert meters to lat/lng (approximate)
            const lat = center.lat + (dy / 111320);
            const lng = center.lng + (dx / (111320 * Math.cos(center.lat * Math.PI / 180)));
            
            // Calculate heading towards center
            const heading = (angle * 180 / Math.PI + 180) % 360;
            
            waypointsList.push({
                lat: lat,
                lng: lng,
                alt: absAlt,
                heading: heading,
                pitch: cameraPitch,
                action: 'take_photo',
                label: `Level ${l} - Shot ${i+1}`
            });
        }
    }
    
    waypoints = waypointsList;
    renderWaypoints(0, (objHeight/levels).toFixed(1));
    update3DPreview(levels, objHeight, objRadius, flightRadius, segments, cameraPitch);
    document.getElementById('exportInspBtn').disabled = false;
}

function update3DPreview(levels, totalHeight, objRadius, flightRadius, segments, cameraPitch) {
    const preview = document.getElementById('preview-3d');
    preview.style.display = 'block';
    preview.innerHTML = '';
    
    const scale = 100 / flightRadius; // Scale to fit preview
    
    // Draw Cylinder (Object)
    const cylinder = document.createElement('div');
    cylinder.className = 'cylinder-3d';
    const cylSize = objRadius * 2 * scale;
    cylinder.style.width = `${cylSize}px`;
    cylinder.style.height = `${cylSize}px`;
    cylinder.style.left = `${(250 - cylSize) / 2}px`;
    cylinder.style.top = `${(250 - cylSize) / 2}px`;
    cylinder.style.borderRadius = '50%';
    cylinder.style.transform = `rotateX(70deg) translateZ(0px)`;
    cylinder.style.height = `${totalHeight * scale}px`; // Use height for Z-axis
    cylinder.style.background = 'linear-gradient(to bottom, rgba(255,0,0,0.1), rgba(255,0,0,0.3))';
    preview.appendChild(cylinder);

    for (let l = 1; l <= levels; l++) {
        const ring = document.createElement('div');
        ring.className = 'ring-3d';
        const ringSize = flightRadius * 2 * scale;
        const zPos = (l / levels) * 100;
        
        ring.style.width = `${ringSize}px`;
        ring.style.height = `${ringSize}px`;
        ring.style.left = `${(250 - ringSize) / 2}px`;
        ring.style.top = `${(250 - ringSize) / 2}px`;
        ring.style.transform = `rotateX(70deg) translateZ(${zPos}px)`;
        
        // Add Waypoint Pyramids
        for (let s = 0; s < segments; s++) {
            const pyramid = document.createElement('div');
            pyramid.className = 'pyramid-3d';
            const angle = (s / segments) * 2 * Math.PI;
            const dx = (ringSize / 2) + (ringSize / 2) * Math.cos(angle);
            const dy = (ringSize / 2) + (ringSize / 2) * Math.sin(angle);
            
            pyramid.style.left = `${dx}px`;
            pyramid.style.top = `${dy}px`;
            
            // Rotate pyramid to face center and apply pitch
            const headingAngle = (angle * 180 / Math.PI) + 90;
            pyramid.style.transform = `rotate(${headingAngle}deg) rotateX(${cameraPitch}deg)`;
            
            ring.appendChild(pyramid);
        }
        
        preview.appendChild(ring);
    }
}

document.getElementById('exportInspBtn').onclick = async () => {
    const zip = new JSZip();
    const wpmz = zip.folder("wpmz");
    
    const format = document.getElementById('inspImageFormat').value;
    const iso = document.getElementById('inspIso').value;
    const shutter = document.getElementById('inspShutterSpeed').value;

    // Generate template.kml for Inspection
    const templateKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:author>DJI Flight Planner</wpml:author>
    <wpml:createTime>${Date.now()}</wpml:createTime>
    <wpml:updateTime>${Date.now()}</wpml:updateTime>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goHome</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>5</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>68</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
      </wpml:droneInfo>
    </wpml:missionConfig>
  </Document>
</kml>`;

    const waylinesWpml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goHome</wpml:executeRCLostAction>
      <wpml:globalTransitionalSpeed>5</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>68</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
      </wpml:droneInfo>
    </wpml:missionConfig>
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:autoFlightSpeed>3</wpml:autoFlightSpeed>
      ${waypoints.map((wp, i) => `
      <Placemark>
        <Point>
          <coordinates>${wp.lng},${wp.lat}</coordinates>
        </Point>
        <wpml:index>${i}</wpml:index>
        <wpml:executeHeight>${(wp.alt - terrainAlt).toFixed(2)}</wpml:executeHeight>
        <wpml:waypointSpeed>3</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${wp.heading.toFixed(1)}</wpml:waypointHeadingAngle>
          <wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable>
          <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>toPointAndStopWithContinuityCurvature</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
        <wpml:actionGroup>
          <wpml:actionGroupId>${i}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${i}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>
          <wpml:action>
            <wpml:actionId>0</wpml:actionId>
            <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:gimbalHeadingYawBase>aircraft</wpml:gimbalHeadingYawBase>
              <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>
              <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
              <wpml:gimbalPitchRotateAngle>${wp.pitch}</wpml:gimbalPitchRotateAngle>
              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            </wpml:actionActuatorFuncParam>
          </wpml:action>
          <wpml:action>
            <wpml:actionId>1</wpml:actionId>
            <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
          </wpml:action>
        </wpml:actionGroup>
      </Placemark>`).join('')}
    </Folder>
  </Document>
</kml>`;

    wpmz.file("template.kml", templateKml);
    wpmz.file("waylines.wpml", waylinesWpml);

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = "inspection_mission.kmz";
    link.click();
};

document.getElementById('generateInspBtn').onclick = generateInspectionPlan;

async function analyzeTerrain(polygon) {
    // Skip terrain analysis during live-edit preview to avoid API rate limiting
    if (isEditingForPreview) {
        Debug.log('Terrain', 'Skipping terrain analysis during live edit preview');
        return { minElev: 0, maxElev: 0 }; // Return default values
    }
    
    Debug.log('Terrain', 'Starting terrain analysis grid (25x25)');
    const bbox = turf.bbox(polygon);
    const gridPoints = [];
    const steps = 25;
    
    const xStep = (bbox[2] - bbox[0]) / steps;
    const yStep = (bbox[3] - bbox[1]) / steps;

    for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps; j++) {
            const pt = [bbox[0] + i * xStep, bbox[1] + j * yStep];
            if (turf.booleanPointInPolygon(pt, polygon)) {
                gridPoints.push(pt);
            }
        }
    }

    if (gridPoints.length === 0) return;

    let minH = Infinity;
    let maxH = -Infinity;
    
    // Fetch in smaller chunks of 40 to avoid URL length limits and CORS issues
    for (let i = 0; i < gridPoints.length; i += 40) {
        const chunk = gridPoints.slice(i, i + 40);
        const coords = chunk.map(p => `${p[1]},${p[0]}`).join('|');
        
        // Add a small delay between batches to respect API rate limits
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 300));

        try {
            const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${coords}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            if (data && data.results) {
                data.results.forEach(r => {
                    if (r.elevation < minH) minH = r.elevation;
                    if (r.elevation > maxH) maxH = r.elevation;
                });
            }
        } catch (e) { 
            Debug.error('Terrain', `Grid fetch failed at index ${i}. API might be busy.`, e); 
        }
    }

    const minDisplay = document.getElementById('stat-terrain-min');
    const maxDisplay = document.getElementById('stat-terrain-max');
    if (minDisplay && minH !== Infinity) minDisplay.innerText = minH.toFixed(1) + " m";
    if (maxDisplay && maxH !== -Infinity) maxDisplay.innerText = maxH.toFixed(1) + " m";
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

    // Update capture interval display in sidebar
    const intervalDisplay = document.getElementById('capture-interval-display');
    if (intervalDisplay) {
        intervalDisplay.innerText = interval.toFixed(1) + 's';
        intervalDisplay.className = 'info-val';
        if (interval < 3) intervalDisplay.classList.add('interval-red');
        else if (interval <= 5) intervalDisplay.classList.add('interval-orange');
        else intervalDisplay.classList.add('interval-green');
    }

    // Angle for grid generation should be perpendicular to flight direction
    // If direction=0° (North), strips should run East-West, so angle=90°
    // If direction=90° (East), strips should run North-South, so angle=0°
    const gridRunAngle = (direction + 90) % 360;
    
    generateGrid(polygonLayer.toGeoJSON(), stripSpacing, photoSpacing, gridRunAngle, interval, speed, height, triggerMode);
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
            label: wp.label,
            heading: (angle + 90) % 360
        };
    });

    renderWaypoints(interval, height);
}

function renderWaypoints(interval, height) {
    Debug.log('UI', `Rendering ${waypoints.length} waypoints`);
    
    // Update Project Details
    const wpCountDisplay = document.getElementById('stat-waypoint-count');
    if (wpCountDisplay) {
        wpCountDisplay.innerText = `${waypoints.length} / 200`;
        if (waypoints.length > 200) {
            wpCountDisplay.classList.add('warning-text');
            alert("Warning: DJI Mini 4 Pro supports a maximum of 200 waypoints. Your current plan has " + waypoints.length + " waypoints.");
        } else {
            wpCountDisplay.classList.remove('warning-text');
        }
    }

    if (polygonLayer) {
        const area = turf.area(polygonLayer.toGeoJSON());
        const areaDisplay = document.getElementById('stat-area-size');
        if (areaDisplay) areaDisplay.innerText = area.toFixed(0) + " m²";
        
        if (document.getElementById('terrainFollow')?.checked) {
            analyzeTerrain(polygonLayer.toGeoJSON());
        }
    }

    if (window.flightPathLayer) map.removeLayer(window.flightPathLayer);
    if (window.markerLayer) map.removeLayer(window.markerLayer);
    
    // Show right panel when waypoints are generated
    const rightPanelContainer = document.getElementById('right-panel-container');
    const rightPanel = document.getElementById('right-panel');
    if (rightPanelContainer) rightPanelContainer.style.display = 'flex';
    if (rightPanel) rightPanel.classList.remove('collapsed');
    
    window.markerLayer = L.layerGroup().addTo(map);
    const latlngs = waypoints.map((wp, i) => {
        // First waypoint is purple (start), others are green (action) or blue (none)
        let markerColor;
        if (i === 0) {
            markerColor = '#9b59b6'; // Purple - flight start
        } else {
            markerColor = wp.action !== 'none' ? '#28a745' : '#007bff'; // Green or blue
        }
        
        const marker = L.circleMarker([wp.lat, wp.lng], {
            radius: 6, // Slightly larger for better clicking
            color: markerColor,
            fillColor: markerColor,
            fillOpacity: 0.6,
            weight: 2,
            interactive: true
        }).addTo(window.markerLayer);
        
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            Debug.log('UI', `Waypoint #${i} clicked`);
            
            const iso = document.getElementById('iso')?.value || 'AUTO';
            const shutter = document.getElementById('shutterSpeed')?.value || 'AUTO';
            const format = document.getElementById('imageFormat')?.value || 'JPEG';
            const wb = document.getElementById('whiteBalance')?.value || 'AUTO';
            const terrainFollow = document.getElementById('terrainFollow')?.checked || false;
            const cameraAngle = document.getElementById('cameraAngle')?.value || '-90';

            let detailsHtml = `
                <div style="background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); border-left: 4px solid ${wp.action !== 'none' ? '#28a745' : '#007bff'};">
                    <h3 style="margin: 0 0 10px 0; font-size: 1em;">Waypoint #${i}${i === 0 ? ' (START)' : ''}</h3>
                    <table style="width: 100%; font-size: 0.85em; border-collapse: collapse;">
                        <tr><td style="padding: 4px 0; color: #666;">Action:</td><td style="font-weight: bold;">${wp.label}</td></tr>
                        <tr><td style="padding: 4px 0; color: #666;">Lat:</td><td style="font-family: monospace;">${wp.lat.toFixed(6)}</td></tr>
                        <tr><td style="padding: 4px 0; color: #666;">Lng:</td><td style="font-family: monospace;">${wp.lng.toFixed(6)}</td></tr>
                        <tr><td style="padding: 4px 0; color: #666;">Height (AGL):</td><td style="font-weight: bold;">${height}m</td></tr>
                        ${terrainFollow && wp.terrainAlt ? `<tr><td style="padding: 4px 0; color: #666;">Terrain (AMSL):</td><td style="font-weight: bold; color: #28a745;">${wp.terrainAlt.toFixed(1)}m</td></tr>` : ''}
                        ${currentTab === 'inspection' ? `
                            <tr><td style="padding: 4px 0; color: #666;">Gimbal Pitch:</td><td style="font-weight: bold;">${wp.pitch}°</td></tr>
                            <tr><td style="padding: 4px 0; color: #666;">Heading:</td><td style="font-weight: bold;">${wp.heading.toFixed(1)}°</td></tr>
                        ` : `
                            <tr><td style="padding: 4px 0; color: #666;">Gimbal Pitch:</td><td style="font-weight: bold;">${cameraAngle}°</td></tr>
                        `}
                    </table>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
                    <div style="font-size: 0.8em; color: #888;">
                        <strong>Camera Settings:</strong><br>
                        ISO: ${iso} | Shutter: ${shutter}<br>
                        Format: ${format} | WB: ${wb}
                    </div>
                </div>
            `;
            document.getElementById('waypoint-info').innerHTML = detailsHtml;
        });

        return [wp.lat, wp.lng];
    });

    window.flightPathLayer = L.polyline(latlngs, { color: '#dc3545', weight: 3, dashArray: '5, 10' }).addTo(map);
    
    const exportBtn = document.getElementById('exportBtn');
    const exportInspBtn = document.getElementById('exportInspBtn');
    const canExport = waypoints.length > 0 && waypoints.length <= 200;
    
    if (exportBtn) exportBtn.disabled = !canExport;
    if (exportInspBtn) exportInspBtn.disabled = !canExport;
    
    Debug.log('UI', `Export buttons ${canExport ? 'enabled' : 'disabled'} (${waypoints.length} waypoints)`);
}

// Export Logic (KMZ)
async function exportKMZ() {
    const zip = new JSZip();
    const wpmz = zip.folder("wpmz");
    
    const height = parseFloat(document.getElementById('height').value);
    const speed = parseFloat(document.getElementById('speed').value);
    const cameraAngle = parseFloat(document.getElementById('cameraAngle').value);
    const triggerMode = document.getElementById('triggerMode').value;
    
    const terrainFollow = document.getElementById('terrainFollow').checked;
    
    // Fetch Elevation if needed
    let useAbsoluteHeight = false;
    if (terrainFollow) {
        const statsDiv = document.getElementById('stats');
        if (statsDiv) statsDiv.innerHTML += "<br><span style='color: blue;'>Fetching Terrain Data...</span>";
        
        let minAlt = Infinity;
        let maxAlt = -Infinity;

        // Split waypoints into smaller chunks of 40 for stability
        for (let i = 0; i < waypoints.length; i += 40) {
            const chunk = waypoints.slice(i, i + 40);
            const coords = chunk.map(wp => `${wp.lat},${wp.lng}`).join('|');
            
            // Add delay to prevent rate limiting
            if (i > 0) await new Promise(resolve => setTimeout(resolve, 300));

            try {
                const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${coords}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                data.results.forEach((r, idx) => {
                    if (waypoints[i + idx]) {
                        waypoints[i + idx].terrainAlt = r.elevation;
                        if (r.elevation < minAlt) minAlt = r.elevation;
                        if (r.elevation > maxAlt) maxAlt = r.elevation;
                    }
                });
            } catch (e) {
                Debug.error('Export', `Elevation fetch failed at index ${i}`, e);
            }
        }

        const terrainVariation = maxAlt - minAlt;
        const thresholdPercent = parseFloat(document.getElementById('terrainThreshold')?.value || 10);
        const thresholdMeters = height * (thresholdPercent / 100);

        if (terrainVariation > thresholdMeters) {
            useAbsoluteHeight = confirm(`Significant terrain variation detected: ${terrainVariation.toFixed(1)}m (>${thresholdPercent}% of flight height).\n\nDo you want to switch to ABSOLUTE altitude mode to maintain constant GSD? \n\nClick 'Cancel' to stay in RELATIVE mode.`);
        }
    }

    // Generate template.kml
    const templateKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:author>DJI Flight Planner</wpml:author>
    <wpml:createTime>${Date.now()}</wpml:createTime>
    <wpml:updateTime>${Date.now()}</wpml:updateTime>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goHome</wpml:executeRCLostAction>
      <wpml:takeOffSecurityHeight>20</wpml:takeOffSecurityHeight>
      <wpml:globalTransitionalSpeed>${speed}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>68</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
      </wpml:droneInfo>
    </wpml:missionConfig>
  </Document>
</kml>`;

    const waylinesWpml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goHome</wpml:executeRCLostAction>
      <wpml:globalTransitionalSpeed>${speed}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>68</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
      </wpml:droneInfo>
    </wpml:missionConfig>
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>${useAbsoluteHeight ? 'absolute' : 'relativeToStartPoint'}</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:autoFlightSpeed>${speed}</wpml:autoFlightSpeed>
      ${waypoints.map((wp, i) => {
        const execHeight = useAbsoluteHeight ? (wp.terrainAlt + height) : height;
        return `
      <Placemark>
        <Point>
          <coordinates>${wp.lng},${wp.lat}</coordinates>
        </Point>
        <wpml:index>${i}</wpml:index>
        <wpml:executeHeight>${execHeight.toFixed(2)}</wpml:executeHeight>
        <wpml:waypointSpeed>${speed}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>${currentTab === 'inspection' ? 'smoothTransition' : 'followWayline'}</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>${wp.heading?.toFixed(1) ?? 0}</wpml:waypointHeadingAngle>
          <wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable>
          <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>toPointAndStopWithContinuityCurvature</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
        <wpml:actionGroup>
          <wpml:actionGroupId>${i}</wpml:actionGroupId>
          <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
          <wpml:actionGroupEndIndex>${i}</wpml:actionGroupEndIndex>
          <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
          <wpml:actionTrigger>
            <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
          </wpml:actionTrigger>
          <wpml:action>
            <wpml:actionId>0</wpml:actionId>
            <wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
              <wpml:gimbalHeadingYawBase>aircraft</wpml:gimbalHeadingYawBase>
              <wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>
              <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>
              <wpml:gimbalPitchRotateAngle>${currentTab === 'inspection' ? wp.pitch : cameraAngle}</wpml:gimbalPitchRotateAngle>
              <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            </wpml:actionActuatorFuncParam>
          </wpml:action>
          ${wp.action === 'take_photo' ? `
          <wpml:action>
            <wpml:actionId>1</wpml:actionId>
            <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
          </wpml:action>` : ''}
        </wpml:actionGroup>
      </Placemark>`;
      }).join('')}
    </Folder>
  </Document>
</kml>`;

    wpmz.file("template.kml", templateKml);
    wpmz.file("waylines.wpml", waylinesWpml);

    const content = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = currentTab === 'mapping' ? "mapping_mission.kmz" : "inspection_mission.kmz";
    link.click();
}

document.getElementById('exportBtn').onclick = exportKMZ;
document.getElementById('exportInspBtn').onclick = exportKMZ;
document.getElementById('generateBtn').onclick = updateFlightPlan;

// KMZ Import Logic
const importFileInput = document.getElementById('importFile');
if (importFileInput) {
    importFileInput.onchange = async (e) => {
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
}

window.onload = initMap;
