import { v2 as cloudinary } from 'cloudinary';
import formidable from 'formidable';
import { readFileSync } from 'fs';
import { verifyToken } from '../lib/auth.js';

export const config = {
  api: { bodyParser: false }
};

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

function auth(req) {
  const h = req.headers['authorization'] || '';
  const t = h.replace('Bearer ', '');
  return verifyToken(t);
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const ROOT = 'doets';

function safeFolder(f) {
  if (!f) return ROOT;
  const trimmed = String(f).trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return ROOT;
  if (trimmed.startsWith(ROOT + '/') || trimmed === ROOT) return trimmed;
  return ROOT + '/' + trimmed;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return res.status(500).json({ error: 'Cloudinary is niet geconfigureerd. Zet CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY en CLOUDINARY_API_SECRET in Vercel.' });
  }
  configureCloudinary();

  if (!auth(req)) {
    return res.status(401).json({ error: 'Niet ingelogd.' });
  }

  try {
    if (req.method === 'GET') {
      const action = req.query.action || 'list';

      if (action === 'folders') {
        try {
          const r = await cloudinary.api.sub_folders(ROOT);
          return res.status(200).json({ folders: (r.folders || []).map(f => f.path) });
        } catch (e) {
          if (e.error && e.error.http_code === 404) return res.status(200).json({ folders: [] });
          throw e;
        }
      }

      if (action === 'list') {
        const folder = safeFolder(req.query.folder);
        const next = req.query.next_cursor || undefined;
        const search = cloudinary.search
          .expression('folder:"' + folder + '" AND resource_type:image')
          .max_results(60)
          .sort_by('created_at', 'desc')
          .with_field('tags')
          .with_field('context');
        if (next) search.next_cursor(next);
        const r = await search.execute();
        const photos = (r.resources || []).map(p => ({
          public_id: p.public_id,
          folder: p.folder || folder,
          filename: p.filename || (p.public_id.split('/').pop()),
          format: p.format,
          width: p.width,
          height: p.height,
          bytes: p.bytes,
          created_at: p.created_at,
          uploader: (p.context && p.context.uploader) || '',
          caption: (p.context && p.context.caption) || '',
          tags: p.tags || [],
          secure_url: p.secure_url,
          thumb_url: cloudinary.url(p.public_id, { width: 320, height: 320, crop: 'fill', quality: 'auto', fetch_format: 'auto', secure: true }),
          preview_url: cloudinary.url(p.public_id, { width: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto', secure: true })
        }));
        return res.status(200).json({ photos, next_cursor: r.next_cursor || null });
      }

      return res.status(400).json({ error: 'Onbekende actie' });
    }

    if (req.method === 'POST') {
      const form = formidable({ maxFileSize: 30 * 1024 * 1024, keepExtensions: true, multiples: true });
      const [fields, files] = await form.parse(req);
      const folder = safeFolder(Array.isArray(fields.folder) ? fields.folder[0] : fields.folder);
      const uploader = Array.isArray(fields.uploader) ? fields.uploader[0] : (fields.uploader || 'onbekend');
      const uploaded = [];
      const errors = [];

      const list = files.file
        ? (Array.isArray(files.file) ? files.file : [files.file])
        : [];

      if (!list.length) return res.status(400).json({ error: 'Geen bestanden ontvangen' });

      for (const f of list) {
        try {
          const buf = readFileSync(f.filepath);
          const b64 = 'data:' + (f.mimetype || 'image/jpeg') + ';base64,' + buf.toString('base64');
          const result = await cloudinary.uploader.upload(b64, {
            folder,
            resource_type: 'image',
            context: { uploader, original_filename: f.originalFilename || '' },
            use_filename: true,
            unique_filename: true,
            overwrite: false
          });
          uploaded.push({
            public_id: result.public_id,
            secure_url: result.secure_url,
            width: result.width,
            height: result.height,
            bytes: result.bytes
          });
        } catch (err) {
          errors.push({ file: f.originalFilename, error: err.message });
        }
      }

      return res.status(200).json({ uploaded, errors });
    }

    if (req.method === 'DELETE') {
      const public_id = req.query.public_id;
      const body = req.headers['content-length'] && parseInt(req.headers['content-length']) > 0 ? await bodyJson(req) : {};
      const ids = public_id ? [public_id] : (body.public_ids || []);
      if (!ids.length) return res.status(400).json({ error: 'public_id ontbreekt' });
      const result = await cloudinary.api.delete_resources(ids, { resource_type: 'image' });
      return res.status(200).json({ deleted: result.deleted });
    }

    if (req.method === 'PATCH') {
      const body = await bodyJson(req);
      if (body.action === 'create_folder') {
        const folder = safeFolder(body.folder);
        await cloudinary.api.create_folder(folder);
        return res.status(200).json({ folder });
      }
      if (body.action === 'delete_folder') {
        const folder = safeFolder(body.folder);
        if (folder === ROOT) return res.status(400).json({ error: 'Root map kan niet verwijderd' });
        await cloudinary.api.delete_folder(folder);
        return res.status(200).json({ deleted: folder });
      }
      if (body.action === 'update') {
        const { public_id, tags, caption } = body;
        if (!public_id) return res.status(400).json({ error: 'public_id ontbreekt' });
        const opts = { resource_type: 'image' };
        if (Array.isArray(tags)) opts.tags = tags.join(',');
        if (typeof caption === 'string') opts.context = 'caption=' + caption;
        await cloudinary.uploader.explicit(public_id, { type: 'upload', ...opts });
        return res.status(200).json({ ok: true });
      }
      if (body.action === 'rename') {
        const { public_id, new_public_id } = body;
        if (!public_id || !new_public_id) return res.status(400).json({ error: 'public_id + new_public_id vereist' });
        const r = await cloudinary.uploader.rename(public_id, new_public_id, { resource_type: 'image', overwrite: false });
        return res.status(200).json({ public_id: r.public_id });
      }
      return res.status(400).json({ error: 'Onbekende PATCH actie' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('photos api error:', err);
    return res.status(500).json({ error: err.message || 'Fout in fotobibliotheek' });
  }
}
