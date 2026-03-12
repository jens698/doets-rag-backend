import { searchSimilar } from '../lib/pinecone.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { query, topK = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const results = await searchSimilar(query, topK);
    
    return res.status(200).json({
      query,
      results,
      count: results.length
    });
    
  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ 
      error: error.message || 'Search failed'
    });
  }
}
