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
    max_tokens: 2048,
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
  "body_paragraphs": ["array of paragraph strings, preserve author voice exactly, keep lowercase style, do NOT change any wording"],
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
        max_tokens: 2048,
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
// STEP 4 — GENERATE STANDALONE POST HTML
// Uses identical fp-* styles from abluffersguide.html
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
  const bodyParagraphs = post.body_paragraphs
    .map((p, i, arr) => {
      if (i === arr.length - 1) {
        return `        <p class="fp-cta">${escapeHTML(p)}</p>`;
      }
      return `        <p>${escapeHTML(p)}</p>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHTML(post.headline)} — A BLUFFERS GUIDE</title>
<meta name="description" content="${escapeHTML(post.excerpt)}"/>
<meta property="og:title" content="${escapeHTML(post.headline)} — A BLUFFERS GUIDE"/>
<meta property="og:description" content="${escapeHTML(post.excerpt)}"/>
<style>
:root{
  --navy:#1a2fd4;
  --font:Arial,Helvetica,sans-serif;
  --ease:cubic-bezier(0.16,1,0.3,1);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;scroll-behavior:smooth;-webkit-font-smoothing:antialiased}
body{background:#ffffff;color:#1a2fd4;font-family:var(--font);font-weight:700;overflow-x:hidden}
a{color:inherit;text-decoration:none}
::selection{background:rgba(0,229,204,0.2)}

/* Header */
#header{
  position:fixed;top:0;left:0;right:0;z-index:900;
  padding:0 2.5rem;height:68px;
  display:flex;align-items:center;justify-content:space-between;
  background:rgba(255,255,255,0.92);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border-bottom:1px solid rgba(26,47,212,0.1);
}
.logo{display:flex;align-items:center;gap:0.6rem}
.logo-text{
  font-family:var(--font);font-size:1rem;font-weight:700;
  color:#1a2fd4;letter-spacing:0;
}
.nav-links{display:flex;align-items:center;gap:2.2rem}
.nav-link{
  font-family:var(--font);font-size:0.75rem;font-weight:700;letter-spacing:0.1em;
  text-transform:uppercase;color:#1a2fd4;transition:opacity 0.2s;
}
.nav-link:hover{opacity:0.7}

/* Article split */
.fp-section{padding:0;padding-top:68px}
.fp-split{display:flex;min-height:100vh}
.fp-left{
  width:55%;background:#ffffff;padding:3rem;
  display:flex;align-items:center;justify-content:center;
}
.fp-headline{
  font-family:Arial,Helvetica,sans-serif;font-weight:700;
  font-size:clamp(1.8rem,4.5vw,3.8rem);color:#1a2fd4;
  text-transform:uppercase;line-height:1.05;text-align:center;
}
.fp-right{
  width:45%;background:#1a2fd4;padding:3rem;
  display:flex;flex-direction:column;justify-content:center;
  overflow-y:auto;
}
.fp-meta{display:flex;align-items:center;gap:1.5rem;margin-bottom:2rem}
.fp-tag{
  font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:0.7rem;
  letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.45);
}
.fp-date{
  font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:0.75rem;
  color:rgba(255,255,255,0.45);
}
.fp-body p{
  font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:0.95rem;
  line-height:1.75;color:#ffffff;margin-bottom:1.2rem;
}
.fp-body p.fp-cta{font-size:1.05rem;margin-bottom:0}
.fp-ig-link{
  display:inline-block;margin-top:2rem;
  font-family:var(--font);font-size:0.7rem;font-weight:700;
  letter-spacing:0.1em;text-transform:uppercase;
  color:rgba(255,255,255,0.45);transition:color 0.2s;
}
.fp-ig-link:hover{color:#ffffff}
.fp-back{
  display:inline-block;margin-top:1.2rem;
  font-family:var(--font);font-size:0.7rem;font-weight:700;
  letter-spacing:0.1em;text-transform:uppercase;
  color:rgba(255,255,255,0.35);transition:color 0.2s;
}
.fp-back:hover{color:#ffffff}

@media(max-width:768px){
  .fp-split{flex-direction:column}
  .fp-left{width:100%;min-height:50vw}
  .fp-right{width:100%}
  #header{padding:0 1.5rem}
}
</style>
</head>
<body>

<header id="header">
  <a href="../index.html" class="logo">
    <span class="logo-text">A BLUFFERS GUIDE</span>
  </a>
  <nav class="nav-links">
    <a href="../index.html" class="nav-link">Home</a>
    <a href="../archive.html" class="nav-link">Archive</a>
    <a href="https://www.instagram.com/abluffersguide/" target="_blank" class="nav-link">Instagram ↗</a>
  </nav>
</header>

<section class="fp-section">
  <div class="fp-split">
    <div class="fp-left">
      <h1 class="fp-headline">${escapeHTML(post.headline)}</h1>
    </div>
    <div class="fp-right">
      <div class="fp-meta">
        <span class="fp-tag">${escapeHTML(post.category)}</span>
        <span class="fp-date">${escapeHTML(post.date)}</span>
      </div>
      <div class="fp-body">
${bodyParagraphs}
      </div>
      <a href="${igUrl}" target="_blank" class="fp-ig-link">View on Instagram →</a>
      <a href="../index.html" class="fp-back">← Back to journal</a>
    </div>
  </div>
</section>

</body>
</html>
`;
}


// ═══════════════════════════════════════════════════
// STEP 5 — UPDATE INDEX.HTML (insert between markers)
// and REBUILD ARCHIVE.HTML
// ═══════════════════════════════════════════════════

function generateArticleBlock(entry) {
  const bodyParagraphs = entry.body_paragraphs
    ? entry.body_paragraphs.map((p, i, arr) => {
        if (i === arr.length - 1) {
          return `        <p class="fp-cta">${escapeHTML(p)}</p>`;
        }
        return `        <p>${escapeHTML(p)}</p>`;
      }).join("\n")
    : `        <p>${escapeHTML(entry.excerpt)}</p>`;

  return `<article class="post-card">
<section class="fp-section">
  <div class="fp-split">
    <div class="fp-left">
      <h2 class="fp-headline"><a href="posts/${entry.slug}.html" style="color:inherit;text-decoration:none">${escapeHTML(entry.headline)}</a></h2>
    </div>
    <div class="fp-right">
      <div class="fp-meta">
        <span class="fp-tag">${entry.category}</span>
        <span class="fp-date">${entry.date}</span>
      </div>
      <div class="fp-body">
${bodyParagraphs}
      </div>
    </div>
  </div>
</section>
</article>`;
}

function updateIndex(manifest) {
  let html = fs.readFileSync(INDEX_PATH, "utf-8");

  const startMarker = "<!-- POSTS_START -->";
  const endMarker = "<!-- POSTS_END -->";
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    console.error("Could not find POSTS_START/POSTS_END markers in index.html");
    return;
  }

  const latest = manifest.slice(0, MAX_HOMEPAGE_POSTS);
  const articles = latest.map(generateArticleBlock).join("\n");

  html = html.slice(0, startIdx + startMarker.length) + "\n" + articles + "\n" + html.slice(endIdx);

  fs.writeFileSync(INDEX_PATH, html);
}

