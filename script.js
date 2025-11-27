window.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("sidebar-intro-hidden");

    mapboxgl.accessToken =
        "pk.eyJ1IjoidmV0cml2ZWwxMjM0NTY3ODkiLCJhIjoiY21lbnRoYmxzMHZxdTJpczhxZGF0ZW5vMyJ9.ZXMqPsjonVxLIeP-SVpZIw";

    const STYLE_STREETS = "mapbox://styles/mapbox/streets-v12";
    const STYLE_SATELLITE = "mapbox://styles/mapbox/satellite-streets-v12";
    const STYLE_DARK = "mapbox://styles/mapbox/dark-v11";

    const START_CENTER = [20.0, 20.0];
    const START_ZOOM = 1.1;
    const INDIA_CENTER = [78.0, 22.45];
    const REST_ZOOM = 4.2;
    const TRANSITION_MS = 6200;

    const map = new mapboxgl.Map({
        container: "map",
        style: STYLE_SATELLITE,
        center: START_CENTER,
        zoom: START_ZOOM,
        projection: "globe",
        antialias: true,
        pitchWithRotate: false,
        dragRotate: false,
        attributionControl: true
    });

    const addTowerCard = document.getElementById("add-tower-card");
    const addTowerHeader = document.getElementById("add-tower-header");
    const addTowerBody = document.getElementById("add-tower-body");

    if (addTowerCard && addTowerHeader && addTowerBody) {
        addTowerCard.classList.remove("open");

        addTowerHeader.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = addTowerCard.classList.toggle("open");
            addTowerHeader.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });
    }

    map.addControl(
        new mapboxgl.NavigationControl({ showCompass: true }),
        "top-right"
    );

    window.addEventListener("resize", () => map.resize(), { passive: true });
    setTimeout(() => map.resize(), 200);

    function enableSofterAtmosphere() {
        try {
            map.setFog({
                range: [0.65, 8],
                color: "#a9d4ff",
                "high-color": "#82b7ff",
                "space-color": "#000000",
                "horizon-blend": 0.02
            });
        } catch (e) { }

        const layers = map.getStyle().layers || [];
        const skyId = layers.find((l) => l.type === "sky")?.id;

        if (skyId) {
            try {
                map.setLayoutProperty(skyId, "visibility", "visible");
                map.setPaintProperty(
                    skyId,
                    "sky-atmosphere-sun-intensity",
                    2.5
                );
            } catch (e) { }
        } else {
            try {
                map.addLayer({
                    id: "atmosphere-sky",
                    type: "sky",
                    paint: {
                        "sky-type": "atmosphere",
                        "sky-atmosphere-sun": [0.0, 0.0],
                        "sky-atmosphere-sun-intensity": 2.5
                    }
                });
            } catch (e) { }
        }
    }

    function keepOnlyPlaceLabels() {
        const layers = map.getStyle().layers || [];
        layers.forEach((l) => {
            const id = l.id || "";
            try {
                if (l.type === "symbol") {
                    const isPlace =
                        /(country|state|province|region|settlement|city|town|village|locality|neighborhood).*label/i.test(
                            id
                        );
                    if (!isPlace) {
                        map.setLayoutProperty(id, "visibility", "none");
                    }
                } else if (
                    l.type === "line" ||
                    l.type === "fill" ||
                    l.type === "fill-extrusion"
                ) {
                    if (
                        /^(road|bridge|tunnel|transit|rail|path|ferry|aeroway|airport|building|pedestrian|poi|landuse|landuse-overlay)/i.test(
                            id
                        ) ||
                        /(road|bridge|tunnel|rail|aeroway|airport|poi|attraction)/i.test(id)
                    ) {
                        map.setLayoutProperty(id, "visibility", "none");
                    }
                }
            } catch (e) { }
        });
    }

    map.on("style.load", () => {
        enableSofterAtmosphere();
        keepOnlyPlaceLabels();
        addOverlaySourcesAndLayers();
    });

    function easeInOut(t) {
        return t < 0.5
            ? 2 * t * t
            : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    function zoomPanToIndia(durationMs) {
        return new Promise((resolve) => {
            const start = performance.now();

            const [startLng, startLat] = START_CENTER;
            const startZoom = START_ZOOM;
            const startBearing = 0;
            const startPitch = 0;

            const [endLng, endLat] = INDIA_CENTER;
            const endZoom = REST_ZOOM;
            const endBearing = 0;
            const endPitch = 0;

            function frame(now) {
                const t = Math.min((now - start) / durationMs, 1);
                const k = easeInOut(t);

                const lng = startLng + (endLng - startLng) * k;
                const lat = startLat + (endLat - startLat) * k;
                const zoom = startZoom + (endZoom - startZoom) * k;
                const bearing = startBearing + (endBearing - startBearing) * k;
                const pitch = startPitch + (endPitch - startPitch) * k;

                try {
                    map.jumpTo({
                        center: [lng, lat],
                        zoom,
                        bearing,
                        pitch
                    });
                } catch (e) { }

                if (t < 1) {
                    requestAnimationFrame(frame);
                } else {
                    resolve();
                }
            }

            requestAnimationFrame(frame);
        });
    }

    let towers = [];
    let links = [];
    let towerIdCounter = 1;
    let linkIdCounter = 1;

    let selectedTowerId = null;
    let selectedLinkId = null;

    let linkStartTowerId = null;

    let suppressNextMapClick = false;

    const linkSourceId = "links-source";
    const fresnelSourceId = "fresnel-source";
    const linkLayerId = "links-layer";
    const fresnelFillLayerId = "fresnel-fill-layer";
    const fresnelOutlineLayerId = "fresnel-outline-layer";

    let linksGeoJSON = { type: "FeatureCollection", features: [] };
    let fresnelGeoJSON = { type: "FeatureCollection", features: [] };

    let linkChart = null;

    let currentTowerPopup = null;
    let currentAddPopup = null;

    let overlaysReady = false;

    const sidebarEdgeTab = document.getElementById("sidebar-edge-tab");
    const statusTextEl = document.getElementById("status-text");
    const toastEl = document.getElementById("toast");
    const hoverTooltipEl = document.getElementById("hover-tooltip");

    const towerCountEl = document.getElementById("tower-count");
    const linkCountEl = document.getElementById("link-count");

    const noTowerSelectedEl = document.getElementById("no-tower-selected");
    const towerDetailsEl = document.getElementById("tower-details");
    const towerIdLabelEl = document.getElementById("tower-id-label");
    const towerCoordsEl = document.getElementById("tower-coords");
    const towerFreqInput = document.getElementById("tower-freq");
    const freqSwatchEl = document.getElementById("freq-swatch");
    const freqLabelEl = document.getElementById("freq-label");
    const deleteTowerBtn = document.getElementById("delete-tower-btn");
    const saveTowerEditsBtn = document.getElementById("save-tower-edits-btn");

    const addTowerLatInput = document.getElementById("add-tower-lat");
    const addTowerLngInput = document.getElementById("add-tower-lng");
    const addTowerFreqInput = document.getElementById("add-tower-freq");
    const addTowerBtn = document.getElementById("add-tower-btn");

    const noLinkSelectedEl = document.getElementById("no-link-selected");
    const linkDetailsEl = document.getElementById("link-details");
    const linkIdLabelEl = document.getElementById("link-id-label");
    const linkTowersEl = document.getElementById("link-towers");
    const linkFrequencyEl = document.getElementById("link-frequency");
    const linkGeometryEl = document.getElementById("link-geometry");
    const linkFresnelEl = document.getElementById("link-fresnel");
    const linkElevationEl = document.getElementById("link-elevation");
    const deleteLinkBtn = document.getElementById("delete-link-btn");
    const linkChartContainer = document.getElementById("link-chart-container");

    const sidebarTabsEl = document.getElementById("sidebar-tabs");
    const tabButtons = sidebarTabsEl.querySelectorAll(".tab-btn");

    const infoToggleBtn = document.getElementById("info-toggle");
    const hintsPanel = document.getElementById("hints-panel");

    const edgeChevron = sidebarEdgeTab.querySelector(".chevron");

    const styleSwitcherEl = document.getElementById("map-style-switcher");
    const styleButtons = styleSwitcherEl
        ? styleSwitcherEl.querySelectorAll(".style-btn")
        : [];

    function toRad(deg) {
        return (deg * Math.PI) / 180;
    }

    function distanceMeters(a, b) {
        const R = 6371000;
        const phi1 = toRad(a[1]);
        const phi2 = toRad(b[1]);
        const dPhi = toRad(b[1] - a[1]);
        const dLambda = toRad(b[0] - a[0]);
        const sinDPhi = Math.sin(dPhi / 2);
        const sinDL = Math.sin(dLambda / 2);
        const h =
            sinDPhi * sinDPhi +
            Math.cos(phi1) * Math.cos(phi2) * sinDL * sinDL;
        const c = 2 * Math.asin(Math.sqrt(h));
        return R * c;
    }

    const RADIUS = 6378137;
    const originShift = (2 * Math.PI * RADIUS) / 2.0;

    function lngLatToMeters(lon, lat) {
        const mx = (lon * originShift) / 180.0;
        let my =
            Math.log(Math.tan(((90 + lat) * Math.PI) / 360.0)) /
            (Math.PI / 180.0);
        my = (my * originShift) / 180.0;
        return { x: mx, y: my };
    }

    function metersToLngLat(mx, my) {
        const lon = (mx / originShift) * 180.0;
        let lat = (my / originShift) * 180.0;
        lat =
            (180 / Math.PI) *
            (2 * Math.atan(Math.exp((lat * Math.PI) / 180.0)) -
                Math.PI / 2);
        return { lng: lon, lat: lat };
    }

    // Mid-path Fresnel radius (kept for summary / stats)
    function fresnelRadiusMid(freqGHz, distanceM) {
        const fHz = freqGHz * 1e9;
        const c = 3e8;
        const lambda = c / fHz;
        const r2 = (lambda * distanceM) / 4.0;
        return Math.sqrt(Math.max(r2, 0));
    }

    // NEW: Fresnel radius as a function of fractional distance t (0..1)
    function fresnelRadiusAtFraction(freqGHz, totalDistanceM, t) {
        const fHz = freqGHz * 1e9;
        const c = 3e8;
        const lambda = c / fHz;

        // First Fresnel zone: r(t) = sqrt(lambda * D * t * (1 - t))
        const r2 = lambda * totalDistanceM * t * (1 - t);
        return Math.sqrt(Math.max(r2, 0));
    }

    // NEW: Generate a variable-radius Fresnel "tube" polygon along the path
    function generateFresnelTubePolygonCoords(
        fromLngLat,
        toLngLat,
        freqGHz,
        segments = 64
    ) {
        // Endpoints in Mercator meters
        const p1m = lngLatToMeters(fromLngLat[0], fromLngLat[1]);
        const p2m = lngLatToMeters(toLngLat[0], toLngLat[1]);

        const dx = p2m.x - p1m.x;
        const dy = p2m.y - p1m.y;

        // Use geodesic distance for Fresnel math
        const totalDistanceM = distanceMeters(fromLngLat, toLngLat);

        const Dm = Math.sqrt(dx * dx + dy * dy);
        if (Dm === 0 || totalDistanceM === 0) return [];

        // Unit vector along path (in Mercator meters)
        const ux = dx / Dm;
        const uy = dy / Dm;

        // Perpendicular unit vector (left normal)
        const nx = -uy;
        const ny = ux;

        const leftSide = [];
        const rightSide = [];

        for (let i = 0; i <= segments; i++) {
            const t = segments === 0 ? 0 : i / segments;

            const r = fresnelRadiusAtFraction(freqGHz, totalDistanceM, t);

            // Center point along the line in Mercator meters
            const cx = p1m.x + dx * t;
            const cy = p1m.y + dy * t;

            // Left and right offsets
            const lx = cx + nx * r;
            const ly = cy + ny * r;
            const rx = cx - nx * r;
            const ry = cy - ny * r;

            const llLeft = metersToLngLat(lx, ly);
            const llRight = metersToLngLat(rx, ry);

            leftSide.push([llLeft.lng, llLeft.lat]);
            rightSide.push([llRight.lng, llRight.lat]);
        }

        // Build closed ring: left forward + right backward
        const coords = leftSide.concat(rightSide.reverse());
        if (coords.length > 0) {
            coords.push(coords[0]);
        }
        return coords;
    }

    function formatMeters(m) {
        if (!isFinite(m)) return "–";
        if (m < 1000) return `${m.toFixed(1)} m`;
        return `${(m / 1000).toFixed(2)} km`;
    }

    function formatRadius(m) {
        if (!isFinite(m)) return "–";
        return `${m.toFixed(2)} m`;
    }

    let toastTimeout = null;
    function showToast(message, isError = false) {
        toastEl.textContent = message;
        toastEl.classList.toggle("error", !!isError);
        toastEl.classList.add("show");
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove("show");
        }, 2200);
    }

    const defaultStatus =
        'Click a tower marker for link / remove options. Use “Add tower” or click on the map to place new towers.';

    function setStatus(message) {
        statusTextEl.innerHTML = message;
    }

    sidebarEdgeTab.addEventListener("click", () => {
        const isCollapsed =
            document.body.classList.toggle("sidebar-collapsed");
        edgeChevron.textContent = isCollapsed ? "⟩" : "⟨";

        if (!isCollapsed && !linkStartTowerId) {
            setStatus(defaultStatus);
        }
        setTimeout(() => {
            map.resize();
        }, 320);
    });

    function setBaseStyle(styleKey) {
        let styleUrl = STYLE_STREETS;
        if (styleKey === "satellite") styleUrl = STYLE_SATELLITE;
        else if (styleKey === "dark") styleUrl = STYLE_DARK;

        styleButtons.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.style === styleKey);
        });

        map.setStyle(styleUrl);
    }

    styleButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const key = btn.dataset.style;
            setBaseStyle(key);
        });
    });

    function getTowerById(id) {
        return towers.find((t) => t.id === id) || null;
    }

    function addTower(lngLat, freqGHz = 5.0) {
        const id = towerIdCounter++;

        const el = document.createElement("img");
        el.src = "./assets/tower.png";
        el.alt = `Tower #${id}`;
        el.className = "tower-marker";

        const marker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
            .setLngLat(lngLat)
            .addTo(map);

        const tower = {
            id,
            lngLat: [lngLat[0], lngLat[1]],
            freqGHz,
            markerEl: el,
            marker
        };

        towers.push(tower);
        attachTowerEvents(tower);

        selectTower(id);
        updateTowerMarkerStyles();
        refreshSummary();
        showToast(`Tower #${id} added.`);
    }

    function attachTowerEvents(tower) {
        tower.markerEl.addEventListener("click", (ev) => {
            ev.stopPropagation();

            if (linkStartTowerId && linkStartTowerId !== tower.id) {
                const startTower = getTowerById(linkStartTowerId);
                const endTower = tower;
                if (startTower && endTower) {
                    createLink(startTower, endTower);
                }
                linkStartTowerId = null;
                updateTowerMarkerStyles();
                setStatus(defaultStatus);
                if (currentTowerPopup) {
                    currentTowerPopup.remove();
                    currentTowerPopup = null;
                }
                if (currentAddPopup) {
                    currentAddPopup.remove();
                    currentAddPopup = null;
                }
                return;
            }

            openTowerPopup(tower);
        });
    }

    function openTowerPopup(tower) {
        if (currentTowerPopup) {
            currentTowerPopup.remove();
            currentTowerPopup = null;
        }
        if (currentAddPopup) {
            currentAddPopup.remove();
            currentAddPopup = null;
        }

        selectTower(tower.id);

        const container = document.createElement("div");
        container.className = "tower-popup";
        container.innerHTML = `
  <div class="tp-header">
    <div class="tp-icon"></div>
    <div class="tp-info">
      <div class="tp-title">Tower #${tower.id}</div>
      <div class="tp-coords">${tower.lngLat[1].toFixed(5)}° N · ${tower.lngLat[0].toFixed(5)}° E</div>
    </div>
  </div>

  <div class="tp-actions">
    <button class="tp-btn tp-link" data-action="link">
      <span class="material-symbols-outlined">hub</span> Link Tower
    </button>
    <button class="tp-btn tp-remove" data-action="remove">
      <span class="material-symbols-outlined">delete</span> Delete Tower
    </button>
  </div>
`;

        const popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: false,
            offset: 28
        })
            .setDOMContent(container)
            .setLngLat(tower.lngLat)
            .addTo(map);

        currentTowerPopup = popup;

        const linkBtn = container.querySelector('[data-action="link"]');
        const removeBtn = container.querySelector('[data-action="remove"]');

        linkBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            handleLinkActionFromTower(tower.id);
        });

        removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteTower(tower.id);
            popup.remove();
            currentTowerPopup = null;
        });
    }

    function handleLinkActionFromTower(towerId) {
        if (!linkStartTowerId) {
            linkStartTowerId = towerId;
            updateTowerMarkerStyles();
            setStatus(
                `Linking: tower #${towerId} → click another tower marker to complete the link.`
            );
            showToast(
                `Tower #${towerId} selected as link start. Click another tower marker to complete.`,
                false
            );
        } else if (linkStartTowerId === towerId) {
            linkStartTowerId = null;
            updateTowerMarkerStyles();
            setStatus(defaultStatus);
            showToast("Link creation cancelled.");
        } else {
            const a = getTowerById(linkStartTowerId);
            const b = getTowerById(towerId);
            if (a && b) {
                createLink(a, b);
            }
            linkStartTowerId = null;
            updateTowerMarkerStyles();
            setStatus(defaultStatus);
        }
    }

    function selectTower(towerId) {
        selectedTowerId = towerId;
        selectedLinkId = null;
        updateTowerMarkerStyles();
        updateLinksGeoJSON();
        updateFresnelGeoJSON(null);
        updateSidebar();
        setActiveTab("tower-panel");
    }

    function deleteTower(towerId) {
        const tower = getTowerById(towerId);
        if (!tower) return;

        tower.marker.remove();
        towers = towers.filter((t) => t.id !== towerId);

        const removedLinksCount = links.filter(
            (l) => l.fromId === towerId || l.toId === towerId
        ).length;

        links = links.filter(
            (l) => l.fromId !== towerId && l.toId !== towerId
        );

        if (selectedTowerId === towerId) selectedTowerId = null;
        if (linkStartTowerId === towerId) linkStartTowerId = null;
        selectedLinkId = null;

        updateTowerMarkerStyles();
        updateLinksGeoJSON();
        updateTowerLinkEndpointPulse();
        updateFresnelGeoJSON(null);
        refreshSummary();
        updateSidebar();

        showToast(
            removedLinksCount
                ? `Tower #${towerId} and ${removedLinksCount} link(s) removed.`
                : `Tower #${towerId} removed.`
        );
    }

    function updateTowerMarkerStyles() {
        towers.forEach((tower) => {
            const el = tower.markerEl;
            el.classList.toggle("selected", tower.id === selectedTowerId);
            el.classList.toggle("pending", tower.id === linkStartTowerId);
        });
    }

    function updateTowerLinkEndpointPulse() {
        towers.forEach((tower) => {
            tower.markerEl.classList.remove("link-anim-endpoint");
        });

        links.forEach((link) => {
            const a = getTowerById(link.fromId);
            const b = getTowerById(link.toId);
            if (a) a.markerEl.classList.add("link-anim-endpoint");
            if (b) b.markerEl.classList.add("link-anim-endpoint");
        });
    }

    function onTowerFrequencyChanged(towerId, newFreq) {
        const tower = getTowerById(towerId);
        if (!tower) return;
        tower.freqGHz = newFreq;

        const linksToDelete = [];
        links.forEach((link) => {
            if (link.fromId === towerId || link.toId === towerId) {
                const a = getTowerById(link.fromId);
                const b = getTowerById(link.toId);
                if (!a || !b) return;

                if (Math.abs(a.freqGHz - b.freqGHz) > 1e-9) {
                    linksToDelete.push(link.id);
                } else {
                    link.valid = true;
                    link.freqGHz = (a.freqGHz + b.freqGHz) / 2;
                    const dist = distanceMeters(a.lngLat, b.lngLat);
                    link.distanceMeters = dist;
                    link.fresnelRadius = fresnelRadiusMid(link.freqGHz, dist);
                }
            }
        });

        if (linksToDelete.length > 0) {
            links = links.filter((l) => !linksToDelete.includes(l.id));

            if (selectedLinkId != null && linksToDelete.includes(selectedLinkId)) {
                selectedLinkId = null;
                updateFresnelGeoJSON(null);
            }

            if (linksToDelete.length === 1) {
                showToast(`Link #${linksToDelete[0]} removed due to frequency mismatch.`);
            } else {
                showToast(`${linksToDelete.length} links removed due to frequency change.`);
            }
        }

        updateLinksGeoJSON();
        updateTowerLinkEndpointPulse();

        if (selectedLinkId != null) {
            updateFresnelForLink(selectedLinkId);
        }

        updateSidebar();
    }

    function getLinkById(id) {
        return links.find((l) => l.id === id) || null;
    }

    function animateLinkCreation(linkId, durationMs = 1200) {
        if (!overlaysReady) {
            setTimeout(() => animateLinkCreation(linkId, durationMs), 80);
            return;
        }

        const link = getLinkById(linkId);
        const source = map.getSource(linkSourceId);
        if (!link || !source) return;

        const feature = linksGeoJSON.features.find(
            (f) => f.properties && Number(f.properties.id) === Number(linkId)
        );
        if (!feature) return;

        const coords = feature.geometry.coordinates;
        if (!coords || coords.length < 2) return;

        const [start, end] = coords;
        const [startLng, startLat] = start;
        const [endLng, endLat] = end;

        feature.geometry.coordinates[1] = [startLng, startLat];
        source.setData(linksGeoJSON);

        let startTime = null;

        function frame(ts) {
            if (startTime === null) startTime = ts;
            const t = Math.min((ts - startTime) / durationMs, 1);
            const k = easeInOut(t);

            const curLng = startLng + (endLng - startLng) * k;
            const curLat = startLat + (endLat - startLat) * k;

            feature.geometry.coordinates[1] = [curLng, curLat];
            source.setData(linksGeoJSON);

            if (t < 1) {
                requestAnimationFrame(frame);
            }
        }

        requestAnimationFrame(frame);
    }

    function createLink(a, b) {
        const existing = links.find(
            (l) =>
                (l.fromId === a.id && l.toId === b.id) ||
                (l.fromId === b.id && l.toId === a.id)
        );
        if (existing) {
            showToast(
                `Link between tower #${a.id} and #${b.id} already exists.`,
                true
            );
            return;
        }

        if (Math.abs(a.freqGHz - b.freqGHz) > 1e-9) {
            showToast(
                `Cannot link: frequencies mismatch (${a.freqGHz} vs ${b.freqGHz} GHz).`,
                true
            );
            return;
        }

        const freqGHz = a.freqGHz;
        const dist = distanceMeters(a.lngLat, b.lngLat);
        const fresnel = fresnelRadiusMid(freqGHz, dist);

        const id = linkIdCounter++;
        const link = {
            id,
            fromId: a.id,
            toId: b.id,
            freqGHz,
            distanceMeters: dist,
            fresnelRadius: fresnel,
            valid: true,
            elevationProfile: null,
            elevationStats: null,
            elevationError: false
        };

        links.push(link);
        updateLinksGeoJSON();

        updateTowerLinkEndpointPulse();

        animateLinkCreation(id);

        refreshSummary();

        selectLink(id);
        showToast(
            `Link #${id}: tower #${a.id} ↔ #${b.id}. Click the line to see Fresnel & elevation.`
        );
    }

    function selectLink(linkId) {
        selectedLinkId = linkId;
        selectedTowerId = null;
        linkStartTowerId = null;

        updateTowerMarkerStyles();
        updateLinksGeoJSON();
        updateFresnelForLink(linkId);
        updateSidebar();
        setStatus(defaultStatus);
        setActiveTab("link-panel");

        const link = getLinkById(linkId);
        if (link && !link.elevationProfile && !link.elevationError) {
            fetchElevationProfile(link);
        }
    }

    function deleteLink(linkId) {
        const link = getLinkById(linkId);
        if (!link) return;

        links = links.filter((l) => l.id !== linkId);
        selectedLinkId = null;

        updateLinksGeoJSON();
        updateFresnelGeoJSON(null);
        updateTowerLinkEndpointPulse();
        refreshSummary();
        updateSidebar();

        showToast(`Link #${linkId} deleted.`);
    }

    function updateLinksGeoJSON() {
        linksGeoJSON.features = links
            .map((link) => {
                const a = getTowerById(link.fromId);
                const b = getTowerById(link.toId);
                if (!a || !b) return null;
                return {
                    type: "Feature",
                    properties: {
                        id: link.id,
                        fromId: link.fromId,
                        toId: link.toId,
                        freqGHz: link.freqGHz,
                        distanceM: link.distanceMeters,
                        fresnelRadius: link.fresnelRadius,
                        valid: link.valid ? 1 : 0,
                        selected: link.id === selectedLinkId ? 1 : 0
                    },
                    geometry: {
                        type: "LineString",
                        coordinates: [a.lngLat, b.lngLat]
                    }
                };
            })
            .filter(Boolean);

        const source = map.getSource(linkSourceId);
        if (source) {
            source.setData(linksGeoJSON);
        }
    }

    const FRESNEL_MAX_FILL = 0.18;

    function animateFresnelIn(durationMs = 400) {
        if (!overlaysReady) return;

        let startTime = null;

        try {
            map.setPaintProperty(fresnelFillLayerId, "fill-opacity", 0);
            map.setPaintProperty(fresnelOutlineLayerId, "line-opacity", 0);
        } catch (e) { }

        function frame(ts) {
            if (startTime === null) startTime = ts;
            const t = Math.min((ts - startTime) / durationMs, 1);

            const k = t * t * (3 - 2 * t);

            const fillOpacity = FRESNEL_MAX_FILL * k;
            const outlineOpacity = 0.3 + 0.6 * k;

            try {
                map.setPaintProperty(
                    fresnelFillLayerId,
                    "fill-opacity",
                    fillOpacity
                );
                map.setPaintProperty(
                    fresnelOutlineLayerId,
                    "line-opacity",
                    outlineOpacity
                );
            } catch (e) { }

            if (t < 1) {
                requestAnimationFrame(frame);
            }
        }

        requestAnimationFrame(frame);
    }

    function updateFresnelGeoJSON(linkId) {
        if (linkId == null) {
            fresnelGeoJSON.features = [];
            const source = map.getSource(fresnelSourceId);
            if (source) source.setData(fresnelGeoJSON);

            if (overlaysReady) {
                try {
                    map.setPaintProperty(fresnelFillLayerId, "fill-opacity", 0);
                    map.setPaintProperty(fresnelOutlineLayerId, "line-opacity", 0);
                } catch (e) { }
            }
            return;
        }

        const link = getLinkById(linkId);
        const a = link ? getTowerById(link.fromId) : null;
        const b = link ? getTowerById(link.toId) : null;
        if (!link || !a || !b) {
            fresnelGeoJSON.features = [];
        } else {
            // NEW: variable-radius Fresnel tube polygon
            const coords = generateFresnelTubePolygonCoords(
                a.lngLat,
                b.lngLat,
                link.freqGHz
            );
            fresnelGeoJSON.features = [
                {
                    type: "Feature",
                    properties: { linkId: link.id },
                    geometry: { type: "Polygon", coordinates: [coords] }
                }
            ];
        }

        const source = map.getSource(fresnelSourceId);
        if (source) {
            source.setData(fresnelGeoJSON);
        }
    }

    function updateFresnelForLink(linkId) {
        updateFresnelGeoJSON(linkId);
        if (linkId != null) {
            animateFresnelIn();
        }
    }

    async function fetchElevationProfile(link) {
        const a = getTowerById(link.fromId);
        const b = getTowerById(link.toId);
        if (!a || !b) return;

        const samples = 20;
        const locationsArr = [];
        for (let i = 0; i < samples; i++) {
            const t = samples === 1 ? 0 : i / (samples - 1);
            const lat =
                a.lngLat[1] + t * (b.lngLat[1] - a.lngLat[1]);
            const lng =
                a.lngLat[0] + t * (b.lngLat[0] - a.lngLat[0]);
            locationsArr.push(`${lat.toFixed(6)},${lng.toFixed(6)}`);
        }
        const locationsParam = locationsArr.join("|");
        const url = `https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(
            locationsParam
        )}`;

        link.elevationProfile = null;
        link.elevationStats = null;
        link.elevationError = false;
        updateSidebar();

        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            const data = await resp.json();
            if (!data || !data.results || !data.results.length) {
                throw new Error("No elevation data");
            }

            const elevations = data.results.map((r) => r.elevation);
            const min = Math.min(...elevations);
            const max = Math.max(...elevations);
            const sum = elevations.reduce((acc, e) => acc + e, 0);
            const avg = sum / elevations.length;

            link.elevationProfile = elevations;
            link.elevationStats = { min, max, avg };

            updateSidebar();
        } catch (err) {
            console.warn("Elevation fetch failed:", err);
            link.elevationError = true;
            updateSidebar();
        }
    }

    function renderLinkChart(link) {
        if (!linkChartContainer) return;

        if (!link || !link.elevationProfile || !link.elevationProfile.length) {
            linkChartContainer.innerHTML =
                '<div class="hint-text">Elevation data not available.</div>';
            linkChart = null;
            return;
        }

        const samples = link.elevationProfile.length;
        const elevSeries = [];
        const losSeries = [];

        for (let i = 0; i < samples; i++) {
            const t = samples === 1 ? 0 : i / (samples - 1);
            const distKm =
                (link.distanceMeters * t) / 1000;
            const elev = link.elevationProfile[i];
            elevSeries.push([distKm, elev]);

            const losVal =
                link.elevationProfile[0] +
                (link.elevationProfile[samples - 1] - link.elevationProfile[0]) *
                t;
            losSeries.push([distKm, losVal]);
        }

        linkChart = Highcharts.chart("link-chart-container", {
            chart: {
                type: "line",
                marginLeft: 50,
                marginRight: 20,
                height: 180,
                backgroundColor: "transparent"
            },
            title: { text: null },
            xAxis: {
                title: { text: "Distance (km)" }
            },
            yAxis: {
                title: { text: "Elevation (m)" }
            },
            legend: {
                verticalAlign: "top",
                align: "center",
                itemStyle: { fontSize: "10px" }
            },
            tooltip: {
                shared: true,
                valueDecimals: 1,
                headerFormat: "<b>{point.key:.2f} km</b><br/>"
            },
            series: [
                {
                    name: "Terrain",
                    data: elevSeries
                },
                {
                    name: "Line of Sight",
                    data: losSeries,
                    dashStyle: "ShortDash"
                }
            ],
            credits: { enabled: false }
        });
    }

    function openAddTowerPopup(lngLat) {
        if (currentAddPopup) {
            currentAddPopup.remove();
            currentAddPopup = null;
        }
        if (currentTowerPopup) {
            currentTowerPopup.remove();
            currentTowerPopup = null;
        }

        const container = document.createElement("div");
        container.className = "map-add-popup";
        const lat = lngLat.lat.toFixed(5);
        const lng = lngLat.lng.toFixed(5);

        container.innerHTML = `
  <div class="addtp-header">
    <div class="addtp-icon"></div>
    <div class="addtp-info">
      <div class="addtp-title">Add New Tower ?</div>
      <div class="addtp-coords">${lat}° N · ${lng}° E</div>
    </div>
  </div>

  <div class="addtp-field">
    <label class="addtp-label">
      Frequency <span class="unit">GHz</span>
    </label>
    <input class="addtp-input" type="number" value="5" min="0.1" step="0.1" />
  </div>

  <div class="addtp-actions">
    <button class="addtp-btn addtp-confirm" data-action="add">
      <span class="material-symbols-outlined">add_circle</span> Add Tower
    </button>
    <button class="addtp-btn addtp-cancel" data-action="cancel">
      <span class="material-symbols-outlined">close</span> Cancel
    </button>
  </div>
`;

        const popup = new mapboxgl.Popup({
            closeButton: true,
            closeOnClick: true,
            offset: 10
        })
            .setDOMContent(container)
            .setLngLat(lngLat)
            .addTo(map);

        currentAddPopup = popup;

        const freqInput = container.querySelector("input");
        const addBtn = container.querySelector(
            '[data-action="add"]'
        );
        const cancelBtn = container.querySelector(
            '[data-action="cancel"]'
        );

        addBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const freq = parseFloat(freqInput.value);
            if (!isFinite(freq) || freq <= 0) {
                showToast(
                    "Please enter a positive frequency in GHz.",
                    true
                );
                return;
            }
            addTower([lngLat.lng, lngLat.lat], freq);
            popup.remove();
            currentAddPopup = null;
        });

        cancelBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            popup.remove();
            currentAddPopup = null;
        });
    }

    function refreshSummary() {
        towerCountEl.textContent = towers.length;
        linkCountEl.textContent = links.length;
    }

    function updateSidebar() {
        if (selectedTowerId == null) {
            towerDetailsEl.classList.add("hidden");
            noTowerSelectedEl.classList.remove("hidden");
            towerIdLabelEl.textContent = "–";
            if (saveTowerEditsBtn) {
                saveTowerEditsBtn.classList.add("hidden");
            }
        } else {
            const tower = getTowerById(selectedTowerId);
            if (!tower) {
                towerDetailsEl.classList.add("hidden");
                noTowerSelectedEl.classList.remove("hidden");
                towerIdLabelEl.textContent = "–";
                if (saveTowerEditsBtn) {
                    saveTowerEditsBtn.classList.add("hidden");
                }
            } else {
                noTowerSelectedEl.classList.add("hidden");
                towerDetailsEl.classList.remove("hidden");

                towerIdLabelEl.textContent = `#${tower.id}`;
                towerCoordsEl.textContent = `${tower.lngLat[1].toFixed(
                    5
                )}° N, ${tower.lngLat[0].toFixed(5)}° E`;
                towerFreqInput.value = tower.freqGHz.toFixed(2);
                towerFreqInput.dataset.original = tower.freqGHz.toString();
                freqSwatchEl.style.background = "#2563eb";
                freqLabelEl.textContent = `${tower.freqGHz.toFixed(
                    2
                )} GHz`;

                if (saveTowerEditsBtn) {
                    saveTowerEditsBtn.classList.add("hidden");
                }
            }
        }

        if (selectedLinkId == null) {
            linkDetailsEl.classList.add("hidden");
            noLinkSelectedEl.classList.remove("hidden");
            linkIdLabelEl.textContent = "–";
            linkChartContainer.innerHTML =
                '<div class="hint-text">Select a link to see its profile.</div>';
            linkChart = null;
        } else {
            const link = getLinkById(selectedLinkId);
            const a = link ? getTowerById(link.fromId) : null;
            const b = link ? getTowerById(link.toId) : null;

            if (!link || !a || !b) {
                linkDetailsEl.classList.add("hidden");
                noLinkSelectedEl.classList.remove("hidden");
                linkIdLabelEl.textContent = "–";
                linkChartContainer.innerHTML =
                    '<div class="hint-text">Link not available.</div>';
                linkChart = null;
            } else {
                noLinkSelectedEl.classList.add("hidden");
                linkDetailsEl.classList.remove("hidden");

                linkIdLabelEl.textContent = `#${link.id}`;
                linkTowersEl.textContent = `Tower #${a.id} ↔ Tower #${b.id}`;

                const validClass = link.valid ? "status-ok" : "status-bad";
                const validLabel = link.valid
                    ? "Channel match"
                    : "Freq mismatch";

                linkFrequencyEl.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <span>${link.freqGHz.toFixed(2)} GHz</span>
            <span class="status-tag ${validClass}">
              <span style="font-size:0.8rem;">${link.valid ? "✔" : "⚠"
                    }</span> ${validLabel}
            </span>
          </div>
        `;

                linkGeometryEl.textContent = `Distance: ${formatMeters(
                    link.distanceMeters
                )}`;
                linkFresnelEl.textContent = `1st Fresnel radius at mid-span ≈ ${formatRadius(
                    link.fresnelRadius
                )}`;

                if (link.elevationError) {
                    linkElevationEl.innerHTML =
                        '<span class="status-tag status-bad">Could not fetch elevation</span>';
                    renderLinkChart(null);
                } else if (!link.elevationProfile) {
                    linkElevationEl.innerHTML =
                        '<span class="hint-text">Fetching elevation profile…</span>';
                    renderLinkChart(null);
                } else if (link.elevationStats) {
                    const { min, max, avg } = link.elevationStats;
                    linkElevationEl.innerHTML = `
            Min: ${min.toFixed(1)} m · Max: ${max.toFixed(
                        1
                    )} m · Avg: ${avg.toFixed(1)} m
          `;
                    renderLinkChart(link);
                } else {
                    linkElevationEl.textContent = "–";
                    renderLinkChart(link);
                }
            }
        }
    }

    function setActiveTab(panelId) {
        tabButtons.forEach((btn) => {
            const isActive = btn.dataset.panel === panelId;
            btn.classList.toggle("active", isActive);
        });

        document
            .querySelectorAll(".panel.tabbed")
            .forEach((panel) => {
                panel.classList.toggle("active", panel.id === panelId);
            });
    }

    tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const panelId = btn.dataset.panel;
            setActiveTab(panelId);
        });
    });

    setStatus(defaultStatus);
    setActiveTab("tower-panel");

    infoToggleBtn.addEventListener("click", () => {
        const isOpen = !hintsPanel.classList.contains("hidden");
        if (isOpen) {
            hintsPanel.classList.add("hidden");
            infoToggleBtn.classList.remove("open");
            infoToggleBtn.innerHTML =
                `<span class="icon">ℹ</span> Info & Hints`;
        } else {
            hintsPanel.classList.remove("hidden");
            infoToggleBtn.classList.add("open");
            infoToggleBtn.innerHTML =
                `<span class="icon">✕</span> Hide Hints`;
        }
    });

    towerFreqInput.addEventListener("input", () => {
        if (!selectedTowerId) return;

        const original = parseFloat(towerFreqInput.dataset.original || "NaN");
        const current = parseFloat(towerFreqInput.value);

        const changed =
            isFinite(current) &&
            current > 0 &&
            isFinite(original) &&
            Math.abs(current - original) > 1e-9;

        if (saveTowerEditsBtn) {
            saveTowerEditsBtn.classList.toggle("hidden", !changed);
        }
    });

    if (saveTowerEditsBtn) {
        saveTowerEditsBtn.addEventListener("click", () => {
            if (selectedTowerId == null) return;

            const val = parseFloat(towerFreqInput.value);
            if (!isFinite(val) || val <= 0) {
                showToast("Please enter a positive frequency in GHz.", true);
                return;
            }

            onTowerFrequencyChanged(selectedTowerId, val);

            towerFreqInput.dataset.original = val.toString();
            saveTowerEditsBtn.classList.add("hidden");

            showToast(`Frequency updated for Tower #${selectedTowerId}.`);
        });
    }

    deleteTowerBtn.addEventListener("click", () => {
        if (selectedTowerId != null) deleteTower(selectedTowerId);
    });

    addTowerBtn.addEventListener("click", () => {
        const lat = parseFloat(addTowerLatInput.value);
        const lng = parseFloat(addTowerLngInput.value);
        const freq = parseFloat(addTowerFreqInput.value);

        if (!isFinite(lat) || !isFinite(lng)) {
            showToast(
                "Please enter a valid latitude and longitude.",
                true
            );
            return;
        }
        if (!isFinite(freq) || freq <= 0) {
            showToast(
                "Please enter a positive frequency in GHz.",
                true
            );
            return;
        }

        addTower([lng, lat], freq);

        addTowerLatInput.value = "";
        addTowerLngInput.value = "";
        addTowerFreqInput.value = "5";

        if (addTowerCard) {
            addTowerCard.classList.remove("open");
            addTowerHeader?.setAttribute("aria-expanded", "false");
        }

        showToast("New tower added successfully.");
    });

    deleteLinkBtn.addEventListener("click", () => {
        if (selectedLinkId != null) deleteLink(selectedLinkId);
    });

    function addOverlaySourcesAndLayers() {
        if (!map.getSource(linkSourceId)) {
            map.addSource(linkSourceId, {
                type: "geojson",
                data: linksGeoJSON
            });
        }

        if (!map.getLayer(linkLayerId)) {
            map.addLayer({
                id: linkLayerId,
                type: "line",
                source: linkSourceId,
                layout: {
                    "line-join": "round",
                    "line-cap": "round"
                },
                paint: {
                    "line-width": ["case", ["==", ["get", "selected"], 1], 4, 2.2],
                    "line-color": [
                        "case",
                        ["==", ["get", "valid"], 1],
                        [
                            "case",
                            ["==", ["get", "selected"], 1],
                            "#f97316",
                            "#22c55e"
                        ],
                        "#ef4444"
                    ],
                    "line-opacity": 0.95
                }
            });
        }

        if (!map.getSource(fresnelSourceId)) {
            map.addSource(fresnelSourceId, {
                type: "geojson",
                data: fresnelGeoJSON
            });
        }

        if (!map.getLayer(fresnelFillLayerId)) {
            map.addLayer({
                id: fresnelFillLayerId,
                type: "fill",
                source: fresnelSourceId,
                paint: {
                    "fill-color": "#f97316",
                    "fill-opacity": FRESNEL_MAX_FILL
                }
            });
        }

        if (!map.getLayer(fresnelOutlineLayerId)) {
            map.addLayer({
                id: fresnelOutlineLayerId,
                type: "line",
                source: fresnelSourceId,
                paint: {
                    "line-color": "#f97316",
                    "line-width": 1.5,
                    "line-dasharray": [2, 2],
                    "line-opacity": 0.9
                }
            });
        }

        const linkSource = map.getSource(linkSourceId);
        if (linkSource) linkSource.setData(linksGeoJSON);
        const fresnelSource = map.getSource(fresnelSourceId);
        if (fresnelSource) fresnelSource.setData(fresnelGeoJSON);

        overlaysReady = true;
    }

    function attachLinkLayerEvents() {
        map.on("click", linkLayerId, (e) => {
            e.originalEvent.stopPropagation();
            suppressNextMapClick = true;

            if (!e.features || !e.features.length) return;
            const feature = e.features[0];
            const linkId = feature.properties.id;
            selectLink(linkId);
        });

        map.on("mousemove", linkLayerId, (e) => {
            if (!e.features || !e.features.length) return;
            map.getCanvas().style.cursor = "pointer";

            const feature = e.features[0];
            const props = feature.properties;
            const distanceM = props.distanceM;
            const freqGHz = props.freqGHz;

            hoverTooltipEl.style.left = e.point.x + "px";
            hoverTooltipEl.style.top = e.point.y + "px";
            hoverTooltipEl.innerHTML = `${formatMeters(
                distanceM
            )} · ${Number(freqGHz).toFixed(2)} GHz`;
            hoverTooltipEl.style.opacity = 1;
        });

        map.on("mouseleave", linkLayerId, () => {
            map.getCanvas().style.cursor = "";
            hoverTooltipEl.style.opacity = 0;
        });
    }

    map.on("click", (e) => {
        if (suppressNextMapClick) {
            suppressNextMapClick = false;
            return;
        }

        if (linkStartTowerId) {
            linkStartTowerId = null;
            updateTowerMarkerStyles();
            setStatus(defaultStatus);
            showToast("Link creation cancelled.");
            if (currentAddPopup) {
                currentAddPopup.remove();
                currentAddPopup = null;
            }
            if (currentTowerPopup) {
                currentTowerPopup.remove();
                currentTowerPopup = null;
            }
            return;
        }

        openAddTowerPopup(e.lngLat);
    });

    attachLinkLayerEvents();

    // ----------------- Guided Tour -----------------
    // ----------------- Guided Tour (detailed) -----------------
    const TOUR_STORAGE_KEY = "rfLinkPlannerTourSeen_v1";

    function shouldRunGuidedTour() {
        try {
            return localStorage.getItem(TOUR_STORAGE_KEY) !== "1";
        } catch (e) {
            return true;
        }
    }

    function markTourDone() {
        try {
            localStorage.setItem(TOUR_STORAGE_KEY, "1");
        } catch (e) { }
    }

    function startGuidedTour() {
        const steps = [
            {
                id: "sidebar",
                title: "Welcome to RF Link Planner",
                text: "This sidebar is your main control hub. You add towers, edit frequencies, and inspect RF links here.",
                placement: "right",
                autoTab: "tower-panel"
            },
            {
                id: "add-tower-card",
                title: "Add towers precisely",
                text: "Use this card to add towers with exact latitude, longitude, and frequency. You can also click on the map to add via a popup.",
                placement: "right",
                autoTab: "tower-panel"
            },
            {
                id: "tower-panel",
                title: "Selected tower details",
                text: "When you click a tower on the map, its coordinates and frequency appear here. Changing the frequency updates all its links.",
                placement: "right",
                autoTab: "tower-panel"
            },
            {
                id: "map",
                title: "Place and link towers on the globe",
                text: "Click anywhere on the map to add a tower. To create a link: click a tower → ‘Link tower’ → click another tower.",
                placement: "center"
            },
            {
                id: "sidebar-tabs",
                title: "Switch between tower and link views",
                text: "Use these tabs to switch between managing individual towers and inspecting point-to-point RF links.",
                placement: "right"
            },
            {
                id: "link-panel",
                title: "Link properties",
                text: "In the Links tab, you’ll see endpoints, shared frequency (channel), path distance, and 1st Fresnel radius at mid-span.",
                placement: "right",
                autoTab: "link-panel"
            },
            {
                id: "link-chart-container",
                title: "Terrain and line-of-sight profile",
                text: "When a link is selected, an elevation profile is fetched from Open-Elevation. You can visually compare terrain and straight line-of-sight.",
                placement: "right",
                autoTab: "link-panel"
            },
            {
                id: "map-style-switcher",
                title: "Change map styles",
                text: "Toggle between Streets, Satellite, and Dark styles. This is useful to see terrain or urban context behind your RF paths.",
                placement: "left"
            },
            {
                id: "info-toggle",
                title: "Hints & quick guidance",
                text: "Open this panel anytime to see short tips about how to use the tool. Great for a quick refresher after the tour.",
                placement: "top"
            },
            {
                id: "status-bar",
                title: "Contextual instructions",
                text: "Watch this status bar for live instructions—especially during link creation and tower selection.",
                placement: "top"
            }
        ];

        let currentStep = 0;
        let overlayEl = null;
        let tooltipEl = null;
        let highlightedEl = null;

        function cleanupHighlight() {
            if (highlightedEl) {
                highlightedEl.classList.remove("tour-highlight");
                highlightedEl = null;
            }
        }

        function endTour() {
            cleanupHighlight();
            if (overlayEl) {
                overlayEl.remove();
                overlayEl = null;
            }
            if (tooltipEl) {
                tooltipEl.remove();
                tooltipEl = null;
            }
            markTourDone();
        }

        function ensureElements() {
            if (!overlayEl) {
                overlayEl = document.createElement("div");
                overlayEl.className = "tour-overlay";
                document.body.appendChild(overlayEl);
            }

            if (!tooltipEl) {
                tooltipEl = document.createElement("div");
                tooltipEl.className = "tour-tooltip";
                document.body.appendChild(tooltipEl);
            }
        }

        function positionTooltip(target, placement) {
            const rect = target.getBoundingClientRect();
            const margin = 10;
            const tooltipRect = tooltipEl.getBoundingClientRect();

            let top = rect.bottom + margin;
            let left = rect.left;

            if (placement === "right") {
                top = rect.top;
                left = rect.right + margin;
            } else if (placement === "left") {
                top = rect.top;
                left = rect.left - tooltipRect.width - margin;
            } else if (placement === "top") {
                top = rect.top - tooltipRect.height - margin;
                left = rect.left;
            } else if (placement === "center") {
                top = rect.top + rect.height / 2 - tooltipRect.height / 2;
                left = rect.left + rect.width / 2 - tooltipRect.width / 2;
            }

            top = Math.max(12, Math.min(window.innerHeight - tooltipRect.height - 12, top));
            left = Math.max(12, Math.min(window.innerWidth - tooltipRect.width - 12, left));

            tooltipEl.style.top = `${top}px`;
            tooltipEl.style.left = `${left}px`;
        }

        function renderStep(index) {
            if (index < 0 || index >= steps.length) {
                endTour();
                return;
            }

            const step = steps[index];

            if (step.autoTab) {
                setActiveTab(step.autoTab);
            }

            const target = document.getElementById(step.id);

            if (!target) {
                currentStep++;
                renderStep(currentStep);
                return;
            }

            ensureElements();
            cleanupHighlight();

            highlightedEl = target;
            highlightedEl.classList.add("tour-highlight");

            target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

            tooltipEl.innerHTML = `
                <div class="tour-tooltip-title">${step.title}</div>
                <div class="tour-tooltip-body">${step.text}</div>
                <div class="tour-tooltip-footer">
                    <div class="tour-tooltip-steps">
                        Step ${index + 1} of ${steps.length}
                    </div>
                    <div>
                        <button class="tour-btn" data-tour="skip">Skip</button>
                        <button class="tour-btn" data-tour="back"${index === 0 ? " disabled" : ""}>Back</button>
                        <button class="tour-btn tour-btn-primary" data-tour="next">
                            ${index === steps.length - 1 ? "Done" : "Next"}
                        </button>
                    </div>
                </div>
            `;

            const skipBtn = tooltipEl.querySelector('[data-tour="skip"]');
            const backBtn = tooltipEl.querySelector('[data-tour="back"]');
            const nextBtn = tooltipEl.querySelector('[data-tour="next"]');

            skipBtn.onclick = () => {
                endTour();
            };

            backBtn.onclick = () => {
                if (currentStep > 0) {
                    currentStep--;
                    renderStep(currentStep);
                }
            };

            nextBtn.onclick = () => {
                if (currentStep === steps.length - 1) {
                    endTour();
                } else {
                    currentStep++;
                    renderStep(currentStep);
                }
            };

            positionTooltip(target, step.placement);
        }

        renderStep(currentStep);
    }


    map.on("load", async () => {
        await zoomPanToIndia(TRANSITION_MS);

        document.body.classList.remove("sidebar-intro-hidden");
        map.resize();

        addOverlaySourcesAndLayers();

        if (shouldRunGuidedTour()) {
            startGuidedTour();
        }
    });

});
