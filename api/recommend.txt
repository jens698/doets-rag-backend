import Anthropic from '@anthropic-ai/sdk';
import { searchSimilar } from '../lib/pinecone.js';
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

  const { profile } = req.body || {};
  if (!profile || typeof profile !== 'object') {
    return res.status(400).json({ error: 'Geef een klantprofiel mee' });
  }

  const profileText = profileToText(profile);
  const searchQuery = buildSearchQuery(profile);

  let context = '';
  try {
    const results = await searchSimilar(searchQuery, 12);
    context = results.map((r, i) => `[Bron ${i + 1} — ${r.documentName || 'onbekend'}]\n${r.text}`).join('\n\n');
  } catch (e) {
    context = '(geen extra context uit kennisdatabank beschikbaar)';
  }

  const systemPrompt = `Je bent een ervaren reisadviseur van Doets Reizen. Je helpt collega's bij het maken van een reisvoorstel voor een klant.

Op basis van het klantprofiel en de meegeleverde context uit de Doets kennisdatabank geef je een compleet reisadvies.

Antwoord ALLEEN in geldige JSON in dit exacte formaat:
{
  "samenvatting": "Korte samenvatting van welk type reis bij deze klant past (2-3 zinnen)",
  "bestemmingen": [
    { "naam": "Bestemming", "waarom": "Waarom past deze bestemming bij het profiel (2-3 zinnen)", "beste_periode": "Optimale reisperiode voor dit type reiziger" }
  ],
  "hotels": [
    { "naam": "Hotel", "bestemming": "Land/plaats", "waarom": "Waarom past dit hotel bij het profiel" }
  ],
  "excursies": [
    { "naam": "Excursie", "bestemming": "Land/plaats", "waarom": "Waarom past deze excursie bij het profiel" }
  ],
  "let_op": "Praktische zaken om te bespreken (visum, vaccinatie, seizoen, kinderen, mobiliteit, dieet) — 2-4 punten in één alinea"
}

Regels:
- Geef 3 bestemmingen (top 3, meest passend eerst)
- Geef 3 tot 5 hotels verdeeld over de bestemmingen
- Geef 3 tot 5 excursies verdeeld over de bestemmingen
- Baseer je op de meegeleverde context als die bruikbaar is; anders val je terug op algemene Doets Reizen expertise
- Schrijf in het Nederlands, professioneel maar toegankelijk
- Antwoord ALLEEN met JSON, geen extra tekst`;

  const userPrompt = `KLANTPROFIEL:
${profileText}

CONTEXT UIT KENNISDATABANK:
${context || '(leeg)'}

Geef nu je aanbeveling.`;

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const raw = response.content?.[0]?.text || '';
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(500).json({ error: 'AI gaf ongeldige JSON terug', raw: cleaned.slice(0, 600) });
    }

    return res.status(200).json({ advies: parsed });
  } catch (err) {
    console.error('recommend error:', err);
    return res.status(500).json({ error: err.message || 'Aanbeveling mislukt' });
  }
}

function profileToText(p) {
  const lines = [];
  if (p.type) lines.push(`Type reiziger: ${p.type}`);
  if (p.aantalPersonen) lines.push(`Aantal personen: ${p.aantalPersonen}`);
  if (p.leeftijden) lines.push(`Leeftijden: ${p.leeftijden}`);
  if (p.budget) lines.push(`Budget per persoon: ${p.budget}`);
  if (p.duur) lines.push(`Reisduur: ${p.duur}`);
  if (p.periode) lines.push(`Voorkeur reisperiode: ${p.periode}`);
  if (p.ervaring) lines.push(`Reiservaring: ${p.ervaring}`);
  if (p.interesses && p.interesses.length) lines.push(`Interesses: ${p.interesses.join(', ')}`);
  if (p.conditie) lines.push(`Fysieke conditie: ${p.conditie}`);
  if (p.stijl) lines.push(`Reisstijl: ${p.stijl}`);
  if (p.wensen) lines.push(`Speciale wensen: ${p.wensen}`);
  if (p.bestemmingsvoorkeur) lines.push(`Bestemmingsvoorkeur klant: ${p.bestemmingsvoorkeur}`);
  return lines.join('\n');
}

function buildSearchQuery(p) {
  const parts = [];
  if (p.bestemmingsvoorkeur) parts.push(p.bestemmingsvoorkeur);
  if (p.type) parts.push(p.type);
  if (p.interesses && p.interesses.length) parts.push(p.interesses.join(' '));
  if (p.stijl) parts.push(p.stijl);
  if (p.periode) parts.push(p.periode);
  return parts.join(' ') || 'reisadvies Doets Reizen';
}
