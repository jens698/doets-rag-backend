import Anthropic from '@anthropic-ai/sdk';
import { searchSimilar, fetchAllChunksForDocs } from '../lib/pinecone.js'; 

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { apiKey, messages, system, useRAG = true } = req.body;

    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }

    const userMessages = messages.filter(m => m.role === 'user');
    const latestQuery  = userMessages[userMessages.length - 1]?.content || '';

    let enhancedSystem = system;

    if (useRAG && latestQuery) {
      try {
        // Step 1: find which documents are most relevant
        const searchResults = await searchSimilar(latestQuery, 10);

        if (searchResults && searchResults.length > 0) {
          // Step 2: collect unique documentIds in relevance order (max 4 docs)
          const seenIds = new Set();
          const topDocIds = [];
          for (const r of searchResults) {
            if (r.documentId && !seenIds.has(r.documentId)) {
              seenIds.add(r.documentId);
              topDocIds.push(r.documentId);
              if (topDocIds.length >= 4) break;
            }
          }

          // Step 3: fetch ALL chunks for those documents so nothing is missed
          const allChunks = await fetchAllChunksForDocs(topDocIds);

          // Sort: by document relevance rank, then by chunk order within document
          allChunks.sort((a, b) => {
            const rankA = topDocIds.indexOf(a.documentId);
            const rankB = topDocIds.indexOf(b.documentId);
            if (rankA !== rankB) return rankA - rankB;
            return (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0);
          });

          const context = allChunks
            .map((r, i) => `[Bron ${i + 1}: ${r.documentName}]\n${r.text}`)
            .join('\n\n---\n\n');

          enhancedSystem = `${system}\n\n## INFORMATIE UIT KENNISDATABANK:\n\n${context}\n\n## INSTRUCTIES:\n1. Beantwoord de vraag UITSLUITEND op basis van bovenstaande informatie uit de Doets kennisdatabank. Gebruik NOOIT je eigen trainingskennis of externe bronnen.\n2. Lees ALLE bronnen zorgvuldig — vaak staat het antwoord verspreid over meerdere bronnen.\n3. Als een vraag vraagt om een lijst, zoek in ALLE bronnen naar concrete items.\n4. Geef het antwoord dat je wél kunt geven. Alleen als er ECHT niets staat: "Ik heb hierover geen informatie in de kennisdatabank. Neem contact op met een collega."\n5. Verwijs altijd naar de bronnaam (Bron 1, Bron 2, etc).`;
        } else {
          enhancedSystem = `${system}\n\n## STRIKTE INSTRUCTIE:\nEr zijn geen relevante documenten gevonden. Geef GEEN antwoord op basis van eigen kennis. Zeg: "Ik heb hierover geen informatie in de kennisdatabank. Neem contact op met een collega."`;
        }
      } catch (ragError) {
        console.error('RAG search failed:', ragError);
      }
    }

    const anthropic    = new Anthropic({ apiKey });
    const cleanMessages = messages.map(({ role, content }) => ({ role, content }));

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: enhancedSystem,
      messages: cleanMessages
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ t: chunk.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

  } catch (error) {
    console.error('Chat error:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: { message: error.message || 'Internal server error', type: 'api_error' }
      });
    }
    try {
      res.write(`data: ${JSON.stringify({ error: error.message || 'Stream error' })}\n\n`);
      res.end();
    } catch (_) {}
  }
}
