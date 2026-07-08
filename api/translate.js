import Anthropic from '@anthropic-ai/sdk';
import { verifyToken } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Niet ingelogd.' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY niet ingesteld' });
  }

  const { tekst, doeltaal } = req.body || {};
  if (!tekst || typeof tekst !== 'string' || !tekst.trim()) {
    return res.status(400).json({ error: 'Geef tekst mee om te vertalen' });
  }
  if (!doeltaal || typeof doeltaal !== 'string') {
    return res.status(400).json({ error: 'Kies een doeltaal' });
  }

  const talen = {
    en: 'Engels',
    de: 'Duits',
    fr: 'Frans',
    es: 'Spaans',
    it: 'Italiaans',
    is: 'IJslands',
    no: 'Noors',
    sv: 'Zweeds',
    fi: 'Fins',
    da: 'Deens',
    ja: 'Japans',
    zh: 'Chinees',
    nl: 'Nederlands'
  };
  const doelnaam = talen[doeltaal] || doeltaal;

  const systemPrompt = 'Je bent een vertaler. Vertaal de tekst naar ' + doelnaam + '. Geef ALLEEN de vertaalde tekst terug, geen uitleg, geen quotes, geen extra tekst.';

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: tekst }]
    });

    const vertaling = (response.content?.[0]?.text || '').trim();
    return res.status(200).json({ vertaling, doeltaal: doelnaam });
  } catch (err) {
    console.error('translate error:', err);
    return res.status(500).json({ error: err.message || 'Vertaling mislukt' });
  }
}
