import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { waitForVWorldSdk } from "../lib/vworld.js";
import { cropImage } from "../lib/imageUtils.js";
import { ASPECT_RATIOS } from "../lib/ratios.js";
import { useStore } from "../lib/store.js";

const RATIO_OPTIONS = [{ label: "AUTO (full view)", value: null }, ...ASPECT_RATIOS];

// Default view: roughly Gangnam, Seoul.
const DEFAULT_LON = 127.027619;
const DEFAULT_LAT = 37.497926;
const DEFAULT_ALT = 1500;

function fitBoxForRatio(ratio, containerW, containerH) {
  if (!ratio) return { xPct: 0, yPct: 0, wPct: 1, hPct: 1 };
  let w = containerH * ratio;
  let h = containerH;
  if (w > containerW) {
    w = containerW;
    h = containerW / ratio;
  }
  return {
    xPct: (containerW - w) / 2 / containerW,
    yPct: (containerH - h) / 2 / containerH,
    wPct: w / containerW,
    hPct: h / containerH,
  };
}

let modelCounter = 1;

// This modal is mounted exactly once at the App level and never unmounted —
// VWorld's SDK defines window.ws3d.viewer as a non-redefinable property, so
// re-running new vw.Map()/start() after a React unmount+remount throws
// "Cannot redefine property: viewer". Instead, "closing" this modal just
// hides it with CSS so the underlying map/canvas stays alive across opens.
export default function VWorldMapModal() {
  const open = useStore((s) => s.vworldOpen);
  const targetNodeId = useStore((s) => s.vworldTargetNodeId);
  const closeVWorldMap = useStore((s) => s.closeVWorldMap);
  const setNodeOutput = useStore((s) => s.setNodeOutput);

  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [models, setModels] = useState([]); // { id, name, primitive }
  const [placing, setPlacing] = useState(null); // { name, url } while waiting for a map click
  const [fov, setFov] = useState(60);
  const [ratioLabel, setRatioLabel] = useState("16:9");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const mapContainerRef = useRef(null);
  const stageRef = useRef(null);
  const viewerRef = useRef(null);
  const cesiumRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const fileInputRef = useRef(null);

  const ratioOption = RATIO_OPTIONS.find((r) => r.label === ratioLabel) || RATIO_OPTIONS[0];

  // Runs exactly once for the lifetime of the app (this component is never
  // unmounted), which is required by the SDK's singleton viewer.
  useEffect(() => {
    let cancelled = false;

    waitForVWorldSdk()
      .then((vw) => {
        if (cancelled) return;
        const map = new vw.Map();
        map.setOption({
          mapId: "vworld-map-canvas",
          initPosition: new vw.CameraPosition(
            new vw.CoordZ(DEFAULT_LON, DEFAULT_LAT, DEFAULT_ALT),
            new vw.Direction(0, -90, 0)
          ),
          logo: false,
          navigation: true,
        });
        map.start();

        // window.ws3d.viewer is the live Cesium Viewer once the map starts.
        const waitForViewer = (attempts = 0) => {
          if (cancelled) return;
          if (window.ws3d?.viewer && window.Cesium) {
            viewerRef.current = window.ws3d.viewer;
            cesiumRef.current = window.Cesium;
            setStatus("ready");
          } else if (attempts < 100) {
            setTimeout(() => waitForViewer(attempts + 1), 100);
          } else {
            setError("VWorld map failed to initialize (viewer not ready).");
            setStatus("error");
          }
        };
        waitForViewer();
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Click-to-place a pending model on the globe.
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    if (clickHandlerRef.current) {
      clickHandlerRef.current.destroy();
      clickHandlerRef.current = null;
    }
    if (!placing) return;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;

      const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(cartesian);
      const addModel = (model) => {
        model.modelMatrix = modelMatrix;
        viewer.scene.primitives.add(model);
        setModels((prev) => [
          ...prev,
          { id: `model-${modelCounter++}`, name: placing.name, primitive: model, position: cartesian },
        ]);
        setPlacing(null);
      };

      if (Cesium.Model.fromGltfAsync) {
        Cesium.Model.fromGltfAsync({ url: placing.url, modelMatrix }).then(addModel);
      } else {
        addModel(Cesium.Model.fromGltf({ url: placing.url, modelMatrix }));
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    clickHandlerRef.current = handler;
    return () => {
      handler.destroy();
    };
  }, [placing]);

  // Cesium sizes its canvas off window 'resize' events, which don't fire
  // when this modal's container goes from display:none back to visible —
  // nudge it so the map isn't left at a stale, possibly-mismatched size.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    return () => clearTimeout(t);
  }, [open]);

  function handleAddModelFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPlacing({ name: file.name, url });
  }

  function focusModel(m) {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || !m.position) return;
    const carto = Cesium.Cartographic.fromCartesian(m.position);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height + 400),
    });
  }

  function removeModel(m) {
    const viewer = viewerRef.current;
    if (viewer) viewer.scene.primitives.remove(m.primitive);
    setModels((prev) => prev.filter((x) => x.id !== m.id));
  }

  function applyFov(deg) {
    setFov(deg);
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (viewer?.camera?.frustum && Cesium) {
      viewer.camera.frustum.fov = Cesium.Math.toRadians(deg);
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(`/api/vworld/search?query=${encodeURIComponent(searchQuery)}`);
      const json = await res.json();
      const items = json?.response?.result?.items || [];
      setSearchResults(items);
      if (!items.length) setError("No address results found.");
      else setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function goToResult(item) {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    const x = Number(item?.point?.x);
    const y = Number(item?.point?.y);
    if (!viewer || !Cesium || Number.isNaN(x) || Number.isNaN(y)) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(x, y, 800),
    });
    setSearchResults([]);
  }

  async function handleCapture() {
    const viewer = viewerRef.current;
    if (!viewer || !targetNodeId) return;
    setCapturing(true);
    try {
      // window.ws3d.viewer.scene.canvas can be a stale/detached 0x0 canvas —
      // VWorld swaps in the real WebGL canvas as a plain child of the map
      // div, so grab that one directly instead of trusting the viewer ref.
      const canvas = mapContainerRef.current?.querySelector("canvas") || viewer.scene.canvas;
      viewer.render();
      const fullDataUrl = canvas.toDataURL("image/png");

      let result = fullDataUrl;
      if (ratioOption.value) {
        const rect = stageRef.current.getBoundingClientRect();
        const box = fitBoxForRatio(ratioOption.value, rect.width, rect.height);
        result = await cropImage(fullDataUrl, box);
      }
      setNodeOutput(targetNodeId, result);
      closeVWorldMap();
    } catch (err) {
      setError(err.message);
    } finally {
      setCapturing(false);
    }
  }

  const overlayBox = ratioOption.value ? fitBoxForRatio(ratioOption.value, 1, 1) : null;

  return createPortal(
    <div className="vworld-overlay" hidden={!open}>
      <div className="vworld-modal">
        <div className="vworld-header">
          <span>VWorld — 3D Map</span>
          <button className="editcanvas-close" onClick={closeVWorldMap} title="Close">
            ✕
          </button>
        </div>

        <div className="vworld-body">
          <div className="vworld-side">
            <div className="layers-title">Model placement ({models.length})</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".glb,.gltf"
              style={{ display: "none" }}
              onChange={(e) => {
                handleAddModelFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button className="btn secondary" onClick={() => fileInputRef.current?.click()} disabled={status !== "ready"}>
              + Add .glb model
            </button>
            {placing ? <div className="hint">Click on the map to place "{placing.name}"...</div> : null}

            {models.map((m) => (
              <div className="layer-row" key={m.id}>
                <span className="layer-name">{m.name}</span>
                <button className="layer-btn" onClick={() => focusModel(m)} title="Focus">
                  ⌖
                </button>
                <button className="layer-btn" onClick={() => removeModel(m)} title="Remove">
                  🗑
                </button>
              </div>
            ))}

            <div className="layers-title" style={{ marginTop: 16 }}>
              Address search
            </div>
            <div className="row">
              <input
                className="node-input"
                placeholder="e.g. 테헤란로 152"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <button className="btn secondary" onClick={handleSearch} disabled={searching || status !== "ready"}>
              {searching ? "Searching..." : "Search"}
            </button>
            {searchResults.map((item, i) => (
              <div className="layer-row" key={i} style={{ cursor: "pointer" }} onClick={() => goToResult(item)}>
                <span className="layer-name">{item?.address?.road || item?.address?.parcel || item?.title}</span>
              </div>
            ))}

            {error ? <div className="error-text">{error}</div> : null}
          </div>

          <div className="vworld-stage">
            {status === "loading" ? <div className="vworld-status">Loading VWorld map...</div> : null}
            {status === "error" ? <div className="vworld-status error-text">{error}</div> : null}
            <div id="vworld-map-canvas" ref={mapContainerRef} className="vworld-canvas" />
            <div className="vworld-capture-guide" ref={stageRef}>
              {overlayBox ? (
                <div
                  className="crop-rect"
                  style={{
                    left: `${overlayBox.xPct * 100}%`,
                    top: `${overlayBox.yPct * 100}%`,
                    width: `${overlayBox.wPct * 100}%`,
                    height: `${overlayBox.hPct * 100}%`,
                    pointerEvents: "none",
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="vworld-footer">
          <div className="vworld-fov">
            <label>FOV</label>
            <input
              type="range"
              min="10"
              max="120"
              value={fov}
              onChange={(e) => applyFov(Number(e.target.value))}
            />
            <span>{fov}°</span>
            <button className="btn secondary" onClick={() => applyFov(60)} title="Reset FOV">
              ⟲
            </button>
          </div>

          <div className="vworld-ratio">
            <label>Capture ratio</label>
            <select className="node-select" value={ratioLabel} onChange={(e) => setRatioLabel(e.target.value)}>
              {RATIO_OPTIONS.map((r) => (
                <option key={r.label} value={r.label}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <button className="btn vworld-capture-btn" onClick={handleCapture} disabled={status !== "ready" || capturing}>
            {capturing ? "Capturing..." : "📷 Capture"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
