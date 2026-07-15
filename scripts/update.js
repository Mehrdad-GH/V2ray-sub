const fs = require('fs');
const path = require('path');
const { fetchChannelConfigs } = require('./lib/scraper');

const ROOT = path.join(__dirname, '..');

const CHANNELS_RAW = process.env.CHANNELS || '';
const TOTAL_LIMIT = process.env.TOTAL_LIMIT ? parseInt(process.env.TOTAL_LIMIT, 10) : null;
const MAX_PAGES_PER_CHANNEL = parseInt(process.env.MAX_PAGES_PER_CHANNEL || '15', 10);
const SUB_FILENAME = process.env.SUB_FILENAME || 'sub.txt';
const SUB_FILE = path.join(ROOT, 'sub', SUB_FILENAME);

/**
 * "test1:10,test2:20"  ->  [{username:'test1', limit:10}, {username:'test2', limit:20}]
 * "test1,test2"        ->  [{username:'test1', limit:null}, {username:'test2', limit:null}]
 */
function parseChannels(raw) {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, limitStr] = entry.split(':').map((s) => s.trim());
      return {
        username: name.replace(/^@/, ''),
        limit: limitStr ? parseInt(limitStr, 10) : null,
      };
    });
}

function writeSubFile(entries) {
  fs.mkdirSync(path.dirname(SUB_FILE), { recursive: true });
  const body = entries.map((e) => e.config).join('\n');
  const b64 = Buffer.from(body, 'utf8').toString('base64');
  fs.writeFileSync(SUB_FILE, b64, 'utf8');
  return entries.length;
}

async function main() {
  const channels = parseChannels(CHANNELS_RAW);

  if (channels.length === 0) {
    console.error('CHANNELS env var is required, e.g. "test1:10,test2:20" or "test1,test2"');
    process.exit(1);
  }

  console.log(`Channels to process: ${channels.map((c) => `${c.username}${c.limit ? ':' + c.limit : ''}`).join(', ')}`);
  if (TOTAL_LIMIT) console.log(`Global TOTAL_LIMIT active: ${TOTAL_LIMIT}`);

  const allEntries = [];

  for (const { username, limit } of channels) {
    // اگه TOTAL_LIMIT سراسری فعاله و این کانال limit خاص خودش رو نداره، سقفی نذار -
    // بعداً تو merge سراسری truncate میشه. اگه هم خودش limit داره، همون رعایت میشه.
    console.log(`Fetching ${username} (limit=${limit ?? 'none, capped by MAX_PAGES_PER_CHANNEL'}) ...`);
    try {
      const entries = await fetchChannelConfigs(username, {
        limit,
        maxPages: MAX_PAGES_PER_CHANNEL,
      });
      console.log(`  -> got ${entries.length} config(s) from ${username}`);
      allEntries.push(...entries);
    } catch (err) {
      console.error(`  -> failed to fetch ${username}: ${err.message}`);
    }
  }

  // دیدوپ سراسری (ممکنه یه کانفیگ تو چند کانال تکرار بشه)
  const byConfig = new Map();
  for (const e of allEntries) {
    const existing = byConfig.get(e.config);
    if (!existing || (e.date?.getTime() || 0) > (existing.date?.getTime() || 0)) {
      byConfig.set(e.config, e);
    }
  }

  let merged = Array.from(byConfig.values());
  merged.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

  if (TOTAL_LIMIT) {
    merged = merged.slice(0, TOTAL_LIMIT);
  }

  const total = writeSubFile(merged);
  console.log(`Wrote ${total} config(s) to sub/${SUB_FILENAME}`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${total}\n`);
  }
}

main().catch((err) => {
  console.error('update failed:', err.message);
  process.exit(1);
});
