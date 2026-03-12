# Doets Reizen RAG Backend

Complete backend voor de Doets kennisdatabank met document upload, vector search en AI chat.

## 🎯 Wat doet dit systeem?

- ✅ Upload Word/PDF/TXT documenten via admin panel
- ✅ Automatische text extraction en chunking
- ✅ Vector embeddings opslaan in Pinecone
- ✅ Smart retrieval bij chat vragen (RAG)
- ✅ Admin panel voor document beheer
- ✅ API endpoints voor kennisdatabank frontend

## 📦 Wat zit erin?

```
doets-rag-backend/
├── api/
│   ├── chat.js       # Chat endpoint met RAG
│   ├── upload.js     # Document upload
│   ├── search.js     # Test zoekfunctie
│   └── stats.js      # Database statistieken
├── lib/
│   ├── pinecone.js   # Pinecone utilities
│   └── document.js   # Document processing
├── public/
│   └── admin.html    # Admin panel UI
├── package.json
├── vercel.json
└── README.md
```

## 🚀 Installatie (Eenmalig - 10 minuten)

### Stap 1: Pinecone Index Aanmaken

1. Ga naar [app.pinecone.io](https://app.pinecone.io)
2. Log in met je account
3. Klik **Create Index**
4. Configuratie:
   - **Name:** `doets-knowledge`
   - **Dimensions:** `1536`
   - **Metric:** `cosine`
   - **Cloud:** `AWS`
   - **Region:** `us-east-1` (gratis tier)
5. Klik **Create Index**

Wacht tot de index status "Ready" is (30-60 seconden).

### Stap 2: Vercel CLI Installeren

```bash
npm install -g vercel
```

Als je nog geen npm hebt: installeer eerst [Node.js](https://nodejs.org)

### Stap 3: Login bij Vercel

```bash
vercel login
```

Browser opent → log in met je Vercel account.

### Stap 4: Deploy Backend

Navigeer naar deze map:

```bash
cd pad/naar/doets-rag-backend
```

Deploy:

```bash
vercel --prod
```

Vragen van Vercel:
- **Set up and deploy?** → `Y`
- **Which scope?** → Selecteer je account
- **Link to existing project?** → `N`
- **Project name?** → `doets-rag-backend`
- **Directory?** → Druk Enter

Na 1-2 minuten zie je:

```
✅ Production: https://doets-rag-backend-xxxxx.vercel.app
```

**KOPIEER DEZE URL!**

### Stap 5: Omgevingsvariabelen Instellen

Ga naar [vercel.com/dashboard](https://vercel.com/dashboard):

1. Klik op je project `doets-rag-backend`
2. Ga naar **Settings** → **Environment Variables**
3. Voeg toe:
   - **Name:** `PINECONE_API_KEY`
   - **Value:** `pcsk_3ayZeq_EjZwTAp7f1AS1BF634rXjTqDaMFP27jo9RRMPzoKDYofcyjSpYsoz6A6yH6X4LK`
   - **Environment:** Selecteer alle (Production, Preview, Development)

4. Voeg toe:
   - **Name:** `PINECONE_INDEX`
   - **Value:** `doets-knowledge`
   - **Environment:** Selecteer alle

5. Klik **Save**

### Stap 6: Redeploy

Terug naar terminal:

```bash
vercel --prod
```

Dit duurt 30 seconden. Nu is alles klaar!

## ✅ Testen

### Test 1: Admin Panel

Open in browser:
```
https://jouw-url.vercel.app/admin
```

Je ziet:
- Database statistieken
- Upload interface
- Test zoekfunctie
- Activity log

### Test 2: Document Uploaden

1. Maak een test .txt bestand:
   ```
   Doets Reizen test document.
   
   Dit is een test om te kijken of de upload werkt.
   We bieden camperreizen in Canada aan.
   ```

2. Sleep naar upload area of klik en selecteer
3. Kijk in activity log: "✓ succesvol geüpload: X chunks, Y vectors"
4. Statistieken worden bijgewerkt

### Test 3: Zoeken

1. Type in zoekbalk: "camperreizen Canada"
2. Klik **Zoeken**
3. Je ziet resultaten met score en tekst uit je document

### Test 4: API Endpoints

Test chat endpoint:
```bash
curl -X POST https://jouw-url.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "sk-ant-...",
    "messages": [{"role":"user","content":"Wat bieden jullie aan?"}],
    "system": "Je bent Doets Reizen assistent",
    "useRAG": true
  }'
```

## 🔧 API Endpoints

### POST /api/chat
Chat met RAG ondersteuning
```json
{
  "apiKey": "sk-ant-...",
  "messages": [...],
  "system": "...",
  "useRAG": true
}
```

### POST /api/upload
Upload document (multipart/form-data)
- Field: `file`
- Accepts: .pdf, .docx, .txt
- Max: 10MB

### POST /api/search
Test search (geen auth nodig)
```json
{
  "query": "zoekterm",
  "topK": 5
}
```

### GET /api/stats
Database statistieken (geen auth nodig)

## 📊 Hoe RAG Werkt

1. **Upload:** Document → Text extraction → Chunking (500 chars)
2. **Embedding:** Elke chunk → Vector embedding (1536 dimensies)
3. **Storage:** Vectors → Pinecone met metadata
4. **Search:** Vraag → Vector → Top 5 matches
5. **Augment:** Matches → System prompt → Claude → Antwoord

## 🎨 Frontend Integratie

Update je `doets-kennisdatabank-v4.html`:

Zoek naar:
```javascript
const r = await fetch('https://api.anthropic.com/v1/messages', {
```

Vervang met:
```javascript
const r = await fetch('https://jouw-url.vercel.app/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    apiKey: apiKey,
    system: SYSTEM,
    messages: history,
    useRAG: true  // Enable RAG!
  })
});
```

Nu gebruikt de chat automatisch geüploade documenten!

## 💰 Kosten

- **Pinecone:** Gratis tier (100k vectors, 1 index)
- **Vercel:** Gratis tier (100GB bandwidth)
- **Anthropic API:** Zoals gebruikelijk (~€0,01-0,03 per chat)

## 🔐 Beveiliging

⚠️ **LET OP:** De Pinecone API key staat momenteel in `vercel.json`. Voor productie:

1. Verwijder `env` sectie uit `vercel.json`
2. Stel keys in via Vercel dashboard (zie Stap 5)
3. Commit nooit API keys in git!

## 🐛 Troubleshooting

### "Index doets-knowledge not found"
→ Maak index aan in Pinecone (Stap 1)

### "Failed to upload"
→ Check file size (<10MB) en type (.pdf, .docx, .txt)

### "PINECONE_API_KEY not configured"
→ Stel environment variables in (Stap 5) en redeploy

### Admin panel laadt niet
→ Check: `https://jouw-url.vercel.app/admin`
→ Kijk in Vercel logs: vercel.com/dashboard

### RAG werkt niet
→ Upload eerst documenten via admin panel
→ Test search endpoint apart
→ Check Pinecone dashboard of vectors zijn toegevoegd

## 📈 Volgende Stappen

Dingen om toe te voegen:
- [ ] Document lijst in admin panel
- [ ] Delete functie voor documenten
- [ ] Betere embeddings (OpenAI API)
- [ ] Authenticatie voor admin panel
- [ ] Bulk upload
- [ ] Document categorieën

## 📞 Support

- Vercel logs: [vercel.com/dashboard](https://vercel.com/dashboard)
- Pinecone dashboard: [app.pinecone.io](https://app.pinecone.io)
- API testen: gebruik Postman of curl

---

**Gemaakt voor Doets Reizen** 🚐🌲
