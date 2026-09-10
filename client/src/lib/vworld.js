// The VWorld SDK script tag lives statically in index.html (see the
// comment there for why) and loads asynchronously in the background via
// nested document.write()'d <script> tags. This just waits for the
// globals it eventually defines: window.vw, window.ws3d, window.Cesium.
export function waitForVWorldSdk(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (window.vw && window.Cesium) {
        resolve(window.vw);
        return;
      }
      if (window.vworldIsValid === "false") {
        reject(new Error(window.vworldErrMsg || "VWorld rejected the API key."));
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            "VWorld SDK did not load in time. Check that VWORLD_API_KEY in server/.env is set and that this domain is registered for it in VWorld MyPortal."
          )
        );
        return;
      }
      setTimeout(poll, 150);
    };
    poll();
  });
}

function buildingKey(feature) {
  for (const property of ['TD_ID', 'MODEL_NAME']) {
    const value = feature.getProperty(property);
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim() !== '') {
      return `${property}:${String(value).trim()}`;
    }
  }
  return null;
}

// tileLoad is too early: Cesium applies its style afterwards, and cached
// LOD tiles can become visible without loading again. Apply after styling
// in tileVisible, including composite contents and nested collections.
export function createBuildingVisibility(scene) {
  const hidden = new Set();
  const previousVisibility = new WeakMap();
  const tilesets = new Map();

  function applyFeature(feature) {
    const key = buildingKey(feature);
    if (key && hidden.has(key)) {
      if (!previousVisibility.has(feature)) previousVisibility.set(feature, feature.show);
      feature.show = false;
    } else if (previousVisibility.has(feature)) {
      feature.show = previousVisibility.get(feature);
      previousVisibility.delete(feature);
    }
  }

  function applyContent(content) {
    if (!content) return;
    for (const inner of content.innerContents || []) applyContent(inner);
    if (typeof content.getFeature !== 'function') return;
    for (let i = 0; i < content.featuresLength; i++) applyFeature(content.getFeature(i));
  }

  function scan() {
    const present = new Set();
    function visit(primitive) {
      if (!primitive || primitive.isDestroyed?.()) return;
      if (primitive.tileVisible?.addEventListener && primitive.tileUnload?.addEventListener) {
        present.add(primitive);
        if (!tilesets.has(primitive)) {
          const liveTiles = new Set();
          const removeVisible = primitive.tileVisible.addEventListener((tile) => {
            liveTiles.add(tile);
            applyContent(tile.content);
          });
          const removeUnload = primitive.tileUnload.addEventListener((tile) => liveTiles.delete(tile));
          tilesets.set(primitive, { liveTiles, dispose() { removeVisible(); removeUnload(); } });
        }
      } else if (typeof primitive.get === 'function' && typeof primitive.length === 'number') {
        for (let i = 0; i < primitive.length; i++) visit(primitive.get(i));
      }
    }
    visit(scene.primitives);
    for (const [primitive, state] of tilesets) {
      if (!present.has(primitive)) {
        state.dispose();
        tilesets.delete(primitive);
      }
    }
  }

  function refresh() {
    scan();
    for (const { liveTiles } of tilesets.values()) {
      for (const tile of liveTiles) applyContent(tile.content);
    }
    scene.requestRender();
  }

  scan();
  const removeScan = scene.preRender.addEventListener(scan);
  return {
    hide(feature) {
      const key = buildingKey(feature);
      if (!key) return null;
      hidden.add(key);
      applyFeature(feature);
      refresh();
      return key;
    },
    restore(key) {
      hidden.delete(key);
      refresh();
    },
    restoreAll() {
      hidden.clear();
      refresh();
    },
    dispose() {
      removeScan();
      for (const state of tilesets.values()) state.dispose();
      tilesets.clear();
    },
  };
}
