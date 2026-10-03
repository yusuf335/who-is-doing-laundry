import type { MetadataRoute } from "next";

/**
 * Lets the app be added to a phone's home screen. On iPhone that is not optional for
 * notifications: Safari only offers Web Push to a site opened from the Home Screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Who is doing laundry?",
    short_name: "Laundry",
    description: "See at a glance whether a machine is available, and book your slot.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
