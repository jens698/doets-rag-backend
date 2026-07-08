import Anthropic from '@anthropic-ai/sdk';
import { searchSimilar, fetchAllChunksForDocs } from '../lib/pinecone.js';
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
    return res.status(401).json({ error: { message: 'Niet ingelogd. Ververs de pagina en log opnieuw in.' } });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY not configured on server' } });
  }

  try {
    const { messages, system, useRAG = true } = req.body;

    const userMessages = messages.filter(m => m.role === 'user');
    const latestQuery  = userMessages[userMessages.length - 1]?.content || '';

    let enhancedSystem = system;
    let sourceMeta = [];

    if (useRAG && latestQuery) {
      try {
        const searchResults = await searchSimilar(latestQuery, 10);

        if (searchResults && searchResults.length > 0) {
          const seenIds = new Set();
          const topDocIds = [];
          for (const r of searchResults) {
            if (r.documentId && !seenIds.has(r.documentId)) {
              seenIds.add(r.documentId);
              topDocIds.push(r.documentId);
              if (topDocIds.length >= 4) break;
            }
          }

          const allChunks = await fetchAllChunksForDocs(topDocIds);
          allChunks.sort((a, b) => {
            const rankA = topDocIds.indexOf(a.documentId);
            const rankB = topDocIds.indexOf(b.documentId);
            if (rankA !== rankB) return rankA - rankB;
            return (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0);
          });

          const context = allChunks
            .map((r, i) => '[Bron ' + (i + 1) + ': ' + r.documentName + ']\n' + r.text)
            .join('\n\n---\n\n');

          const seenNames = new Set();
          sourceMeta = [];
          for (const c of allChunks) {
            const name = c.documentName || 'onbekend';
            if (seenNames.has(name)) continue;
            seenNames.add(name);
            sourceMeta.push({
              name,
              documentId: c.documentId,
              snippet: (c.text || '').slice(0, 400)
            });
            if (sourceMeta.length >= 4) break;
          }

          enhancedSystem = system + '\n\n## INFORMATIE UIT KENNISDATABANK:\n\n' + context + '\n\n## INSTRUCTIES:\n1. Beantwoord de vraag UITSLUITEND op basis van bovenstaande informatie uit de Doets kennisdatabank. Gebruik NOOIT je eigen trainingskennis of externe bronnen.\n2. Lees ALLE bronnen zorgvuldig — vaak staat het antwoord verspreid over meerdere bronnen.\n3. Als een vraag vraagt om een lijst, zoek in ALLE bronnen naar concrete items.\n4. Geef het antwoord dat je wel kunt geven. Alleen als er ECHT niets staat: "Ik heb hierover geen informatie in de kennisdatabank. Neem contact op met een collega."\n5. Verwijs altijd naar de bronnaam (Bron 1, Bron 2, etc).';
        } else {
          enhancedSystem = system + '\n\n## STRIKTE INSTRUCTIE:\nEr zijn geen relevante documenten gevonden. Geef GEEN antwoord op basis van eigen kennis. Zeg: "Ik heb hierover geen informatie in de kennisdatabank. Neem contact op met een collega."';
        }
      } catch (ragError) {
        console.error('RAG search failed:', ragError);
      }
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (sourceMeta.length) {
      res.write('data: ' + JSON.stringify({ sources: sourceMeta }) + '\n\n');
    }

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: enhancedSystem,
      messages
    });

    let inputTokens = 0, outputTokens = 0;
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        res.write('data: ' + JSON.stringify({ t: event.delta.text }) + '\n\n');
      } else if (event.type === 'message_start' && event.message?.usage) {
        inputTokens = event.message.usage.input_tokens || 0;
      } else if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens || outputTokens;
      }
    }

    res.write('data: ' + JSON.stringify({ usage: { input: inputTokens, output: outputTokens } }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('Chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: { message: error.message || 'Internal server error' } });
    } else {
      res.write('data: ' + JSON.stringify({ error: error.message }) + '\n\n');
      res.end();
    }
  }
}
