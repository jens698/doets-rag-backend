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

function detectDocumentType(url) {
  if (url.includes('/reisblog/') || url.includes('/blog/')) return 'algemeen';
  if (url.includes('/reizen/') || url.includes('/reis/'))   return 'reis';
  if (url.includes('/excursie'))                             return 'excursie';
  return 'algemeen';
}

function extractContent(html, url) {
  const $ = cheerio.load(html);

  NOISE_SELECTORS.forEach(sel => $(sel).remove());

  for (const sel of CONTENT_SELECTORS) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      return {
        title: $('h1').first().text().trim() || $('title').text().trim(),
        text: el.text()
      };
    }
  }

  return {
    title: $('h1').first().text().trim() || $('title').text().trim(),
    text: $('body').text()
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
        'User-Agent': 'Mozilla/5.0 (compatible; DoetsKennisbot/1.0)',
        'Accept': 'text/html'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return res.status(400).json({ error: `Pagina niet bereikbaar: HTTP ${response.status}` });
    }

    const html = await response.text();
    const { title, text } = extractContent(html, url);
    const cleanedText = cleanText(text);

    if (!cleanedText || cleanedText.length < 200) {
      return res.status(400).json({
        error: 'Te weinig bruikbare tekst gevonden op deze pagina. Mogelijk een JavaScript-pagina of filterpagina zonder eigen inhoud.'
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
      contentHash,
      previousVersionsDeactivated: deactivatedCount
    });

  } catch (error) {
    console.error('Scrape error:', error);
    return res.status(500).json({ error: error.message || 'Scrapen mislukt' });
  }
}
