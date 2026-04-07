# Changelog

All notable changes to this project will be documented in this file.

## [2026-04-07] - Polygon Editing & Flight Direction Fixes

### Added
- **Polygon Drawing Toolbar**: New UI buttons for drawing workflow
  - DRAW: Activate polygon drawing mode
  - EDIT: Activate vertex editing mode with live-preview regeneration
  - DELETE LAST: Remove last vertex from active drawing
  - DONE: Finalize drawing or editing session
  - CANCEL: Abort active operation without saving
  - DELETE: Remove entire polygon and associated waypoints/flight paths
  
- **Live-Edit Polygon Regeneration** (200ms polling interval)
  - Real-time waypoint preview while dragging polygon vertices
  - Terrain analysis skipped during preview for performance (enabled after DONE)
  - Automatic coordinate change detection via JSON hash comparison
  
- **Purple Start Waypoint Indicator**
  - First waypoint displayed in purple (#9b59b6) to clearly mark flight start
  - Subsequent waypoints: green for photo actions, blue for navigation
  - Waypoint popup includes "(START)" label for first waypoint
  
- **Configurable Terrain Threshold**
  - User can adjust terrain variation threshold (default 10%)
  - Automatically selects `relativeToStartPoint` for flat terrain or `absolute` (AMSL) for hilly areas
  
- **Enhanced Documentation**
  - Updated architecture.md with polygon editing workflow details
  - Added code safety practices and defensive checks section
  - Documented known issues and resolutions table
  - Updated README.md with detailed polygon editing guide
  - Enhanced troubleshooting section with fixes and lessons learned
  - Updated PRD.md with new features

### Fixed
- **Flight Direction Compass Conversion**
  - Fixed heading calculation: strips now orient correctly perpendicular to flight direction
  - Flight Direction (0-359°) uses DJI compass: 0° = North, 90° = East
  - Grid generation now uses perpendicular angle: `gridRunAngle = (direction + 90) % 360`
  - Heading export includes +90° conversion for DJI compass compatibility
  
- **Duplicate Function Definitions** (Critical)
  - Removed duplicate `finishPolygonDraw()` at line 440 (was overwriting correct version at line 208)
  - Removed duplicate `cancelPolygonDraw()` (was incomplete, missing edit handler logic)
  - Removed duplicate `updateDrawButtons()` (was missing DELETE button handling)
  - Only original single definitions at lines 42-320 now exist
  
- **Button State Management**
  - Centralized all button updates in single `updateDrawButtons(isDrawing, isEditing)` function
  - Prevents orphaned incomplete code and state inconsistencies
  - Added console logging for debugging state transitions
  
- **Edit Mode Handler Cleanup**
  - Edit handler properly disabled after DONE button
  - Terrain analysis re-enabled after edit finalization
  - Polygon color normalized to blue after edit completion
  
- **Syntax Errors**
  - Removed orphaned code fragments left from incomplete function deletions
  - Fixed whitespace issues in multi-line string replacements

### Technical Details

#### Grid Orientation Fix
```javascript
// Before: Direction passed directly to grid generator
generateGrid(polygon, spacing, photoSpacing, direction, ...)
// This caused wrong strip orientation

// After: Direction converted to perpendicular grid angle
const gridRunAngle = (direction + 90) % 360;
generateGrid(polygon, spacing, photoSpacing, gridRunAngle, ...)
// Now strips run perpendicular to flight direction (correct)
```

#### Heading Calculation
```javascript
// Grid waypoints now include heading property
heading: (angle + 90) % 360
// This converts from web compass (0°=East) to DJI compass (0°=North)
```

#### Safe Waypoint Property Access
```javascript
// Before: wp.heading.toFixed(1) - could fail if undefined
// After: wp.heading?.toFixed(1) ?? 0 - safe fallback to 0
```

#### Terrarn Analysis Optimization
- Batched elevation queries: 40 points per API request
- 300ms throttle between requests to avoid rate limiting
- Skipped during live-edit preview (enabled after DONE)

### Code Safety Improvements
- Added single-definition rule documentation in code
- Comment warning added to prevent future duplicate functions
- Edit polling interval (`editCheckInterval`) cleared before each draw/edit session
- Handler instances nullified after disabling to prevent dangling references

### Breaking Changes
None - all changes are backwards compatible.

### Known Issues Resolved
| Issue | Resolution |
|-------|-----------|
| Flight strips East-West when direction=0° (North) | Added direction→gridAngle conversion (+90°) |
| Heading 0° pointing East instead of North | Added +90° compass conversion in heading calc |
| DONE button not finalizing editing | Removed duplicate `finishPolygonDraw()` functions |
| DELETE button never enabling | Removed duplicate `updateDrawButtons()` missing logic |
| White screen after code changes | Fixed orphaned code from incomplete deletions |
| Map not updating during vertex drag | Implemented 200ms live-preview polling |

### Testing Recommendations
1. **Drawing Workflow**:
   - Click DRAW → add 4-5 vertices → DONE → verify blue polygon
   - Click EDIT → drag vertices → see waypoints update live → DONE → verify color restored
   
2. **Flight Direction**:
   - Set direction=0° (North) → GENERATE → strips should run East-West
   - Set direction=90° (East) → GENERATE → strips should run North-South
   - Export KML → verify heading values in DJI WPML
   
3. **Waypoint Markers**:
   - First waypoint should be purple, others green/blue
   - Click waypoint → popup should show "(START)" for first waypoint

4. **Terrain Analysis**:
   - During EDIT mode, drag vertex quickly → no terrain API spam
   - After DONE → console shows "Terrain analysis re-enabled"
   - Terrain data updates within 5 seconds of DONE click

### Future Improvements
- Add undo/redo for polygon editing
- Support multi-polygon missions
- Add waypoint import from CSV
- Implement batch terrain caching to reduce API calls

### Contributors
- Tom (Dev) - Polygon editing workflow, compass conversion fixes
