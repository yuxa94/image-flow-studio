import { useStore } from "../lib/store.js";
import { downloadDataUrl } from "../lib/imageUtils.js";

export default function ImagePreview({ src, alt = "image", empty, downloadable = false, filename = "image.png", style }) {
  const openLightbox = useStore((s) => s.openLightbox);

  if (!src) {
    return (
      <div className="image-preview empty" style={style}>
        {empty}
      </div>
    );
  }

  return (
    <div className="image-preview" style={style} onClick={() => openLightbox(src)}>
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
