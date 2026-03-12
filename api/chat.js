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
          
          enhancedSystem = `${system}\n\n## ACTUELE INFORMATIE UIT KENNISDATABANK:\n\n${context}\n\n## INSTRUCTIE:\nGebruik bovenstaande actuele informatie uit de Doets kennisdatabank bij het beantwoorden van de vraag. Verwijs naar bronnen waar relevant.`;
        }
      } catch (ragError) {
        console.error('RAG search failed:', ragError);
      }
    }
    
    const anthropic = new Anthropic({ apiKey });
    
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
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
