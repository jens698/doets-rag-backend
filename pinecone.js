import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

export async function extractText(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  
  try {
    switch (ext) {
      case 'txt':
        return buffer.toString('utf-8');
      
      case 'docx':
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      
      case 'pdf':
        const data = await pdfParse(buffer);
        return data.text;
      
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
    .replace(/  +/g, ' ')
    .trim();
}

export function validateDocument(filename, filesize) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedExts = ['txt', 'pdf', 'docx'];
  const ext = filename.toLowerCase().split('.').pop();
  
  if (!allowedExts.includes(ext)) {
    throw new Error(`File type .${ext} not supported. Allowed: ${allowedExts.join(', ')}`);
  }
  
  if (filesize > maxSize) {
    throw new Error(`File too large. Maximum size: ${maxSize / 1024 / 1024}MB`);
  }
  
  return true;
}
