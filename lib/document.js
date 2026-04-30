import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import crypto from 'crypto';

const ALLOWED_TYPES = ['reis', 'excursie', 'contract', 'algemeen'];
const MIN_CONTENT_LENGTH = 300;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTS = ['txt', 'pdf', 'docx'];

export async function extractText(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();

  try {
    switch (ext) {
      case 'txt':
        return buffer.toString('utf-8');

      case 'docx': {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }

      case 'pdf': {
        try {
          const data = await pdfParse(buffer);
          if (!data.text || data.text.trim().length < 10) {
            throw new Error('PDF bevat geen leesbare tekst (mogelijk een gescande afbeelding).');
          }
          return data.text;
        } catch (pdfError) {
          try {
            const data = await pdfParse(buffer, {
              pagerender: (pageData) => {
                return pageData.getTextContent().then(tc =>
                  tc.items.map(i => i.str).join(' ')
                );
              }
            });
            if (data.text && data.text.trim().length >= 10) return data.text;
          } catch (_) {
            // fallthrough to clear error
          }
          const msg = pdfError.message || '';
          if (msg.includes('XRef') || msg.includes('xref')) {
            throw new Error(
              'Dit PDF-bestand heeft een beschadigde structuur (XRef-fout). ' +
              'Oplossing: open het bestand in Chrome of Edge → Afdrukken → "Opslaan als PDF" → upload die nieuwe versie. ' +
              'Of exporteer het document als DOCX of TXT.'
            );
          }
          if (msg.includes('encrypted') || msg.includes('password')) {
            throw new Error('Dit PDF-bestand is beveiligd met een wachtwoord. Verwijder de beveiliging en probeer opnieuw.');
          }
          throw new Error(`Kan tekst niet lezen uit PDF: ${msg}. Probeer het bestand te exporteren als DOCX of TXT.`);
        }
      }

      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error(`Failed to extract text from ${filename}: ${error.message}`);
  }
}

export function cleanText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/[ ]+\n/g, '\n')
    .trim();
}

export function validateDocument(filename, filesize, documentType) {
  const ext = filename.toLowerCase().split('.').pop();

  if (!ALLOWED_EXTS.includes(ext)) {
    throw new Error(`Bestandstype .${ext} niet ondersteund. Toegestaan: ${ALLOWED_EXTS.join(', ')}`);
  }
  if (filesize > MAX_FILE_SIZE) {
    throw new Error(`Bestand te groot. Maximum: ${MAX_FILE_SIZE / 1024 / 1024} MB`);
  }
  if (!documentType || !ALLOWED_TYPES.includes(documentType)) {
    throw new Error(`Document type verplicht. Kies uit: ${ALLOWED_TYPES.join(', ')}`);
  }
  return true;
}

export function validateContent(cleanedText) {
  const warnings = [];
  if (!cleanedText || cleanedText.length < MIN_CONTENT_LENGTH) {
    throw new Error(`Te weinig bruikbare tekst (minimum ${MIN_CONTENT_LENGTH} tekens, gevonden ${cleanedText?.length || 0}).`);
  }
  const letters = (cleanedText.match(/[a-zA-Z]/g) || []).length;
  const ratio = letters / cleanedText.length;
  if (ratio < 0.45) {
    warnings.push('Document bevat veel niet-tekstuele karakters — mogelijk een gescande PDF of tabel.');
  }
  return { warnings };
}

export function hashContent(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 2000);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

export function smartChunk(text, options) {
  const size    = options?.size    ?? 1000;
  const overlap = options?.overlap ?? 150;

  const splitter = /(?<=[.!?])\s+(?=[A-Z0-9])|\n{2,}/;
  const sentences = text.split(splitter).map(s => s.trim()).filter(Boolean);

  if (!sentences.length) return [];

  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > size) {
      if (current) { chunks.push(current.trim()); current = ''; }
      let start = 0;
      while (start < sentence.length) {
        chunks.push(sentence.slice(start, start + size).trim());
        start += size - overlap;
      }
      continue;
    }
    if ((current + ' ' + sentence).trim().length > size && current) {
      chunks.push(current.trim());
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = (tail + ' ' + sentence).trim();
    } else {
      current = current ? current + ' ' + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function extractStructuredFields(text, documentType) {
  const fields = {};
  const missing = [];
  const norm = text.replace(/\r/g, '');

  const grab = (labels) => {
    for (const label of labels) {
      const re = new RegExp(
        '(?:^|\\n)\\s*' + label + '\\s*[:\\-]\\s*(.+?)(?=\\n\\s*[A-Z][a-zA-Z ]{2,25}\\s*[:\\-]|\\n\\n|$)',
        'is'
      );
      const m = norm.match(re);
      if (m && m[1]) {
        const val = m[1].replace(/\s+/g, ' ').trim();
        if (val.length >= 2 && val.length < 800) return val;
      }
    }
    return null;
  };

  if (documentType === 'excursie') {
    fields.naam         = grab(['Naam', 'Excursie', 'Titel']);
    fields.locatie      = grab(['Locatie', 'Plaats', 'Bestemming']);
    fields.duur         = grab(['Duur', 'Tijdsduur', 'Lengte']);
    fields.inbegrepen   = grab(['Inbegrepen', 'Inclusief', 'Wat is inbegrepen']);
    fields.beschrijving = grab(['Beschrijving', 'Omschrijving', 'Over']);
    ['naam', 'locatie', 'duur'].forEach(k => { if (!fields[k]) missing.push(k); });
  } else if (documentType === 'reis') {
    fields.bestemming   = grab(['Bestemming', 'Land', 'Locatie']);
    fields.duur         = grab(['Duur', 'Reisduur', 'Aantal dagen']);
    fields.type         = grab(['Type', 'Reistype', 'Soort']);
    fields.prijs        = grab(['Prijs', 'Vanaf', 'Kosten']);
    fields.hoogtepunten = grab(['Hoogtepunten', 'Highlights']);
    if (!fields.bestemming) missing.push('bestemming');
  } else if (documentType === 'contract') {
    fields.partner      = grab(['Partner', 'Leverancier', 'Contractpartij']);
    fields.geldigheid   = grab(['Geldigheid', 'Geldig tot', 'Looptijd']);
    fields.voorwaarden  = grab(['Voorwaarden', 'Condities']);
  }

  Object.keys(fields).forEach(k => {
    if (fields[k] === null || fields[k] === undefined) delete fields[k];
  });

  return { fields, missing };
}

export function detectBestemming(text) {
  const destinations = [
    'Verenigde Staten', 'Amerika', 'Canada', 'IJsland', 'Noorwegen',
    'Zweden', 'Finland', 'Japan', 'China', 'Lapland'
  ];
  const counts = {};
  const lower = text.toLowerCase();
  for (const d of destinations) {
    const re = new RegExp('\\b' + d.toLowerCase() + '\\b', 'g');
    const m = lower.match(re);
    if (m) counts[d] = m.length;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || sorted[0][1] < 2) return null;
  return sorted[0][0] === 'Amerika' ? 'Verenigde Staten' : sorted[0][0];
}

export function priorityFor(documentType, hasRequiredFields) {
  if (documentType === 'contract') return 3;
  if (documentType === 'reis')     return hasRequiredFields ? 3 : 2;
  if (documentType === 'excursie') return hasRequiredFields ? 3 : 2;
  if (documentType === 'algemeen') return 2;
  return 1;
}

export { ALLOWED_TYPES, MIN_CONTENT_LENGTH };
