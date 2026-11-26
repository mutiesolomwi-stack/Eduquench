import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eduquench", short_name: "Eduquench", start_url: "/dashboard", display: "standalone",
    theme_color: "#0B3D91", background_color: "#E8F6FF",
    icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
  };
}
