import { getSetting, setSetting } from "./api";

export const ELK_SETTING_KEY = "elk_config";

export interface ElkConfig {
  url?: string;
  indexPattern?: string;
  authType?: "none" | "basic" | "apikey";
  username?: string;
  password?: string;
  apiKey?: string;
}

const DEFAULT: ElkConfig = {
  url: "",
  indexPattern: "*",
  authType: "none",
};

export async function readElkConfig(): Promise<ElkConfig> {
  return getSetting<ElkConfig>(ELK_SETTING_KEY, DEFAULT);
}

export async function writeElkConfig(cfg: ElkConfig) {
  return setSetting(ELK_SETTING_KEY, cfg);
}

export function buildAuthHeaders(
  cfg: ElkConfig
): Record<string, string> {
  if (cfg.authType === "basic" && cfg.username && cfg.password) {
    const b64 = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
    return { Authorization: `Basic ${b64}` };
  }
  if (cfg.authType === "apikey" && cfg.apiKey) {
    return { Authorization: `ApiKey ${cfg.apiKey}` };
  }
  return {};
}

export function intervalForRange(fromMs: number, toMs: number): string {
  const ms = toMs - fromMs;
  if (ms <= 20 * 60_000) return "30s";
  if (ms <= 2 * 3600_000) return "1m";
  if (ms <= 8 * 3600_000) return "5m";
  if (ms <= 48 * 3600_000) return "30m";
  return "3h";
}
