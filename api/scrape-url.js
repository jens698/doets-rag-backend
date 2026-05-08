import * as cheerio from 'cheerio';
import { cleanText, smartChunk, hashContent } from '../lib/document.js';
import {
  upsertDocumentV2,
  findActiveVectorsByName,
  markVectorsInactive
} from '../lib/pinecone.js';

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

  $('script, style, noscript').remove();
  $('nav, header, footer').remove();
  $('[aria-hidden="true"]').remove();

  const title = $('h1').first().text().trim() || $('title').text().trim();

  for (const sel of CONTENT_SELECTORS) {
    const el = $(sel).first();
    const t  = el.text().trim();
    if (el.length && t.length > 100) {
      return { title, text: t };
    }
  }

  return { title, text: $('body').text() };
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

    const html = await response.text();
    const { title, text } = extractContent(html, url);
    const cleanedText = cleanText(text);

    if (!cleanedText || cleanedText.length < 80) {
      return res.status(400).json({
        error: `Te weinig tekst gevonden (${cleanedText?.length || 0} tekens). De pagina laadt mogelijk via JavaScript of vereist een inlog. Probeer de pagina als TXT of DOCX te exporteren en handmatig te uploaden.`
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
