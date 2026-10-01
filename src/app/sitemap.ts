import type { MetadataRoute } from "next";
import { env } from "@/server/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${env.SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${env.SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
