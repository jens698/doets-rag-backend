import { Pinecone } from '@pinecone-database/pinecone';

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
    const index = pc.index(indexName);
    return index;
  } catch (error) {
    console.error('Failed to get index:', error);
    throw new Error(`Index ${indexName} not found. Create it first in Pinecone dashboard.`);
  }
}

// Chunk text into smaller pieces
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
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Generate embeddings via Anthropic (using their embedding model when available)
// For now, we'll use a simple approach - in production you'd use OpenAI embeddings
export async function generateEmbedding(text) {
  // Simple embedding simulation - in production use OpenAI or Cohere
  // This creates a 1536-dimensional vector (OpenAI standard)
  const hash = simpleHash(text);
  const embedding = new Array(1536).fill(0).map((_, i) => {
    return Math.sin(hash * (i + 1) * 0.01) * Math.cos(hash * i * 0.02);
  });
  return embedding;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export async function upsertDocument(documentId, documentName, chunks) {
  const index = await getIndex();
  const vectors = [];
  
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i]);
    vectors.push({
      id: `${documentId}_chunk_${i}`,
      values: embedding,
      metadata: {
        documentId,
        documentName,
        chunkIndex: i,
        text: chunks[i],
        timestamp: Date.now()
      }
    });
  }
  
  await index.upsert(vectors);
  return vectors.length;
}

export async function searchSimilar(query, topK = 5) {
  const index = await getIndex();
  const queryEmbedding = await generateEmbedding(query);
  
  const results = await index.query({
    vector: queryEmbedding,
    topK,
    includeMetadata: true
  });
  
  return results.matches.map(match => ({
    score: match.score,
    text: match.metadata.text,
    documentName: match.metadata.documentName,
    documentId: match.metadata.documentId
  }));
}

export async function deleteDocument(documentId) {
  const index = await getIndex();
  
  // Delete all chunks for this document
  // Pinecone doesn't support prefix deletion, so we need to list and delete
  const vectors = await index.listVectors({ prefix: `${documentId}_` });
  
  if (vectors && vectors.length > 0) {
    await index.deleteMany(vectors);
  }
  
  return true;
}

export async function listAllDocuments() {
  const index = await getIndex();
  
  try {
    const stats = await index.describeIndexStats();
    // This is a simplified version - in production you'd maintain a separate metadata store
    return {
      totalVectors: stats.totalRecordCount,
      dimension: stats.dimension
    };
  } catch (error) {
    console.error('Error listing documents:', error);
    return { totalVectors: 0, dimension: 1536 };
  }
}
