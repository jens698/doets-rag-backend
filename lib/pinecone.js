import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

let pineconeClient = null;

export async function getPinecone() {
  if (pineconeClient) return pineconeClient;

  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) throw new Error('PINECONE_API_KEY not configured');

  pineconeClient = new Pinecone({ apiKey });
  return pineconeClient;
}

export async function getIndex() {
  const pc = await getPinecone();
  const indexName = process.env.PINECONE_INDEX || 'doets-knowledge';

  try {
    return pc.index(indexName);
  } catch (error) {
    console.error('Failed to get index:', error);
    throw new Error(`Index ${indexName} not found. Create it first in Pinecone dashboard.`);
  }
}

export async function generateEmbedding(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const openai = new OpenAI({ apiKey });
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return response.data[0].embedding;
}

function zeroVector(dim = 1536) {
  return new Array(dim).fill(0);
}
// Fetch ALL clean chunks of one or more documents (used to give Claude full doc context)
export async function fetchAllChunksForDocs(documentIds) {
  if (!documentIds?.length) return [];
  const index = await getIndex();
  const out = [];
  for (const docId of documentIds) {
    try {
      const r = await index.query({
        vector: zeroVector(),
        topK: 200,
        includeMetadata: true,
        filter: {
          documentId: { $eq: docId },
          isRaw:      { $ne: true },
          active:     { $ne: false }
        }
      });
      for (const m of (r.matches || [])) {
        out.push({
          text:         m.metadata?.text || '',
          documentName: m.metadata?.documentName,
          documentId:   m.metadata?.documentId,
          chunkIndex:   m.metadata?.chunkIndex ?? 0
        });
      }
    } catch (e) {
      console.warn('fetchAllChunksForDocs failed for', docId, e.message);
    }
  }
  return out;
}


export async function findActiveVectorsByName(documentName, { limit = 2000 } = {}) {
  const index = await getIndex();
  try {
    const result = await index.query({
      vector: zeroVector(),
      topK: Math.min(limit, 10000),
      includeMetadata: true,
      filter: { documentName: { $eq: documentName }, active: { $eq: true } }
    });
    return result.matches || [];
  } catch (e) {
    console.warn('findActiveVectorsByName failed:', e.message);
    return [];
  }
}

export async function markVectorsInactive(vectorIds) {
  if (!vectorIds?.length) return 0;
  const index = await getIndex();
  let updated = 0;
  for (const id of vectorIds) {
    try {
      await index.update({ id, metadata: { active: false } });
      updated++;
    } catch (e) {
      console.warn('mark inactive failed for', id, e.message);
    }
  }
  return updated;
}

export async function checkDuplicate(text, { excludeDocumentName } = {}) {
  const index = await getIndex();
  try {
    const emb = await generateEmbedding(text.slice(0, 2000));
    const filter = { active: { $eq: true } };
    if (excludeDocumentName) filter.documentName = { $ne: excludeDocumentName };

    const result = await index.query({
      vector: emb,
      topK: 3,
      includeMetadata: true,
      filter
    });

    const top = result.matches?.[0];
    if (top && top.score > 0.93) {
      return {
        isDuplicate: true,
        similarTo: top.metadata?.documentName,
        score: top.score
      };
    }
    return { isDuplicate: false };
  } catch (e) {
    console.warn('checkDuplicate failed:', e.message);
    return { isDuplicate: false, error: e.message };
  }
}

export async function upsertDocumentV2({
  documentId,
  documentName,
  documentType,
  version,
  bestemming,
  priority,
  source,
  rawText,
  chunks,
  structuredFields
}) {
  const index = await getIndex();
  const uploadDate = new Date().toISOString();
  const vectors = [];

  const rawEmbedding = await generateEmbedding(rawText.slice(0, 2000));
  vectors.push({
    id: `${documentId}_raw`,
    values: rawEmbedding,
    metadata: {
      documentId,
      documentName,
      documentType,
      version,
      active: true,
      isRaw: true,
      priority,
      source,
      uploadDate,
      text: rawText.slice(0, 30000),
      ...(bestemming ? { bestemming } : {})
    }
  });

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i]);
    vectors.push({
      id: `${documentId}_chunk_${i}`,
      values: embedding,
      metadata: {
        documentId,
        documentName,
        documentType,
        version,
        active: true,
        isRaw: false,
        priority,
        source,
        uploadDate,
        chunkIndex: i,
        text: chunks[i],
        ...(bestemming ? { bestemming } : {}),
        ...(structuredFields && Object.keys(structuredFields).length
              ? { structuredKeys: Object.keys(structuredFields).join(',') }
              : {})
      }
    });
  }

  const batchSize = 100;
  for (let i = 0; i < vectors.length; i += batchSize) {
    await index.upsert(vectors.slice(i, i + batchSize));
  }
  return vectors.length;
}

export async function upsertDocument(documentId, documentName, chunks) {
  return upsertDocumentV2({
    documentId,
    documentName,
    documentType: 'algemeen',
    version: 1,
    priority: 2,
    source: 'manual',
    rawText: chunks.join('\n\n'),
    chunks
  });
}

export function chunkText(text, maxChunkSize = 500) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += ' ' + sentence;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}

export async function searchSimilar(query, topK = 5, filters = {}) {
  const index = await getIndex();
  const queryEmbedding = await generateEmbedding(query);

   const filter = {
    active: { $ne: false },
    isRaw:  { $ne: true },
    ...filters
  };

  const results = await index.query({
    vector: queryEmbedding,
    topK: topK * 2,
    includeMetadata: true,
    filter
  });

  const scored = (results.matches || []).map(match => {
    const priority = match.metadata?.priority || 2;
    const boost = 1 + (priority - 2) * 0.03;
    return {
      score: match.score,
      boostedScore: match.score * boost,
      text: match.metadata.text,
      documentName: match.metadata.documentName,
      documentId: match.metadata.documentId,
      documentType: match.metadata.documentType,
      bestemming: match.metadata.bestemming,
      version: match.metadata.version,
      priority
    };
  });

  scored.sort((a, b) => b.boostedScore - a.boostedScore);
  return scored.slice(0, topK);
}

export async function deleteDocument(documentId) {
  const index = await getIndex();
  try {
    await index.deleteMany({ documentId: { $eq: documentId } });
  } catch (e) {
    console.warn('deleteDocument via filter failed, trying prefix list:', e.message);
    try {
      const list = await index.listPaginated?.({ prefix: `${documentId}_` });
      const ids = list?.vectors?.map(v => v.id) || [];
      if (ids.length) await index.deleteMany(ids);
    } catch (err) {
      console.error('deleteDocument fallback failed:', err.message);
    }
  }
  return true;
}

export async function listAllDocuments() {
  const index = await getIndex();
  try {
    const stats = await index.describeIndexStats();
    return {
      totalVectors: stats.totalRecordCount,
      dimension: stats.dimension
    };
  } catch (error) {
    console.error('Error listing documents:', error);
    return { totalVectors: 0, dimension: 1536 };
  }
}
