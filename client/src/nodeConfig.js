export const PALETTE = [
  {
    section: "DATA",
    items: [
      {
        type: "image",
        title: "Image",
        subtitle: "Input image",
        defaultData: () => ({ image: null }),
      },
    ],
  },
  {
    section: "GENERATOR",
    items: [
      {
        type: "imagine",
        title: "Imagine",
        subtitle: "Gemini AI generation",
        defaultData: () => ({
          prompt: "",
          ratio: "AUTO",
          resolution: "AUTO",
          baseImage: null,
          refImage: null,
          output: null,
        }),
      },
    ],
  },
  {
    section: "TOOL",
    items: [
      {
        type: "crop",
        title: "Crop",
        subtitle: "Crop an image",
        defaultData: () => ({ input: null, output: null, ratio: "1:1" }),
      },
      {
        type: "merge",
        title: "Merge",
        subtitle: "Overlay multiple images",
        defaultData: () => ({ output: null }),
      },
      {
        type: "upscale",
        title: "Upscale",
        subtitle: "AI / local enhancement",
        defaultData: () => ({ input: null, output: null, mode: "fast", factor: 2 }),
      },
    ],
  },
];