function rebuildArchive(manifest) {
  const articles = manifest.map(generateArticleBlock).join("\n");

  // Read index.html to extract the full <style> block for consistent styling
  const indexHTML = fs.readFileSync(INDEX_PATH, "utf-8");
  const styleMatch = indexHTML.match(/<style>([\s\S]*?)<\/style>/);
  const styles = styleMatch ? styleMatch[1] : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Archive — A BLUFFERS GUIDE</title>
<meta name="description" content="All articles from A Bluffers Guide."/>
<style>
${styles}
.archive-title{
  font-family:Arial,Helvetica,sans-serif;font-weight:700;
  font-size:clamp(2rem,5vw,4rem);color:#1a2fd4;
  text-transform:uppercase;line-height:1.05;
  padding:6rem 2.5rem 2rem;
}
.archive-count{
  font-family:Arial,Helvetica,sans-serif;font-weight:700;
  font-size:0.75rem;letter-spacing:0.1em;
  color:rgba(26,47,212,0.45);padding:0 2.5rem 3rem;
}
</style>
</head>
<body>

<header id="header">
  <a href="index.html" class="logo">
    <span class="logo-text">A BLUFFERS GUIDE</span>
  </a>
  <nav class="nav-links">
    <a href="index.html" class="nav-link">Home</a>
    <a href="archive.html" class="nav-link">Archive</a>
    <a href="https://www.instagram.com/abluffersguide/" target="_blank" class="nav-link">Instagram ↗</a>
  </nav>
</header>

<div style="padding-top:68px">
  <h1 class="archive-title">Archive</h1>
  <p class="archive-count">${manifest.length} article${manifest.length === 1 ? "" : "s"}</p>
</div>

${articles}

<footer style="padding:2rem 2.5rem;border-top:1px solid rgba(26,47,212,0.1);text-align:center">
  <p style="font-size:0.7rem;letter-spacing:0.1em;color:rgba(26,47,212,0.35)">© 2026 A BLUFFERS GUIDE</p>
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

    // Write standalone post HTML
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
      body_paragraphs: formatted.body_paragraphs,
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

  // ── Step 5: Update index + rebuild archive ──
  saveManifest(manifest);
  updateIndex(manifest);
  rebuildArchive(manifest);
  console.log(`\nUpdated index.html (${Math.min(manifest.length, MAX_HOMEPAGE_POSTS)} articles) and archive.html (${manifest.length} articles)`);

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
