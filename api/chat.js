import Anthropic from '@anthropic-ai/sdk';
import { searchSimilar } from '../lib/pinecone.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { apiKey, messages, system, useRAG = true } = req.body;
    
    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Invalid API key format' });
    }
    
    const userMessages = messages.filter(m => m.role === 'user');
    const latestQuery = userMessages[userMessages.length - 1]?.content || '';
    
    let enhancedSystem = system;
    
    if (useRAG && latestQuery) {
      try {
        const searchResults = await searchSimilar(latestQuery, 3);
        
        if (searchResults && searchResults.length > 0) {
          const context = searchResults
            .map((r, i) => `[Bron ${i + 1}: ${r.documentName}]\n${r.text}`)
            .join('\n\n---\n\n');

          enhancedSystem = `${system}\n\n## INFORMATIE UIT KENNISDATABANK:\n\n${context}\n\n## STRIKTE INSTRUCTIE:\nBeantwoord de vraag UITSLUITEND op basis van bovenstaande informatie uit de Doets kennisdatabank. Gebruik NOOIT je eigen trainingskennis of externe bronnen. Als de kennisdatabank onvoldoende informatie bevat om de vraag te beantwoorden, zeg dan letterlijk: "Ik heb hierover geen informatie in de kennisdatabank. Neem contact op met Doets Reizen voor meer informatie." Verwijs altijd naar de bronnaam.`;
        } else {
          enhancedSystem = `${system}\n\n## STRIKTE INSTRUCTIE:\nEr zijn geen relevante documenten gevonden in de kennisdatabank voor deze vraag. Geef GEEN antwoord op basis van eigen kennis. Zeg letterlijk: "Ik heb hierover geen informatie in de kennisdatabank. Neem contact op met Doets Reizen voor meer informatie."`;
        }
      } catch (ragError) {
        console.error('RAG search failed:', ragError);
        enhancedSystem = `${system}\n\n## STRIKTE INSTRUCTIE:\nDe kennisdatabank is momenteel niet beschikbaar. Geef GEEN antwoord op basis van eigen kennis. Laat weten dat de kennisdatabank tijdelijk niet bereikbaar is.`;
      }
    }
    
    const anthropic = new Anthropic({ apiKey });
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: enhancedSystem,
      messages: messages
    });
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ 
      error: { 
        message: error.message || 'Internal server error',
        type: 'api_error'
      }
    });
  }
}
