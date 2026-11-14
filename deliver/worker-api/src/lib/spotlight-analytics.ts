import type { Env } from "../types";
import { localDay } from "./db";

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = typeof ANALYTICS_RANGES[number];

export function parseRange(value: unknown): AnalyticsRange {
  const n = Number(value);
  return (ANALYTICS_RANGES as readonly number[]).includes(n) ? n as AnalyticsRange : 30;
}

const SOURCES = ["direct", "directory", "featured", "search", "social", "other"] as const;

/**
 * Real per-profile analytics read from the daily aggregates. The caller must already have established which
 * profile is being asked about (owner token hash lookup, or an admin session); this function never resolves
 * identity itself.
 *
 * Definitions (kept identical in the UI):
 *  - featured_impressions: the profile was on screen in the Featured stage or a featured card
 *  - views: a visit to the individual profile page
 *  - link clicks: outbound clicks, split into website / social / media
 *  - player_interactions: a deliberate click on the Featured player's play button (never autoplay)
 *  - completed_plays: a play that reached the end (YouTube only; other providers do not report it)
 */
export async function profileAnalytics(env: Env, profileId: string, days: AnalyticsRange, nowSeconds = Math.floor(Date.now() / 1000)) {
  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) dayList.push(localDay(env, nowSeconds - i * 86400));
  const start = dayList[0]!;
  const rows = await env.DB.prepare(
    `SELECT day,views,unique_views,outbound_clicks,website_clicks,social_clicks,media_clicks,featured_impressions,player_interactions,completed_plays
       FROM spotlight_daily_metrics WHERE profile_id=? AND day>=? ORDER BY day`,
  ).bind(profileId, start).all<any>();
  const byDay = new Map<string, any>((rows.results || []).map((row: any) => [row.day, row]));
  const series = dayList.map(day => {
    const r = byDay.get(day);
    return {
      day,
      featured_impressions: Number(r?.featured_impressions || 0),
      views: Number(r?.views || 0),
      unique_views: Number(r?.unique_views || 0),
      link_clicks: Number(r?.outbound_clicks || 0),
      player_interactions: Number(r?.player_interactions || 0),
      completed_plays: Number(r?.completed_plays || 0),
    };
  });
  const sum = (key: string) => (rows.results || []).reduce((total: number, row: any) => total + Number(row[key] || 0), 0);
  const totals = {
    featured_impressions: sum("featured_impressions"),
    views: sum("views"),
    unique_views: sum("unique_views"), // sum of daily uniques: a person visiting on two days counts twice
    link_clicks: sum("outbound_clicks"),
    website_clicks: sum("website_clicks"),
    social_clicks: sum("social_clicks"),
    media_clicks: sum("media_clicks"),
    player_interactions: sum("player_interactions"),
    completed_plays: sum("completed_plays"),
  };
  const sourceRows = await env.DB.prepare("SELECT source,SUM(views) AS views FROM spotlight_source_daily WHERE profile_id=? AND day>=? GROUP BY source").bind(profileId, start).all<any>();
  const bySource = new Map<string, number>((sourceRows.results || []).map((row: any) => [row.source, Number(row.views || 0)]));
  const sources = SOURCES.map(source => ({ source, views: bySource.get(source) || 0 }));
  return { range_days: days, from: start, to: dayList[dayList.length - 1]!, totals, series, sources };
}
