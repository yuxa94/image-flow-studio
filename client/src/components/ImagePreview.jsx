import { useStore } from "../lib/store.js";
import { downloadDataUrl } from "../lib/imageUtils.js";

// `onOpen` replaces the default click behavior (the plain lightbox), e.g. so
// the Adjust node can open its own enlarged editor instead.
export default function ImagePreview({ src, alt = "image", empty, downloadable = false, filename = "image.png", style, onOpen }) {
  const openLightbox = useStore((s) => s.openLightbox);

  if (!src) {
    return (
      <div className="image-preview empty" style={style}>
        {empty}
      </div>
    );
  }

  return (
    <div className="image-preview" style={style} onClick={() => (onOpen ? onOpen() : openLightbox(src))}>
      <img src={src} alt={alt} />
      {downloadable ? (
        <button
          className="preview-download-btn"
          title="Download"
          onClick={(e) => {
            e.stopPropagation();
            downloadDataUrl(src, filename);
          }}
        >
          ⬇
        </button>
      ) : null}
    </div>
  );
}
