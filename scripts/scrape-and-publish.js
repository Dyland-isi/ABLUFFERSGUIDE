import fetch from "node-fetch";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ─── PATHS ───────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(ROOT, "posts");
const INDEX_PATH = path.join(ROOT, "index.html");
const ARCHIVE_PATH = path.join(ROOT, "archive.html");
const SEEN_PATH = path.join(__dirname, "last-seen.json");
const MANIFEST_PATH = path.join(POSTS_DIR, "manifest.json");

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const IG_USERNAME = process.env.INSTAGRAM_USERNAME;

const MAX_HOMEPAGE_POSTS = 5;


// ═══════════════════════════════════════════════════
// STEP 1 — SCRAPE INSTAGRAM VIA APIFY
// ═══════════════════════════════════════════════════

async function scrapeInstagram() {
  console.log(`Scraping @${IG_USERNAME} via Apify…`);
  const url = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: [`https://www.instagram.com/${IG_USERNAME}/`],
      resultsType: "posts",
      resultsLimit: 10,
    }),
  });

  if (!res.ok) {
    throw new Error(`Apify failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}


// ═══════════════════════════════════════════════════
// STEP 2 — CHECK WHICH POSTS ARE NEW
// ═══════════════════════════════════════════════════

function loadSeen() {
  try {
    return JSON.parse(fs.readFileSync(SEEN_PATH, "utf-8"));
  } catch {
    return { seen_ids: [] };
  }
}

function saveSeen(data) {
  fs.writeFileSync(SEEN_PATH, JSON.stringify(data, null, 2) + "\n");
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveManifest(data) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(data, null, 2) + "\n");
}


// ═══════════════════════════════════════════════════
// STEP 3 — FORMAT EACH POST VIA CLAUDE
// ═══════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are a content formatter for A Bluffers Guide, a minimalist UK culture and media blog. Format Instagram captions into blog post metadata. Return ONLY valid JSON with no markdown wrapper, no code fences, just the raw JSON object.`;

async function formatWithClaude(client, caption, timestamp) {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `Format this Instagram caption into a blog post.

Caption:
${caption}

Timestamp: ${timestamp}

Return this exact JSON structure:
{
  "headline": "punchy title from caption, UPPERCASE, max 10 words",
  "category": "one of MUSIC / FILM / ESSAY / CULTURE / PHOTOGRAPHY",
  "body_paragraphs": ["array of paragraph strings, preserve author voice exactly, keep lowercase style"],
  "slug": "url-safe-hyphenated-max-5-words",
  "date": "e.g. Apr 2026",
  "reading_time": "e.g. 3 min read",
  "excerpt": "one sentence summary for card preview"
}`
    }],
  });

  return JSON.parse(msg.content[0].text.trim());
}

async function formatWithRetry(client, caption, timestamp) {
  try {
    return await formatWithClaude(client, caption, timestamp);
  } catch (firstErr) {
    console.warn("  ⚠ Malformed JSON from Claude, retrying…");
    try {
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: "Return ONLY a valid JSON object. No markdown. No code fences. No explanation. Just raw JSON.",
        messages: [{
          role: "user",
          content: `Convert this text into a blog post JSON object.

Text: ${caption}
Timestamp: ${timestamp}

Keys required (all strings except body_paragraphs which is a string array):
headline, category (MUSIC/FILM/ESSAY/CULTURE/PHOTOGRAPHY), body_paragraphs, slug, date, reading_time, excerpt`
        }],
      });
      return JSON.parse(msg.content[0].text.trim());
    } catch (retryErr) {
      throw new Error(`Claude formatting failed after retry: ${retryErr.message}`);
    }
  }
}


// ═══════════════════════════════════════════════════
// STEP 4 — GENERATE POST HTML (MAGAZINE SPLIT)
// ═══════════════════════════════════════════════════

