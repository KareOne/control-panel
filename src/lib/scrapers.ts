import { getSetting, setSetting } from "./api";

export const SCRAPERS_CONFIG_KEY = "scrapers_config";

export interface ScraperEntry {
  url: string;
  healthPath: string;
}

export interface ScrapersConfig {
  orchestratorUrl: string;
  services: Record<string, ScraperEntry>;
}

export const DEFAULT_SCRAPERS_CONFIG: ScrapersConfig = {
  orchestratorUrl: "http://localhost:8010",
  services: {
    crunchbase:    { url: "http://localhost:8003", healthPath: "/health" },
    tracxn:        { url: "http://localhost:8008", healthPath: "/health" },
    twitter:       { url: "http://localhost:8007", healthPath: "/health" },
    "news-search": { url: "http://localhost:3001", healthPath: "/api/health" },
  },
};

export async function readScrapersConfig(): Promise<ScrapersConfig> {
  return getSetting<ScrapersConfig>(SCRAPERS_CONFIG_KEY, DEFAULT_SCRAPERS_CONFIG);
}

export async function writeScrapersConfig(cfg: ScrapersConfig): Promise<void> {
  await setSetting(SCRAPERS_CONFIG_KEY, cfg);
}
