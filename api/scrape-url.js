import * as cheerio from 'cheerio';
import { cleanText, smartChunk, hashContent } from '../lib/document.js';
import {
  upsertDocumentV2,
  findActiveVectorsByName,
  markVectorsInactive
} from '../lib/pinecone.js';

const NOISE_SELECTORS = [
  'nav', 'header', 'footer', 'aside',
  'script', 'style', 'noscript',
  '.menu', '.navigation', '.nav', '.header', '.footer',
  '.cookie', '.cookiebar', '.consent',
  '.sidebar', '.widget', '.advertisement', '.ad',
  '[aria-hidden="true"]'
];

const CONTENT_SELECTORS = [
  'main', 'article', '.entry-content', '.post-content',
  '.page-content', '.content', '#content', '#main'
];

async function tryRssFeed(url) {
  try {
    const parsed = new URL(url);
    const parts  = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const slug   = parts[parts.length - 1];

    const feedUrls = [
      `${parsed.origin}/${parts[0]}/feed/`,
      `${parsed.origin}/feed/`
    ];

    for (const feedUrl of feedUrls) {
      const res = await fetch(feedUrl, {
        headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const $   = cheerio.load(xml, { xmlMode: true });

      let matched = null;
      $('item').each((_, el) => {
        const itemLink = $(el).find('link').text() + $(el).find('guid').text();
        if (itemLink.includes(slug)) {
          matched = el;
          return false;
        }
      });

      if (!matched) continue;

      const $item   = $(matched);
      const title   = $item.find('title').text().trim();
      const content = $item.find('content\\:encoded, encoded').text() ||
                      $item.find('description').text();

      if (!content) continue;

      const text = cheerio.load(content).text().trim();
      if (text.length > 500) return { title, text, source: 'rss-feed' };
    }
  } catch (_) {}
  return null;
}

async function tryWordPressApi(url) {
  try {
    const parsed = new URL(url);
    const parts  = parsed.pathname.replace(/\/$/, '').split('/');
    const slug   = parts[parts.length - 1];
    if (!slug) return null;

    const apiUrl = `${parsed.origin}/wp-json/wp/v2/posts?slug=${slug}&_fields=title,content,excerpt`;
    const res = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;

    const posts = await res.json();
    if (!Array.isArray(posts) || !posts.length) return null;

    const post  = posts[0];
    const title = cheerio.load(post.title?.rendered || '').text();
    const html  = post.content?.rendered || post.excerpt?.rendered || '';
    const text  = cheerio.load(html).text().trim();

    if (text.length > 500) return { title, text, source: 'wordpress-api' };
  } catch (_) {}
  return null;
}

function detectDocumentType(url) {
  if (url.includes('/reisblog/') || url.includes('/blog/')) return 'algemeen';
  if (url.includes('/reizen/') || url.includes('/reis/'))   return 'reis';
  if (url.includes('/excursie'))                             return 'excursie';
  return 'algemeen';
}

function extractFromJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  let bodyText = '';
  scripts.each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const item of items) {
        const t = item.articleBody || item.description || item.text;
        if (typeof t === 'string' && t.length > 100) bodyText += '\n\n' + t;
      }
    } catch (_) {}
  });
  return bodyText.trim();
}

function extractFromNextData($) {
  const el = $('script#__NEXT_DATA__').first();
  if (!el.length) return '';
  try {
    const data = JSON.parse(el.html());
    const seen = new Set();
    const out = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === 'string' && v.length > 80 && !seen.has(v)) {
          if (/[a-z]{4,}.*[a-z]{4,}/.test(v) && !v.startsWith('http')) {
            out.push(v);
            seen.add(v);
          }
        } else if (typeof v === 'object') {
          walk(v);
        }
      }
    };
    walk(data);
    return out.join('\n\n');
  } catch (_) {
    return '';
  }
}

function extractContent(html, url) {
  const $ = cheerio.load(html);

  $('style, noscript').remove();

  const title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim();

  const jsonLdText = extractFromJsonLd($);
  if (jsonLdText.length > 500) {
    return { title, text: jsonLdText, source: 'json-ld' };
  }

  const nextText = extractFromNextData($);
  if (nextText.length > 500) {
    return { title, text: nextText, source: 'next-data' };
  }

  $('script').remove();
  $('nav, footer').remove();
  $('[aria-hidden="true"]').remove();

  for (const sel of CONTENT_SELECTORS) {
    const el = $(sel).first();
    const t  = el.text().trim();
    if (el.length && t.length > 500) {
      return { title, text: t, source: 'dom:' + sel };
    }
  }

  const parts = [];
  $('p, h1, h2, h3, h4, h5, h6, li, blockquote').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.length > 20) parts.push(t);
  });
  const tagText = parts.join('\n\n');
  if (tagText.length > 300) {
    return { title, text: tagText, source: 'tags' };
  }

  const metaDesc =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') || '';
  return {
    title,
    text: (metaDesc + '\n\n' + $('body').text()).trim(),
    source: 'body'
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body || {};
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Geldige URL verplicht (begin met http).' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Referer': 'https://www.doetsreizen.nl/'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(9000)
    });

    if (!response.ok) {
      return res.status(400).json({ error: `Pagina niet bereikbaar: HTTP ${response.status}` });
    }

    const rssResult = await tryRssFeed(url);
    const wpResult  = rssResult ? null : await tryWordPressApi(url);
    let title, text, extractSource;
    if (rssResult) {
      ({ title, text, source: extractSource } = rssResult);
    } else if (wpResult) {
      ({ title, text, source: extractSource } = wpResult);
    } else {
      const html = await response.text();
      ({ title, text, source: extractSource } = extractContent(html, url));
    }
    const cleanedText = cleanText(text);

    if (!cleanedText || cleanedText.length < 80) {
      return res.status(400).json({
        error: `Te weinig tekst gevonden (${cleanedText?.length || 0} tekens, methode: ${extractSource}). De pagina laadt mogelijk via JavaScript. Kopieer de tekst handmatig en upload als TXT-bestand.`
      });
    }

    const documentType = detectDocumentType(url);
    const documentName = title || new URL(url).pathname;
    const chunks = smartChunk(cleanedText, { size: 1000, overlap: 150 });
    const contentHash = hashContent(cleanedText);

    const existing = await findActiveVectorsByName(url);
    const oldVersionNums = [...new Set(
      existing.map(m => m.metadata?.version).filter(v => typeof v === 'number')
    )];
    const version = (oldVersionNums.length ? Math.max(...oldVersionNums) : 0) + 1;

    let deactivatedCount = 0;
    if (existing.length) {
      deactivatedCount = await markVectorsInactive(existing.map(m => m.id));
    }

    const documentId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const vectorCount = await upsertDocumentV2({
      documentId,
      documentName: url,
      documentType,
      version,
      bestemming: null,
      priority: 2,
      source: 'website',
      rawText: cleanedText,
      chunks,
      structuredFields: { titel: documentName, url }
    });

    return res.status(200).json({
      success: true,
      url,
      title: documentName,
      documentType,
      version,
      chunks: chunks.length,
      vectors: vectorCount,
      textLength: cleanedText.length,
      extractSource,
      contentHash,
      previousVersionsDeactivated: deactivatedCount
    });

  } catch (error) {
    console.error('Scrape error:', error);
    return res.status(500).json({ error: error.message || 'Scrapen mislukt' });
  }
}
