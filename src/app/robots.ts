import type { MetadataRoute } from "next";
import { env } from "@/server/env";

// Lists only public pages. The admin path is deliberately absent: naming it here would publish it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/privacy"], disallow: ["/api/"] },
    sitemap: `${env.SITE_URL}/sitemap.xml`,
  };
}
