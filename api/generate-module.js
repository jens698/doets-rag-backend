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

  const { tekst } = req.body || {};
  if (!tekst || typeof tekst !== 'string' || tekst.length < 20) {
    return res.status(400).json({ error: 'Geef inwerktekst mee (min. 20 tekens)' });
  }

  const systemPrompt = `Je bent een expert in het maken van interactieve onboarding-modules voor Doets Reizen.

Op basis van de inwerktekst die de gebruiker geeft, maak je een COMPLETE onboarding-module in JSON.

Het JSON-formaat is exact:
{
  "title": "Korte moduletitel",
  "badge": "Type module (bv. Systeem, Proces, Product)",
  "desc": "Korte beschrijving (1 zin)",
  "intro": "Introductietekst (2-4 zinnen, uitleg wat de gebruiker gaat leren)",
  "duration": "Geschatte tijd (bv. '15 minuten')",
  "steps": [
    {
      "title": "Titel van de stap",
      "subtitle": "Optionele subtitel",
      "explanation": "Uitgebreide uitleg wat je in deze stap doet en waarom",
      "substeps": [
        { "action": "Concrete actie", "detail": "Toelichting bij de actie", "tip": "Optionele tip (leeg laten als niet nodig)" }
      ],
      "tip": "Optioneel: gele tip-blok (leeg als niet nodig)",
      "warning": "Optioneel: oranje waarschuwing (leeg als niet nodig)",
      "screenshot_label": "Wat een screenshot in deze stap zou moeten tonen"
    }
  ],
  "quiz": {
    "question": "Toets-vraag over het geleerde",
    "options": ["Optie 1", "Optie 2", "Optie 3"],
    "correct": 0,
    "explanation": "Uitleg waarom dit het juiste antwoord is"
  }
}

Regels:
- Maak 3 tot 7 stappen
- Elke stap 2 tot 5 substappen
- Schrijf in het Nederlands, jij-vorm
- Wees concreet en praktisch
- Antwoord ALLEEN met geldige JSON, geen extra tekst of markdown code blocks`;

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: tekst }]
    });

    const raw = response.content?.[0]?.text || '';
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    let mod;
    try {
      mod = JSON.parse(cleaned);
    } catch (parseErr) {
      return res.status(500).json({ error: 'AI gaf ongeldige JSON terug', raw: cleaned.slice(0, 500) });
    }

    return res.status(200).json({ module: mod });
  } catch (err) {
    console.error('generate-module error:', err);
    return res.status(500).json({ error: err.message || 'Generatie mislukt' });
  }
}
