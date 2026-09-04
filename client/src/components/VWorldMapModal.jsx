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

// VWorld's cadastral (지적도) WMS layer isn't actually broken at high camera
// altitude — its server enforces a scale limit and starts returning valid
// 200 OK but blank 1x1 tiles once the requested bbox gets too wide (verified
// by hitting the proxy directly: bbox <= ~0.02deg returns real content,
// > ~0.05deg returns an empty image). We can't override a server-side scale
// rule, so instead we surface *why* the layer disappears once the camera
// climbs past roughly the altitude where that bbox threshold is crossed.
const CADASTRAL_MAX_HEIGHT = 3000;

const toDeg = (rad) => (rad * 180) / Math.PI;
const toRad = (deg) => (deg * Math.PI) / 180;

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

function composeMatrix(Cesium, position, heading, pitch, roll) {
  return Cesium.Transforms.headingPitchRollToFixedFrame(position, new Cesium.HeadingPitchRoll(heading, pitch, roll));
}

let modelCounter = 1;

// --- Gumball gizmo geometry/math ------------------------------------------
// Rhino-style gumball: a translate arrow + rotation ring per axis, world
// East/North/Up aligned (not re-oriented to the model's current rotation —
// simpler, and lets you always nudge heading/pitch/roll independently).
const GIZMO_SEGMENTS = 64;
const GIZMO_AXIS_COLOR = { east: "#ff4d4d", north: "#3ddc63", up: "#3d8bff" };
// Which plane each rotation ring lies in, and which axis's color it borrows.
const GIZMO_RING_AXIS = {
  heading: { normal: "up", a: "east", b: "north" },
  pitch: { normal: "east", a: "north", b: "up" },
  roll: { normal: "north", a: "east", b: "up" },
};

function enuBasis(Cesium, center) {
  const m = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const col = (i) => {
    const c = Cesium.Matrix4.getColumn(m, i, new Cesium.Cartesian4());
    return new Cesium.Cartesian3(c.x, c.y, c.z);
  };
  return { east: col(0), north: col(1), up: col(2) };
}

// model.boundingSphere is a getter that can throw (not just return
// undefined) if accessed before VWorld's bundled Cesium considers the
// model fully ready — fall back to the placement point when that happens.
function modelCenterAndRadius(Cesium, model) {
  try {
    if (model.primitive.ready) {
      const bs = model.primitive.boundingSphere;
      if (bs) return { center: Cesium.Cartesian3.clone(bs.center), radius: bs.radius || 30 };
    }
  } catch {
    // not ready yet — use the placement point below
  }
  return { center: Cesium.Cartesian3.clone(model.position), radius: 30 };
}

function addScaled(Cesium, base, dir, scalar) {
  return Cesium.Cartesian3.add(base, Cesium.Cartesian3.multiplyByScalar(dir, scalar, new Cesium.Cartesian3()), new Cesium.Cartesian3());
}

function circlePoints(Cesium, center, basisA, basisB, radius) {
  const pts = [];
  for (let i = 0; i <= GIZMO_SEGMENTS; i++) {
    const t = (i / GIZMO_SEGMENTS) * Math.PI * 2;
    const offset = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(basisA, radius * Math.cos(t), new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(basisB, radius * Math.sin(t), new Cesium.Cartesian3()),
      new Cesium.Cartesian3()
    );
    pts.push(Cesium.Cartesian3.add(center, offset, new Cesium.Cartesian3()));
  }
  return pts;
}

// Closest point (as scalar distance along axisDir from axisOrigin) between
// the gizmo's axis line and the camera's pick ray — the standard way to
// turn a 2D drag into "move along this 3D line".
function closestTOnAxis(Cesium, axisOrigin, axisDir, rayOrigin, rayDir) {
  const r = Cesium.Cartesian3.subtract(axisOrigin, rayOrigin, new Cesium.Cartesian3());
  const a = Cesium.Cartesian3.dot(axisDir, axisDir);
  const b = Cesium.Cartesian3.dot(axisDir, rayDir);
  const c = Cesium.Cartesian3.dot(rayDir, rayDir);
  const d = Cesium.Cartesian3.dot(axisDir, r);
  const e = Cesium.Cartesian3.dot(rayDir, r);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9) return 0;
  return (b * e - c * d) / denom;
}

