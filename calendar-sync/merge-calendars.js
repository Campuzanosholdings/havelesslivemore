#!/usr/bin/env node
/**
 * merge-calendars.js
 *
 * Reads config.json (list of properties, each pointing to an environment
 * variable name that holds its iCal export URL), fetches every feed,
 * extracts the booked/blocked date ranges, and writes a single merged
 * availability.json that the website's booking form can check against.
 *
 * The actual iCal URLs are NOT stored in config.json — only the names of
 * the environment variables that hold them. This matters because the repo
 * is public (required for free GitHub Pages), and those URLs are private
 * booking-calendar links. The real values live in GitHub Actions secrets
 * (Settings > Secrets and variables > Actions) and are injected as
 * environment variables by the workflow — see sync-calendars.yml.
 *
 * Requires Node 18+ (built-in fetch). No external dependencies.
 *
 * Usage:
 *   node merge-calendars.js config.json availability.json
 */

const fs = require('fs');

const configPath = process.argv[2] || 'config.json';
const outPath = process.argv[3] || 'availability.json';

// --- minimal iCal VEVENT parser (no external deps) ---------------------
// Airbnb/Vrbo/Booking.com iCal feeds mark blocked nights as VEVENTs with
// DTSTART;VALUE=DATE and DTEND;VALUE=DATE (all-day, exclusive end date).
function parseBusyRanges(icalText) {
  const ranges = [];
  const events = icalText.split('BEGIN:VEVENT').slice(1);
  for (const block of events) {
    const startMatch = block.match(/DTSTART[^:]*:(\d{8})/);
    const endMatch = block.match(/DTEND[^:]*:(\d{8})/);
    if (!startMatch || !endMatch) continue;
    const toIso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    ranges.push({ start: toIso(startMatch[1]), end: toIso(endMatch[1]) });
  }
  return ranges;
}

async function fetchFeed(url, label) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'HaveLessLiveMore-CalendarSync/1.0' } });
    if (!res.ok) {
      console.error(`[warn] ${label}: HTTP ${res.status}, skipping this feed`);
      return [];
    }
    const text = await res.text();
    return parseBusyRanges(text);
  } catch (err) {
    console.error(`[warn] ${label}: fetch failed (${err.message}), skipping this feed`);
    return [];
  }
}

// merge overlapping/adjacent ranges so the output stays small and clean
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

async function main() {
  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    console.error(`Copy config.example.json to config.json and fill in your env var names first.`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const output = { generatedAt: new Date().toISOString(), properties: {} };

  for (const property of config.properties) {
    let allRanges = [];
    const missing = (property.icalFeeds || []).filter(
      (f) => !f.urlEnv || !process.env[f.urlEnv]
    );
    if (missing.length) {
      console.log(`[skip] ${property.name}: secret(s) not set yet — ${missing.map(f => f.urlEnv).join(', ')}`);
    }
    for (const feed of property.icalFeeds || []) {
      const url = feed.urlEnv && process.env[feed.urlEnv];
      if (!url) continue;
      const ranges = await fetchFeed(url, `${property.name} (${feed.platform})`);
      allRanges = allRanges.concat(ranges);
    }
    output.properties[property.slug] = {
      name: property.name,
      busy: mergeRanges(allRanges),
    };
    console.log(`[ok] ${property.name}: ${output.properties[property.slug].busy.length} blocked range(s)`);
  }

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main();