function uniqueSlug(slug) {
  let candidate = slug;
  let counter = 1;
  while (fs.existsSync(path.join(POSTS_DIR, `${candidate}.html`))) {
    counter++;
    candidate = `${slug}-${counter}`;
  }
  return candidate;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generatePostHTML(post, igUrl) {
  const paragraphs = post.body_paragraphs
    .map(p => `        <p>${escapeHTML(p)}</p>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(post.headline)} — A Bluffers Guide</title>
  <meta name="description" content="${escapeHTML(post.excerpt)}">
  <meta property="og:title" content="${escapeHTML(post.headline)} — A Bluffers Guide">
  <meta property="og:description" content="${escapeHTML(post.excerpt)}">
  <link rel="stylesheet" href="../style.css">
</head>
<body>
  <nav class="site-nav">
    <a href="../index.html" class="nav-logo">a bluffers guide</a>
    <div class="nav-links">
      <a href="../index.html">Journal</a>
      <a href="../archive.html">Archive</a>
    </div>
  </nav>

  <div class="article-split">
    <div class="article-left">
      <h1 class="article-headline">${escapeHTML(post.headline)}</h1>
    </div>
    <div class="article-right">
      <div class="article-date">${escapeHTML(post.date)}</div>
      <div class="article-body">
${paragraphs}
      </div>
      <a href="${igUrl}" target="_blank" class="article-cta">
        View original on Instagram →
      </a>
      <a href="../index.html" class="article-back">← Back to journal</a>
    </div>
  </div>
</body>
</html>
`;
}


// ═══════════════════════════════════════════════════
// STEP 5 — REBUILD INDEX.HTML & ARCHIVE.HTML
// ═══════════════════════════════════════════════════

function generateCardHTML(entry) {
  return `    <article class="post-card" data-category="${entry.category}" data-id="${entry.id}">
      <a href="posts/${entry.slug}.html">
        <div class="card-image-wrapper">
          <span class="card-hero-headline">${escapeHTML(entry.headline)}</span>
        </div>
        <div class="card-content">
          <span class="card-category">${entry.category}</span>
          <h2 class="card-title">${escapeHTML(entry.headline)}</h2>
          <p class="card-excerpt">${escapeHTML(entry.excerpt)}</p>
          <div class="card-meta">
            <span class="card-date">${entry.date}</span>
            <span class="card-reading-time">${entry.reading_time}</span>
          </div>
        </div>
      </a>
    </article>`;
}

function rebuildIndex(manifest) {
  const latest = manifest.slice(0, MAX_HOMEPAGE_POSTS);
  const cards = latest.map(generateCardHTML).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>A Bluffers Guide — Journal</title>
  <meta name="description" content="A Bluffers Guide — culture, music, and media. The journal.">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="site-nav">
    <a href="index.html" class="nav-logo">a bluffers guide</a>
    <div class="nav-links">
      <a href="index.html">Journal</a>
      <a href="archive.html">Archive</a>
    </div>
  </nav>

  <section class="hero">
    <h1 class="hero-title">A BLUFFERS <span class="accent">GUIDE</span></h1>
    <p class="hero-tagline">media consumption final boss.</p>
  </section>

  <div class="section-header">
    <span class="section-title">Latest</span>
    <a href="archive.html" class="section-link">View all →</a>
  </div>

  <div class="posts-grid">
    <!-- POSTS_START -->
${cards}
    <!-- POSTS_END -->
  </div>

  <footer class="site-footer">
    &copy; 2026 A Bluffers Guide. All rights reserved.
  </footer>
</body>
</html>
`;
  fs.writeFileSync(INDEX_PATH, html);
}

function rebuildArchive(manifest) {
  const cards = manifest.map(generateCardHTML).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Archive — A Bluffers Guide</title>
  <meta name="description" content="All articles from A Bluffers Guide.">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="site-nav">
    <a href="index.html" class="nav-logo">a bluffers guide</a>
    <div class="nav-links">
      <a href="index.html">Journal</a>
      <a href="archive.html">Archive</a>
    </div>
  </nav>

  <div class="archive-header">
    <h1 class="archive-title">Archive</h1>
    <p class="archive-count">${manifest.length} article${manifest.length === 1 ? "" : "s"}</p>
  </div>

  <div class="posts-grid">
    <!-- ARCHIVE_START -->
${cards}
    <!-- ARCHIVE_END -->
  </div>

  <footer class="site-footer">
    &copy; 2026 A Bluffers Guide. All rights reserved.
  </footer>
</body>
</html>
`;
  fs.writeFileSync(ARCHIVE_PATH, html);
}


// ═══════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════

async function main() {
  if (!APIFY_TOKEN || !ANTHROPIC_KEY || !IG_USERNAME) {
    console.error("Missing required environment variables (APIFY_API_TOKEN, ANTHROPIC_API_KEY, INSTAGRAM_USERNAME).");
    process.exit(0);
  }

  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }

  // ── Step 1: Scrape ──
  let posts;
  try {
    posts = await scrapeInstagram();
    console.log(`Scraped ${posts.length} post(s) from @${IG_USERNAME}`);
  } catch (err) {
    console.error("Apify scrape failed:", err.message);
    process.exit(0);
  }

  // ── Step 2: Filter new ──
  const seen = loadSeen();
  const seenSet = new Set(seen.seen_ids);
  const newPosts = posts.filter(p => p.id && !seenSet.has(p.id));

  if (newPosts.length === 0) {
    console.log("No new posts found.");
    process.exit(0);
  }

  console.log(`Found ${newPosts.length} new post(s) to process.\n`);

  // Sort newest first
  newPosts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // ── Step 3–4: Process each post ──
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const manifest = loadManifest();
  const processedHeadlines = [];

  for (const post of newPosts) {
    const caption = post.caption || "";
    const timestamp = post.timestamp || "";
    const igUrl = post.url || `https://www.instagram.com/p/${post.shortCode}/`;
    const igId = post.id;

    if (!caption.trim()) {
      console.log(`  Skipping ${igId}: empty caption`);
      seen.seen_ids.push(igId);
      continue;
    }

    console.log(`  Processing ${igId}…`);

    let formatted;
    try {
      formatted = await formatWithRetry(client, caption, timestamp);
    } catch (err) {
      console.error(`  ✗ Skipping ${igId}: ${err.message}`);
      continue;
    }

    // Write post HTML
    const slug = uniqueSlug(formatted.slug);
    const postHTML = generatePostHTML(formatted, igUrl);
    fs.writeFileSync(path.join(POSTS_DIR, `${slug}.html`), postHTML);
    console.log(`  ✓ posts/${slug}.html — "${formatted.headline}"`);

    // Add to manifest (newest first)
    manifest.unshift({
      id: igId,
      slug,
      headline: formatted.headline,
      category: formatted.category,
      excerpt: formatted.excerpt,
      date: formatted.date,
      reading_time: formatted.reading_time,
      timestamp,
    });

    processedHeadlines.push(formatted.headline);
    seen.seen_ids.push(igId);
  }

  if (processedHeadlines.length === 0) {
    console.log("No posts were successfully processed.");
    process.exit(0);
  }

  // ── Step 5: Rebuild index + archive ──
  saveManifest(manifest);
  rebuildIndex(manifest);
  rebuildArchive(manifest);
  console.log(`\nRebuilt index.html (${Math.min(manifest.length, MAX_HOMEPAGE_POSTS)} cards) and archive.html (${manifest.length} cards)`);

  // ── Step 6: Save seen IDs ──
  saveSeen(seen);

  // ── Step 7: Summary ──
  console.log(`\n✓ Published ${processedHeadlines.length} new article(s):`);
  processedHeadlines.forEach(h => console.log(`  — ${h}`));
}

try {
  await main();
} catch (err) {
  console.error("Unexpected error:", err.message);
  process.exit(0);
}
