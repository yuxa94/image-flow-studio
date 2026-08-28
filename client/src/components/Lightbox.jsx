import { useEffect } from "react";
import { useStore } from "../lib/store.js";
import { downloadDataUrl } from "../lib/imageUtils.js";

export default function Lightbox() {
  const lightboxImage = useStore((s) => s.lightboxImage);
  const closeLightbox = useStore((s) => s.closeLightbox);

  useEffect(() => {
    if (!lightboxImage) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxImage, closeLightbox]);

  if (!lightboxImage) return null;

  return (
    <div className="lightbox-overlay" onClick={closeLightbox}>
      <button className="lightbox-close" onClick={closeLightbox} title="Close (Esc)">
        ✕
      </button>
      <button
        className="lightbox-download"
        title="Download"
        onClick={(e) => {
          e.stopPropagation();
          downloadDataUrl(lightboxImage, `image-${Date.now()}.png`);
        }}
      >
        ⬇ Download
      </button>
      <img
        src={lightboxImage}
        alt="full size"
        className="lightbox-image"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
