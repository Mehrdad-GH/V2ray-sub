const axios = require('axios');
const cheerio = require('cheerio');

const CONFIG_REGEX = /(?:vmess|vless|trojan|ss|ssr):\/\/[^\s<>"'\u200c]+/gi;

function parseHtml(html) {
  const $ = cheerio.load(html);
  const messages = [];

  $('.tgme_widget_message_wrap .tgme_widget_message').each((_, el) => {
    const $el = $(el);
    const dataPost = $el.attr('data-post'); // e.g. "channelname/12345"
    const id = dataPost ? parseInt(dataPost.split('/').pop(), 10) : null;

    const dateAttr = $el.find('.tgme_widget_message_date time').first().attr('datetime');
    const date = dateAttr ? new Date(dateAttr) : null;

    const $textEl = $el.find('.tgme_widget_message_text').first();
    if ($textEl.length === 0) return;

    $textEl.find('br').replaceWith('\n');
    const text = $textEl.text();

    messages.push({ id, text, date });
  });

  const ids = messages.map((m) => m.id).filter(Boolean);
  const minId = ids.length ? Math.min(...ids) : null;

  return { messages, minId };
}

async function fetchPage(channelUsername, beforeId = null) {
  const base = `https://t.me/s/${channelUsername}`;
  const url = beforeId ? `${base}?before=${beforeId}` : base;
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    timeout: 15000,
  });
  return parseHtml(html);
}

function extractConfigs(text) {
  const matches = text.match(CONFIG_REGEX);
  return matches ? matches.map((m) => m.trim()) : [];
}

/**
 * از یه کانال، کانفیگ‌ها رو از جدید به قدیم جمع می‌کنه.
 * - اگه limit ست بشه: همین که به تعداد limit کانفیگ یکتا رسید، متوقف میشه.
 * - وگرنه: تا maxPages صفحه به عقب می‌ره (برای حالت TOTAL_LIMIT سراسری).
 *
 * @returns {Array<{config: string, date: Date|null, channel: string}>}
 */
async function fetchChannelConfigs(channelUsername, { limit = null, maxPages = 15, delayMs = 700 } = {}) {
  const seen = new Set();
  const collected = [];
  let beforeId = null;

  for (let page = 0; page < maxPages; page++) {
    const { messages, minId } = await fetchPage(channelUsername, beforeId);
    if (messages.length === 0) break;

    for (const m of messages) {
      for (const c of extractConfigs(m.text)) {
        if (!seen.has(c)) {
          seen.add(c);
          collected.push({ config: c, date: m.date, channel: channelUsername });
        }
      }
    }

    if (limit !== null && collected.length >= limit) break;
    if (minId === null || minId === beforeId) break;
    beforeId = minId;

    if (page < maxPages - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  // جدیدترین اول
  collected.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

  return limit !== null ? collected.slice(0, limit) : collected;
}

module.exports = { fetchChannelConfigs, extractConfigs };
