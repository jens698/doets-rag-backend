import formidable from 'formidable';
import { readFileSync } from 'fs';
import { extractText, cleanText, validateDocument } from '../lib/document.js';
import { chunkText, upsertDocument } from '../lib/pinecone.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

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
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
      keepExtensions: true
    });
    
    const [fields, files] = await form.parse(req);
    
    const uploadedFile = files.file?.[0];
    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Validate
    validateDocument(uploadedFile.originalFilename, uploadedFile.size);
    
    // Extract text
    const buffer = readFileSync(uploadedFile.filepath);
    const rawText = await extractText(buffer, uploadedFile.originalFilename);
    const cleanedText = cleanText(rawText);
    
    if (!cleanedText || cleanedText.length < 50) {
      return res.status(400).json({ 
        error: 'Document contains too little text (minimum 50 characters)' 
      });
    }
    
    // Chunk text
    const chunks = chunkText(cleanedText, 500);
    
    // Generate unique document ID
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Upsert to Pinecone
    const vectorCount = await upsertDocument(
      documentId,
      uploadedFile.originalFilename,
      chunks
    );
    
    return res.status(200).json({
      success: true,
      documentId,
      filename: uploadedFile.originalFilename,
      chunks: chunks.length,
      vectors: vectorCount,
      textLength: cleanedText.length
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ 
      error: error.message || 'Upload failed'
    });
  }
}