// Angle (radians) of where the pick ray crosses the plane through `center`
// with the given normal, measured from basisA toward basisB.
function angleOnPlane(Cesium, center, normal, basisA, basisB, rayOrigin, rayDir) {
  const denom = Cesium.Cartesian3.dot(rayDir, normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = Cesium.Cartesian3.dot(Cesium.Cartesian3.subtract(center, rayOrigin, new Cesium.Cartesian3()), normal) / denom;
  if (t < 0) return null;
  const hit = addScaled(Cesium, rayOrigin, rayDir, t);
  const v = Cesium.Cartesian3.subtract(hit, center, new Cesium.Cartesian3());
  const x = Cesium.Cartesian3.dot(v, basisA);
  const y = Cesium.Cartesian3.dot(v, basisB);
  return Math.atan2(y, x);
}

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
  const [models, setModels] = useState([]); // { id, name, primitive, position, heading, pitch, roll, scale }
  const [selectedModelId, setSelectedModelId] = useState(null);
  // { type: 'place', name, url } | { type: 'move', modelId } — waiting for a map click
  const [pendingAction, setPendingAction] = useState(null);
  const [fov, setFov] = useState(60);
  const [screenshotMode, setScreenshotMode] = useState(false);
  const [ratioLabel, setRatioLabel] = useState("16:9");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [showCadastral, setShowCadastral] = useState(false);
  const [cadastralTooFar, setCadastralTooFar] = useState(false);

  const mapContainerRef = useRef(null);
  const stageRef = useRef(null);
  const viewerRef = useRef(null);
  const cesiumRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const fileInputRef = useRef(null);
  const outlineStageRef = useRef(null);
  const gizmoRef = useRef(null); // { modelId, entities: { [key]: Entity } }
  const gizmoHandlerRef = useRef(null);
  const dragRef = useRef(null);
  const modelsRef = useRef(models);
  const selectedModelIdRef = useRef(selectedModelId);
  const cadastralLayerRef = useRef(null);

  const ratioOption = RATIO_OPTIONS.find((r) => r.label === ratioLabel) || RATIO_OPTIONS[0];
  const selectedModel = models.find((m) => m.id === selectedModelId) || null;

  useEffect(() => {
    modelsRef.current = models;
  }, [models]);
  useEffect(() => {
    selectedModelIdRef.current = selectedModelId;
  }, [selectedModelId]);

  // Runs exactly once for the lifetime of the app (this component is never
  // unmounted), which is required by the SDK's singleton viewer.
  useEffect(() => {
    let cancelled = false;

    waitForVWorldSdk()
      .then((vw) => {
        if (cancelled) return;

        // React 18 StrictMode (dev) mounts every component twice — mount,
        // cleanup, mount again — to catch effects that aren't safe to
        // re-run. VWorld's SDK defines window.ws3d.viewer as a
        // non-redefinable property, so calling new vw.Map()/start() again
        // on that second mount throws "Cannot redefine property: viewer".
        // If a viewer is already up from the first pass, just reuse it.
        if (!window.ws3d?.viewer) {
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
        }

        // window.ws3d.viewer is the live Cesium Viewer once the map starts.
        const waitForViewer = (attempts = 0) => {
          if (cancelled) return;
          if (window.ws3d?.viewer && window.Cesium) {
            viewerRef.current = window.ws3d.viewer;
            cesiumRef.current = window.Cesium;

            // Yellow silhouette on the selected model. Guarded on a window
            // flag (not just a local ref) for the same StrictMode-double-
            // mount reason as the viewer init above — adding this twice
            // would draw two overlapping outlines.
            try {
              if (!window.__vworldOutline) {
                const Cesium = window.Cesium;
                const viewer = window.ws3d.viewer;
                const edgeDetection = Cesium.PostProcessStageLibrary.createEdgeDetectionStage();
                edgeDetection.uniforms.color = Cesium.Color.fromCssColorString("#ffe600");
                edgeDetection.uniforms.length = 0.02;
                edgeDetection.selected = [];
                const silhouette = Cesium.PostProcessStageLibrary.createSilhouetteStage([edgeDetection]);
                viewer.scene.postProcessStages.add(silhouette);
                window.__vworldOutline = edgeDetection;
              }
              outlineStageRef.current = window.__vworldOutline;
            } catch (e) {
              console.warn("VWorld: silhouette outline unavailable", e);
            }

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

  // Click-to-place a new model, or click-to-reposition an existing one.
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    if (clickHandlerRef.current) {
      clickHandlerRef.current.destroy();
      clickHandlerRef.current = null;
    }
    if (!pendingAction) return;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      const cartesian = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
      if (!cartesian) return;

      if (pendingAction.type === "place") {
        const modelMatrix = composeMatrix(Cesium, cartesian, 0, 0, 0);
        const addModel = (model) => {
          model.modelMatrix = modelMatrix;
          model.scale = 1;
          // Always-on black CAD-style edges on every placed model (distinct
          // from the yellow selection outline, which only shows up while
          // the model is selected).
          try {
            model.silhouetteColor = Cesium.Color.BLACK;
            model.silhouetteSize = 1.5;
          } catch {
            // unsupported in this Cesium build — the model still renders fine
          }
          viewer.scene.primitives.add(model);
          const id = `model-${modelCounter++}`;
          setModels((prev) => [
            ...prev,
            { id, name: pendingAction.name, primitive: model, position: cartesian, heading: 0, pitch: 0, roll: 0, scale: 1 },
          ]);
          setSelectedModelId(id);
          setPendingAction(null);

          // model.boundingSphere isn't available the instant it's added —
          // the gumball falls back to the ground click point until then,
          // which can look badly off-center for a tall/offset building.
          // Poll until the real bounding sphere is readable, then nudge
          // state so the gizmo effect recomputes and recenters on it.
          const waitReady = (attempts = 0) => {
            try {
              if (model.ready && model.boundingSphere) {
                setModels((prev) => prev.map((m) => (m.id === id ? { ...m } : m)));
                return;
              }
            } catch {
              // not ready yet
            }
            if (attempts < 50) setTimeout(() => waitReady(attempts + 1), 100);
          };
          waitReady();
        };
        if (Cesium.Model.fromGltfAsync) {
          Cesium.Model.fromGltfAsync({ url: pendingAction.url, modelMatrix }).then(addModel);
        } else {
          addModel(Cesium.Model.fromGltf({ url: pendingAction.url, modelMatrix }));
        }
      } else if (pendingAction.type === "move") {
        setModels((prev) =>
          prev.map((m) => {
            if (m.id !== pendingAction.modelId) return m;
            m.primitive.modelMatrix = composeMatrix(Cesium, cartesian, m.heading, m.pitch, m.roll);
            return { ...m, position: cartesian };
          })
        );
        setPendingAction(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    clickHandlerRef.current = handler;
    return () => {
      handler.destroy();
    };
  }, [pendingAction]);

  // Builds (or, for an already-built gizmo on the same model, repositions
  // in place) the gumball arrows/rings for the selected model, and keeps
  // the silhouette outline in sync with the current selection.
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    const model = models.find((m) => m.id === selectedModelId);

    if (!model) {
      if (gizmoRef.current) {
        Object.values(gizmoRef.current.entities).forEach((e) => viewer.entities.remove(e));
        gizmoRef.current = null;
      }
      if (outlineStageRef.current) outlineStageRef.current.selected = [];
      return;
    }

    const { center, radius } = modelCenterAndRadius(Cesium, model);
    const armLength = radius * 1.8;
    const basis = enuBasis(Cesium, center);
    const dirs = { east: basis.east, north: basis.north, up: basis.up };

    const arrowGeom = {};
    for (const axis of ["east", "north", "up"]) {
      arrowGeom[axis] = { shaft: [center, addScaled(Cesium, center, dirs[axis], armLength)], tip: addScaled(Cesium, center, dirs[axis], armLength) };
    }
    const ringGeom = {};
    for (const key of Object.keys(GIZMO_RING_AXIS)) {
      const { a, b } = GIZMO_RING_AXIS[key];
      ringGeom[key] = circlePoints(Cesium, center, dirs[a], dirs[b], armLength * 0.8);
    }

    if (!gizmoRef.current || gizmoRef.current.modelId !== model.id) {
      if (gizmoRef.current) {
        Object.values(gizmoRef.current.entities).forEach((e) => viewer.entities.remove(e));
      }
      const entities = {};
      for (const axis of ["east", "north", "up"]) {
        const color = Cesium.Color.fromCssColorString(GIZMO_AXIS_COLOR[axis]);
        const shaft = viewer.entities.add({
          polyline: { positions: arrowGeom[axis].shaft, width: 6, material: color, clampToGround: false },
        });
        shaft.gizmoPart = { type: "translate", axis };
        const tip = viewer.entities.add({
          position: arrowGeom[axis].tip,
          point: {
            pixelSize: 14,
            color,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        tip.gizmoPart = { type: "translate", axis };
        entities[`arrow_${axis}_shaft`] = shaft;
        entities[`arrow_${axis}_tip`] = tip;
      }
      for (const key of Object.keys(GIZMO_RING_AXIS)) {
        const color = Cesium.Color.fromCssColorString(GIZMO_AXIS_COLOR[GIZMO_RING_AXIS[key].normal]);
        const ring = viewer.entities.add({
          polyline: { positions: ringGeom[key], width: 4, material: color, clampToGround: false },
        });
        ring.gizmoPart = { type: "rotate", axis: key };
        entities[`ring_${key}`] = ring;
      }
      gizmoRef.current = { modelId: model.id, entities };
    } else {
      const e = gizmoRef.current.entities;
      for (const axis of ["east", "north", "up"]) {
        e[`arrow_${axis}_shaft`].polyline.positions = arrowGeom[axis].shaft;
        e[`arrow_${axis}_tip`].position = arrowGeom[axis].tip;
      }
      for (const key of Object.keys(GIZMO_RING_AXIS)) {
        e[`ring_${key}`].polyline.positions = ringGeom[key];
      }
    }

    if (outlineStageRef.current) outlineStageRef.current.selected = [model.primitive];
  }, [selectedModelId, models]);

  // Drag-to-translate (arrows) / drag-to-rotate (rings) on the gumball.
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    if (gizmoHandlerRef.current) {
      gizmoHandlerRef.current.destroy();
      gizmoHandlerRef.current = null;
    }
    if (!selectedModelId) return;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const controller = viewer.scene.screenSpaceCameraController;

    handler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.position);
      const part = picked?.id?.gizmoPart;
      if (!part) return;

      const model = modelsRef.current.find((m) => m.id === selectedModelIdRef.current);
      if (!model) return;

      const { center } = modelCenterAndRadius(Cesium, model);
      const basis = enuBasis(Cesium, center);
      const ray = viewer.camera.getPickRay(movement.position);
      if (!ray) return;

      controller.enableInputs = false;

      if (part.type === "translate") {
        const axisDir = basis[part.axis];
        const startT = closestTOnAxis(Cesium, center, axisDir, ray.origin, ray.direction);
        dragRef.current = { type: "translate", axisDir, center, startT, startPosition: Cesium.Cartesian3.clone(model.position) };
      } else {
        const { normal, a, b } = GIZMO_RING_AXIS[part.axis];
        const startAngle = angleOnPlane(Cesium, center, basis[normal], basis[a], basis[b], ray.origin, ray.direction);
        if (startAngle == null) return;
        dragRef.current = {
          type: "rotate",
          axis: part.axis,
          center,
          normal: basis[normal],
          a: basis[a],
          b: basis[b],
          startAngle,
          startHeading: model.heading,
          startPitch: model.pitch,
          startRoll: model.roll,
        };
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((movement) => {
      const drag = dragRef.current;
      if (!drag) return;
      const model = modelsRef.current.find((m) => m.id === selectedModelIdRef.current);
      if (!model) return;
      const ray = viewer.camera.getPickRay(movement.endPosition);
      if (!ray) return;

      if (drag.type === "translate") {
        const t = closestTOnAxis(Cesium, drag.center, drag.axisDir, ray.origin, ray.direction);
        const newPosition = addScaled(Cesium, drag.startPosition, drag.axisDir, t - drag.startT);
        model.primitive.modelMatrix = composeMatrix(Cesium, newPosition, model.heading, model.pitch, model.roll);
        setModels((prev) => prev.map((m) => (m.id === model.id ? { ...m, position: newPosition } : m)));
      } else {
        const angle = angleOnPlane(Cesium, drag.center, drag.normal, drag.a, drag.b, ray.origin, ray.direction);
        if (angle == null) return;
        const delta = angle - drag.startAngle;
        const patch = {};
        if (drag.axis === "heading") patch.heading = drag.startHeading + delta;
        if (drag.axis === "pitch") patch.pitch = drag.startPitch + delta;
        if (drag.axis === "roll") patch.roll = drag.startRoll + delta;
        const next = { ...model, ...patch };
        model.primitive.modelMatrix = composeMatrix(Cesium, next.position, next.heading, next.pitch, next.roll);
        setModels((prev) => prev.map((m) => (m.id === model.id ? next : m)));
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      if (dragRef.current) {
        dragRef.current = null;
        controller.enableInputs = true;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    gizmoHandlerRef.current = handler;
    return () => {
      handler.destroy();
      if (controller) controller.enableInputs = true;
    };
  }, [selectedModelId]);

  // Cesium sizes its canvas off window 'resize' events, which don't fire
  // when this modal's container goes from display:none back to visible —
  // nudge it so the map isn't left at a stale, possibly-mismatched size.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Screenshot framing and any pending place/move click are transient —
  // reset them whenever the modal is closed so reopening starts clean.
  useEffect(() => {
    if (!open) {
      setScreenshotMode(false);
      setPendingAction(null);
    }
  }, [open]);

  // While the cadastral layer is on, watch camera altitude so we can tell
  // the user *why* it just disappeared instead of leaving it looking broken.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!showCadastral || !viewer) {
      setCadastralTooFar(false);
      return;
    }
    const checkHeight = () => {
      const height = viewer.camera.positionCartographic?.height ?? 0;
      setCadastralTooFar(height > CADASTRAL_MAX_HEIGHT);
    };
    checkHeight();
    viewer.camera.changed.addEventListener(checkHeight);
    const prevPercentageChanged = viewer.camera.percentageChanged;
    viewer.camera.percentageChanged = 0.05;
    return () => {
      viewer.camera.changed.removeEventListener(checkHeight);
      viewer.camera.percentageChanged = prevPercentageChanged;
    };
  }, [showCadastral]);

  function handleAddModelFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPendingAction({ type: "place", name: file.name, url });
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
    if (selectedModelId === m.id) setSelectedModelId(null);
  }

  // Applies a heading/pitch/roll/scale patch to a placed model and
  // re-renders its transform immediately.
  function updateTransform(modelId, patch) {
    const Cesium = cesiumRef.current;
    setModels((prev) =>
      prev.map((m) => {
        if (m.id !== modelId) return m;
        const next = { ...m, ...patch };
        m.primitive.modelMatrix = composeMatrix(Cesium, next.position, next.heading, next.pitch, next.roll);
        m.primitive.scale = next.scale;
        return next;
      })
    );
  }

  function applyFov(deg) {
    setFov(deg);
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (viewer?.camera?.frustum && Cesium) {
      viewer.camera.frustum.fov = Cesium.Math.toRadians(deg);
    }
  }

  // VWorld's own cadastral (지적도) toggle isn't exposed anywhere in the
  // public SDK either — this adds/removes VWorld's public WMS cadastral
  // layer (lp_pa_cbnd_bubun) as a plain Cesium imagery layer instead,
  // proxied through the server since the WMS endpoint has no CORS headers.
  // Note: the layer only renders close to the ground — see
  // CADASTRAL_MAX_HEIGHT above for why, that's a server-side scale limit.
  function toggleCadastral(next) {
    setShowCadastral(next);
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium) return;

    if (next) {
      if (cadastralLayerRef.current) return;
      const provider = new Cesium.WebMapServiceImageryProvider({
        url: `${window.location.origin}/api/vworld/wms`,
        layers: "lp_pa_cbnd_bubun",
        parameters: {
          SERVICE: "WMS",
          VERSION: "1.3.0",
          REQUEST: "GetMap",
          STYLES: "lp_pa_cbnd_bubun",
          FORMAT: "image/png",
          TRANSPARENT: true,
        },
        crs: "EPSG:4326",
      });
      cadastralLayerRef.current = viewer.imageryLayers.addImageryProvider(provider);
    } else if (cadastralLayerRef.current) {
      viewer.imageryLayers.remove(cadastralLayerRef.current);
      cadastralLayerRef.current = null;
    }
    viewer.scene.requestRender();
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
      setScreenshotMode(false);
      closeVWorldMap();
    } catch (err) {
      setError(err.message);
    } finally {
      setCapturing(false);
    }
  }

  const overlayBox = screenshotMode && ratioOption.value ? fitBoxForRatio(ratioOption.value, 1, 1) : null;

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
            {screenshotMode ? (
              <>
                <div className="layers-title">Screenshot mode</div>
                <div className="hint">
                  Pick a ratio below and pan/zoom the map to frame the shot, then Capture. Cancel to go back to
                  editing.
                </div>
              </>
            ) : (
              <>
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
                {pendingAction?.type === "place" ? (
                  <div className="hint">Click on the map to place "{pendingAction.name}"...</div>
                ) : null}
                {pendingAction?.type === "move" ? <div className="hint">Click on the map to move the model...</div> : null}

                {models.map((m) => (
                  <div
                    className={`layer-row vworld-model-row${m.id === selectedModelId ? " selected" : ""}`}
                    key={m.id}
                    onClick={() => setSelectedModelId((prev) => (prev === m.id ? null : m.id))}
                  >
                    <span className="layer-name">{m.name}</span>
                    <button
                      className="layer-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        focusModel(m);
                      }}
                      title="Focus"
                    >
                      ⌖
                    </button>
                    <button
                      className="layer-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeModel(m);
                      }}
                      title="Remove"
                    >
                      🗑
                    </button>
                  </div>
                ))}

                {selectedModel ? (
                  <div className="vworld-transform">
                    <div className="layers-title" style={{ marginTop: 16 }}>
                      Transform: {selectedModel.name}
                    </div>
                    <button
                      className="btn secondary"
                      onClick={() => setPendingAction({ type: "move", modelId: selectedModel.id })}
                    >
                      {pendingAction?.type === "move" && pendingAction.modelId === selectedModel.id
                        ? "Click map to place..."
                        : "📍 Move (click map)"}
                    </button>

                    <label>Heading {Math.round(toDeg(selectedModel.heading))}°</label>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={toDeg(selectedModel.heading)}
                      onChange={(e) => updateTransform(selectedModel.id, { heading: toRad(Number(e.target.value)) })}
                    />

                    <label>Pitch {Math.round(toDeg(selectedModel.pitch))}°</label>
                    <input
                      type="range"
                      min="-90"
                      max="90"
                      value={toDeg(selectedModel.pitch)}
                      onChange={(e) => updateTransform(selectedModel.id, { pitch: toRad(Number(e.target.value)) })}
                    />

                    <label>Roll {Math.round(toDeg(selectedModel.roll))}°</label>
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      value={toDeg(selectedModel.roll)}
                      onChange={(e) => updateTransform(selectedModel.id, { roll: toRad(Number(e.target.value)) })}
                    />

                    <label>Scale {selectedModel.scale.toFixed(2)}×</label>
                    <input
                      type="range"
                      min="0.1"
                      max="10"
                      step="0.1"
                      value={selectedModel.scale}
                      onChange={(e) => updateTransform(selectedModel.id, { scale: Number(e.target.value) })}
                    />

                    <button
                      className="btn secondary"
                      onClick={() => updateTransform(selectedModel.id, { heading: 0, pitch: 0, roll: 0, scale: 1 })}
                    >
                      Reset transform
                    </button>
                  </div>
                ) : null}

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

                <div className="layers-title" style={{ marginTop: 16 }}>
                  Map layers
                </div>
                <label className="vworld-toggle">
                  <input
                    type="checkbox"
                    checked={showCadastral}
                    onChange={(e) => toggleCadastral(e.target.checked)}
                    disabled={status !== "ready"}
                  />
                  Cadastral map (지적도)
                </label>
                {showCadastral && cadastralTooFar ? (
                  <div className="hint">
                    Hidden at this altitude — VWorld's server only renders parcel data when the camera is close to
                    the ground. Zoom in to bring it back.
                  </div>
                ) : null}
              </>
            )}

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
            <input type="range" min="10" max="120" value={fov} onChange={(e) => applyFov(Number(e.target.value))} />
            <span>{fov}°</span>
            <button className="btn secondary" onClick={() => applyFov(60)} title="Reset FOV">
              ⟲
            </button>
          </div>

          {screenshotMode ? (
            <>
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
              <button className="btn secondary" onClick={() => setScreenshotMode(false)} disabled={capturing}>
                Cancel
              </button>
              <button className="btn vworld-capture-btn" onClick={handleCapture} disabled={status !== "ready" || capturing}>
                {capturing ? "Capturing..." : "✓ Take Screenshot"}
              </button>
            </>
          ) : (
            <button
              className="btn vworld-capture-btn"
              onClick={() => setScreenshotMode(true)}
              disabled={status !== "ready"}
            >
              📷 Capture
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
