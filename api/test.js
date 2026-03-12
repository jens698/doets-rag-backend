export default async function handler(req, res) {
  return res.status(200).json({ 
    message: "Het werkt!", 
    timestamp: new Date().toISOString() 
  });
}
```

4. Commit

---

**Wacht 1 minuut, test dan:**
```
https://jouw-url.vercel.app/api/test
