import Anthropic from '@anthropic-ai/sdk';
import { v2 as cloudinary } from 'cloudinary';
import { searchSimilar } from '../lib/pinecone.js';
import { requireAuth } from '../lib/auth.js';
import {
  normaliseerInvoer, zoekvraag, bouwContext, bouwPrompts,
  parseJson, nabewerken, fotoExpressie
} from '../lib/content.js';

export const config = { maxDuration: 60 };

const MODEL = 'claude-opus-5-5';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld' });
  }

  const { invoer, error } = normaliseerInvoer(req.body);
  if (error) return res.status(400).json({ error });

  // 1. Kennisbank doorzoeken. Lukt dat niet, dan schrijven we zonder context
  //    en meldt de nabewerking dat er geen bronnen zijn.
  let resultaten = [];
  try {
    resultaten = await searchSimilar(zoekvraag(invoer), 8);
  } catch (e) {
    console.error('content: kennisbank zoeken mislukt:', e);
  }

  // 2. Claude laat de content schrijven.
  const { system, user } = bouwPrompts(invoer, bouwContext(resultaten));
  let data;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 8000,
        output_config: { effort: 'low' },
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }]
      },
      { headers: { 'anthropic-beta': 'server-side-fallback-2026-07-01' } }
    );

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'Claude wilde deze tekst niet schrijven. Pas het onderwerp aan en probeer opnieuw.' });
    }
    const tekst = (response.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    data = parseJson(tekst);
    if (!data) {
      console.error('content: ongeldige JSON:', tekst.slice(0, 500));
      return res.status(502).json({ error: 'De AI gaf een onverwacht antwoord. Probeer het nog een keer.' });
    }
  } catch (err) {
    console.error('content: Claude-fout:', err);
    return res.status(500).json({ error: err.message || 'Content maken mislukt' });
  }

  const uit = nabewerken(invoer, data);

  // 3. Passende foto's uit de fotobibliotheek (stil falen: dan gewoon geen foto's).
  uit.fotos = await zoekFotos([invoer.bestemming, ...uit.foto_zoekwoorden]);

  return res.status(200).json({ content: uit });
}

async function zoekFotos(woorden) {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return [];
  const expressie = fotoExpressie(woorden);
  if (!expressie) return [];
  try {
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
      secure: true
    });
    const r = await cloudinary.search
      .expression(expressie)
      .max_results(6)
      .with_field('tags')
      .with_field('context')
      .execute();
    return (r.resources || []).map(p => ({
      public_id: p.public_id,
      filename: p.filename || p.public_id.split('/').pop(),
      folder: p.folder || '',
      caption: (p.context && p.context.caption) || '',
      secure_url: p.secure_url,
      thumb_url: cloudinary.url(p.public_id, { width: 320, height: 320, crop: 'fill', quality: 'auto', fetch_format: 'auto', secure: true })
    }));
  } catch (e) {
    console.error('content: foto zoeken mislukt:', e);
    return [];
  }
}
