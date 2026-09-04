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
