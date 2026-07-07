import { getIndex } from '../lib/pinecone.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { documentName } = req.body;
    if (!documentName) return res.status(400).json({ error: 'documentName is verplicht' });

    const index = await getIndex();

    const result = await index.query({
      vector: new Array(1536).fill(0),
      topK: 10000,
      includeMetadata: true,
      filter: { documentName: { $eq: documentName } }
    });

    const ids = (result.matches || []).map(m => m.id);
    if (!ids.length) {
      return res.status(404).json({ error: `Geen document gevonden met naam: ${documentName}` });
    }

    for (let i = 0; i < ids.length; i += 100) {
      await index.deleteMany(ids.slice(i, i + 100));
    }

    return res.status(200).json({
      success: true,
      documentName,
      deletedVectors: ids.length
    });

  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({ error: error.message || 'Verwijderen mislukt' });
  }
}
