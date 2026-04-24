import formidable from 'formidable';
import { readFileSync } from 'fs';
import {
  extractText,
  cleanText,
  validateDocument,
  validateContent,
  smartChunk,
  extractStructuredFields,
  detectBestemming,
  hashContent,
  priorityFor,
  ALLOWED_TYPES
} from '../lib/document.js';
import {
  upsertDocumentV2,
  findActiveVectorsByName,
  markVectorsInactive,
  checkDuplicate
} from '../lib/pinecone.js';

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024, keepExtensions: true });
    const [fields, files] = await form.parse(req);

    const uploadedFile  = files.file?.[0];
    const documentType  = (fields.document_type?.[0] || '').trim().toLowerCase();
    const forceUpload   = fields.force?.[0] === 'true';
    const manualDest    = (fields.bestemming?.[0] || '').trim() || null;

    if (!uploadedFile) {
      return res.status(400).json({ error: 'Geen bestand geüpload.' });
    }
    if (!documentType) {
      return res.status(400).json({
        error: `document_type verplicht. Kies uit: ${ALLOWED_TYPES.join(', ')}.`
      });
    }

    validateDocument(uploadedFile.originalFilename, uploadedFile.size, documentType);

    const buffer      = readFileSync(uploadedFile.filepath);
    const rawText     = await extractText(buffer, uploadedFile.originalFilename);
    const cleanedText = cleanText(rawText);

    const { warnings: contentWarnings } = validateContent(cleanedText);
    const warnings = [...contentWarnings];

    const { fields: structuredFields, missing } = extractStructuredFields(cleanedText, documentType);
    if (missing.length) {
      warnings.push(`Ontbrekende structuurvelden: ${missing.join(', ')}`);
    }

    const bestemming = manualDest
      || structuredFields.bestemming
      || structuredFields.locatie
      || detectBestemming(cleanedText);

    const contentHash = hashContent(cleanedText);
    let dupInfo = { isDuplicate: false };
    try {
      dupInfo = await checkDuplicate(cleanedText, {
        excludeDocumentName: uploadedFile.originalFilename
      });
    } catch (e) {
      console.warn('duplicate check skipped:', e.message);
    }

    if (dupInfo.isDuplicate && !forceUpload) {
      return res.status(409).json({
        error: 'Mogelijke dubbele upload gedetecteerd.',
        similarTo: dupInfo.similarTo,
        score: dupInfo.score,
        hint: 'Verstuur opnieuw met force=true om te negeren, of upload als nieuwe versie met dezelfde bestandsnaam.'
      });
    }

    const existingMatches = await findActiveVectorsByName(uploadedFile.originalFilename);
    const oldVersions = [...new Set(
      existingMatches.map(m => m.metadata?.version).filter(v => typeof v === 'number')
    )];
    const version = (oldVersions.length ? Math.max(...oldVersions) : 0) + 1;

    let deactivatedCount = 0;
    if (existingMatches.length) {
      const oldIds = existingMatches.map(m => m.id);
      deactivatedCount = await markVectorsInactive(oldIds);
      warnings.push(`Vorige versie gedeactiveerd (${deactivatedCount} vectors). Nieuwe versie: v${version}.`);
    }

    const chunks = smartChunk(cleanedText, { size: 1000, overlap: 150 });
    if (!chunks.length) {
      return res.status(400).json({ error: 'Kon geen bruikbare chunks maken uit document.' });
    }

    const hasRequired = missing.length === 0;
    const priority    = priorityFor(documentType, hasRequired);
    const documentId  = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const vectorCount = await upsertDocumentV2({
      documentId,
      documentName:   uploadedFile.originalFilename,
      documentType,
      version,
      bestemming,
      priority,
      source:         'manual',
      rawText,
      chunks,
      structuredFields
    });

    return res.status(200).json({
      success: true,
      documentId,
      filename:        uploadedFile.originalFilename,
      documentType,
      version,
      previousVersionsDeactivated: deactivatedCount,
      bestemming:      bestemming || null,
      priority,
      chunks:          chunks.length,
      vectors:         vectorCount,
      textLength:      cleanedText.length,
      structuredFields,
      missingFields:   missing,
      contentHash,
      warnings,
      duplicateSimilarity: dupInfo.score || null
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      error: error.message || 'Upload mislukt'
    });
  }
}
