import { getIndex } from '../lib/pinecone.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const index = await getIndex();

    const result = await index.query({
      vector: new Array(1536).fill(0),
      topK: 10000,
      includeMetadata: true,
      filter: { isRaw: { $ne: true } }
    });

    const docMap = {};
    for (const match of (result.matches || [])) {
      const m = match.metadata || {};
      const id = m.documentId;
      if (!id) continue;
      if (!docMap[id] || m.chunkIndex === 0) {
        docMap[id] = {
          documentId:   id,
          documentName: m.documentName || '—',
          documentType: m.documentType || '—',
          version:      m.version || 1,
          uploadDate:   m.uploadDate || null,
          bestemming:   m.bestemming || null,
          active:       m.active !== false
        };
      }
    }

    const docs = Object.values(docMap)
      .filter(d => d.active)
      .sort((a, b) => (b.uploadDate || '').localeCompare(a.uploadDate || ''));

    return res.status(200).json({ documents: docs, total: docs.length });

  } catch (error) {
    console.error('Documents error:', error);
    return res.status(500).json({ error: error.message || 'Ophalen mislukt' });
  }
}
