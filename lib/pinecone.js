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
    const index = pc.index(indexName);
    return index;
  } catch (error) {
    console.error('Failed to get index:', error);
    throw new Error(`Index ${indexName} not found. Create it first in Pinecone dashboard.`);
  }
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
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
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
    return {
      totalVectors: stats.totalRecordCount,
      dimension: stats.dimension
    };
  } catch (error) {
    console.error('Error listing documents:', error);
    return { totalVectors: 0, dimension: 1536 };
  }
}
