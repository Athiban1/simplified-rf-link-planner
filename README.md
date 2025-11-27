## Approach & Design Decisions

Developer: Athiban Vetrivel A
Email: vetrivelathiban@gmail.com
Assessment completed for: Astrome Technologies Pvt. Ltd.

### 1. Overall Approach

The goal was to build a *frontend-only RF outdoor link planner* that lets users:

* Place “towers” on a map
* Connect towers into *point-to-point RF links* (only if they share the same frequency)
* Visualize the *first Fresnel zone* as an ellipse when a link is selected
* Inspect basic link information such as frequency, distance, and elevation profile

I treated this primarily as a *UI + geometry problem* rather than a full RF simulator. All calculations are done in the browser using plain JavaScript, and the app is fully client-side.

---

### 2. Technology Choices

*Frontend stack*

* *HTML + CSS + Vanilla JavaScript* (no frameworks)
* *Mapbox GL JS* for the interactive 3D map and globe projection
* *Highcharts* for the elevation profile chart
* *Open-Elevation API* for terrain elevation samples along a link

*Why this stack*

* Mapbox GL JS allowed me to:

  * Use a *globe projection* with smooth camera transitions.
  * Add custom *GeoJSON layers* for links and Fresnel polygons.
* Keeping logic in plain JavaScript makes the implementation easy to read and review for an assignment.
* Highcharts provides a quick way to show elevation and line-of-sight without building charting logic from scratch.

---

### 3. Data Model & State Management

I used a very simple in-memory state model:

js
let towers = []; // { id, lngLat, freqGHz, marker, markerEl }
let links = [];  // { id, fromId, toId, freqGHz, distanceMeters, fresnelRadius, ... }


* *Towers*

  * Have an id, lngLat (longitude/latitude), a configurable freqGHz, and a Mapbox marker.
  * Are created either by *clicking on the map* or filling the *“Add tower by coordinates”* form.

* *Links*

  * Connect fromId → toId (tower IDs).
  * Store shared freqGHz, distanceMeters, and the *first Fresnel radius* (simplified).
  * Store optional *elevation* information once fetched.

All visual layers (lines and ellipses) are derived from these arrays and pushed into Mapbox as *GeoJSON sources*, so the visual representation can always be recomputed from the current state.

---

### 4. Tower & Link Creation Logic

#### 4.1 Tower creation

Two ways to create a tower:

1. *Map click*

   * Clicking on the map opens a small popup:

     * Latitude/Longitude are taken from the click position.
     * User enters a frequency in GHz (default 5 GHz).
   * On confirm, a tower object is pushed into towers[] and a Mapbox marker is added.

2. *Sidebar form*

   * User enters coordinates and frequency manually.
   * This is useful when exact locations are known.

Each tower can later be selected from the map or via the sidebar to edit its frequency.

#### 4.2 Frequency as “channel”

In the UI, *frequency behaves like a channel number*:

* Two towers can only be linked if their freqGHz values match.
* When a user edits a tower’s frequency:

  * I recompute all links attached to that tower.
  * Any link whose *other endpoint* now has a different frequency is automatically *removed*.
  * This ensures the graph never contains an “invalid” link.

This matches the assignment requirement that frequencies must match and keeps the model physically reasonable.

#### 4.3 Link creation

The user flow for creating a link is:

1. Click a tower marker → popup appears.
2. Click *“Link Tower”* in the popup → that tower becomes the *start* of the link.
3. Click a second tower → if frequencies match, a new link is created.

Implementation details:

* I prevent duplicate links between the same pair (in either direction).
* If frequencies don’t match, the link is *not created* and an error toast is shown.
* When a new link is created:

  * I compute its *great-circle distance* using the haversine formula.
  * I compute the *first Fresnel radius* (simplified to mid-path) and store it.

---

### 5. Geometry & Fresnel Zone

#### 5.1 Distance calculation

To get the distance between two towers, I used the *haversine formula*:

* Convert lat/lng to radians.
* Use Earth radius R ≈ 6,371,000 m to compute distance in meters.
* This distance is reused later for Fresnel and chart x-axis.

#### 5.2 Fresnel zone radius

The assignment formula is:

> ( r = \sqrt{(\lambda \cdot d_1 \cdot d_2) / (d_1 + d_2)} )

with λ = c / f.

I used the *special case at the midpoint* of the link (d1 = d2 = d/2), which simplifies to:

* Total distance: d
* Midpoint radius becomes approximately:
  ( r \approx \sqrt{ (\lambda \cdot d) / 4 } )

This is what I compute in code as:

js
lambda = c / f;
r = Math.sqrt((lambda * distanceM) / 4);


This gives the *maximum first Fresnel radius at mid-span*, which I then use to draw an approximate ellipse.

#### 5.3 Drawing the Fresnel ellipse

To visualize the Fresnel zone as a 2D ellipse around the link:

1. Convert both tower coordinates from lon/lat to *Web Mercator meters*.
2. Compute:

   * Midpoint in meters (cx, cy)
   * Vector along the link (dx, dy) and its angle (atan2).
   * Semi-major axis a = d / 2 along the link line.
   * Semi-minor axis b = rMax using the Fresnel radius.
3. Generate points of an axis-aligned ellipse (a cos t, b sin t), rotate them by the link angle, then convert back to lon/lat and store as a GeoJSON polygon.
4. Add two Mapbox layers:

   * Fill layer (semi-transparent color)
   * Outline layer (dashed line)

When the user selects a link, this polygon is updated and faded in with a short opacity animation.

---

### 6. Elevation & Line-of-Sight (optional enhancement)

Although not strictly required, I added an elevation profile to make the tool more useful:

* Sample ~20 points along the link between towers.
* Call *Open-Elevation API* to get terrain elevation at those coordinates.
* Compute min, max, and average elevation.
* Render a *Highcharts line chart* in the sidebar with:

  * *Terrain* profile
  * *Straight line of sight* between endpoints

This provides a quick visual sense of whether terrain might obstruct the RF path.

---

### 7. UI & UX Design

Key design decisions:

* *Sidebar as control panel*

  * Towers tab: add towers, see selected tower details, edit frequency, delete tower.
  * Links tab: show selected link, endpoints, distance, frequency, Fresnel radius, and elevation.

* *Map as the main interaction surface*

  * Click to add towers.
  * Click markers to link or delete.
  * Click link lines to select and show Fresnel + elevation.

* *Visual feedback*

  * Toast messages for actions and validation errors.
  * Status bar at the bottom with contextual instructions.
  * Tower markers pulse if they are endpoints of any link.
  * Link hover tooltip shows distance and frequency.

* *Guided tour (on first load)*

  * A small, custom guided tour highlights:

    * Sidebar
    * Tower add card
    * Link panel
    * Map style switcher
    * Hints panel
    * Status bar
  * Uses localStorage to only run on first visit; can be reset for demos.

---

### 8. Responsiveness

The layout is optimized for *desktop and tablet*:

* Sidebar shrinks to full-width at the top for smaller screens (e.g. tablets/portrait).
* The map always occupies the remaining space.
* All elements are built with flexible units and avoid fixed pixel-heavy layouts where possible.

---

### 9. Limitations & Possible Improvements

* Fresnel zone is approximated as a *single ellipse* using the *mid-path radius*, not computed continuously for every point along the path.
* Elevation data depends on an external free API (Open-Elevation), which can be slow or rate-limited.
* Antenna heights, obstacles (buildings/trees), and actual RF link budgets are not modeled.

If I continue this project, I would like to:

* Support import/export of tower/link data (CSV/GeoJSON).
* Add more link metrics.
