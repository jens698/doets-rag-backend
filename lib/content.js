// Content-fabriek: regels, prompts en nabewerking per contenttype.
// Losse functies zonder externe afhankelijkheden, zodat ze makkelijk te testen zijn.

export const TYPES = ['social', 'nieuwsbrief', 'website'];

export const INSTAGRAM_LIMIET = 2200;

const HUISREGELS = `Huisregels van Doets Reizen (altijd toepassen):
- Schrijf in het Nederlands, in de informele je-vorm (je, jij, jouw). Nooit u of uw.
- Gebruik NOOIT een em-dash of en-dash (de lange of halflange streep). Gebruik een punt, dubbele punt, puntkomma of komma.
- Toon: warm, enthousiast en persoonlijk, maar niet overdreven. Geen clichés als "onvergetelijk avontuur" of "adembenemend" tenzij echt passend.
- Doets Reizen maakt maatwerkreizen naar Amerika, Canada, IJsland, Scandinavie, Japan en China.
- Gebruik ALLEEN feiten uit de meegeleverde context (de Doets kennisdatabank). Verzin geen prijzen, data, hotelnamen, afstanden of andere feiten.
- Ontbreekt informatie die je nodig hebt, laat het dan weg en noem het onder "let_op".`;

const REGELS = {
  social: (v) => `Je schrijft een ${v.platform === 'facebook' ? 'Facebook' : 'Instagram'}-post voor Doets Reizen.
- De post opent met een pakkende eerste zin.
- Houd het compact: 80 tot 180 woorden.
- Eindig de tekst met een CTA-regel die begint met een pijl (👉) en verwijst naar de link in bio, bijvoorbeeld: "👉 Ontdek de reis via de link in bio".
- Geef 5 tot 10 hashtags, altijd inclusief #doetsreizen. Hashtags staan NIET in "tekst" maar alleen in "hashtags".
- Emoji's mogen, maar spaarzaam (maximaal 4).`,

  nieuwsbrief: (v) => v.variant === 'listicle'
    ? `Je schrijft een Mailchimp-nieuwsbrief voor Doets Reizen in de woensdag-variant: een listicle.
- Een korte intro, dan 4 tot 6 genummerde items. Elk item is een blok met een korte kop en 2 tot 4 zinnen tekst.
- Elk blok heeft een CTA-knoptekst: HOOFDLETTERS, maximaal 5 woorden.
- Sluit af met een kort slotblok met CTA.`
    : `Je schrijft een Mailchimp-nieuwsbrief voor Doets Reizen in de zondag-variant: storytelling.
- Vertel een verhaal: neem de lezer mee alsof die er zelf is. Gebruik zintuiglijke details uit de context.
- 3 tot 4 blokken, elk met een korte kop en een alinea van 3 tot 6 zinnen.
- Het laatste blok bevat de CTA. CTA-knopteksten: HOOFDLETTERS, maximaal 5 woorden. Niet elk blok hoeft een CTA.`,

  website: (v) => `Je schrijft een ${v.variant === 'excursie' ? 'excursietekst' : 'hoteltekst'} voor doetsreizen.nl.
- Een titel (de naam van het ${v.variant === 'excursie' ? 'excursie' : 'hotel'}, eventueel met een korte toevoeging).
- Een intro van 2 tot 3 zinnen die de lezer meteen laat voelen waarom dit bijzonder is.
- 2 tot 4 alinea's met de inhoud: ${v.variant === 'excursie' ? 'wat je doet, wat je ziet, hoe lang het duurt en voor wie het geschikt is' : 'ligging, sfeer, kamers en faciliteiten, en wat je in de omgeving kunt doen'}.
- 3 tot 6 highlights als korte opsommingspunten.`
};

const FORMATEN = {
  social: `{
  "tekst": "De post zonder hashtags, met witregels tussen alinea's (\\n\\n)",
  "hashtags": ["#doetsreizen", "#..."],
  "foto_zoekwoorden": ["2 tot 5 korte zoekwoorden voor passende foto's: plaatsnamen, landen, onderwerpen"],
  "bronnen": ["documentnamen uit de context die je gebruikt hebt"],
  "let_op": ["punten die de schrijver moet controleren of aanvullen; lege lijst als alles klopt"]
}`,
  nieuwsbrief: `{
  "onderwerpregel": "Onderwerpregel, maximaal 60 tekens",
  "preheader": "Preheader, maximaal 90 tekens",
  "blokken": [ { "kop": "Kop", "tekst": "Tekst van het blok", "cta": "KNOPTEKST of lege string" } ],
  "foto_zoekwoorden": ["2 tot 5 korte zoekwoorden voor passende foto's"],
  "bronnen": ["documentnamen uit de context die je gebruikt hebt"],
  "let_op": ["punten om te controleren; lege lijst als alles klopt"]
}`,
  website: `{
  "titel": "Titel",
  "intro": "Intro van 2 tot 3 zinnen",
  "alineas": ["Alinea 1", "Alinea 2"],
  "highlights": ["Highlight 1", "Highlight 2"],
  "foto_zoekwoorden": ["2 tot 5 korte zoekwoorden voor passende foto's"],
  "bronnen": ["documentnamen uit de context die je gebruikt hebt"],
  "let_op": ["punten om te controleren; lege lijst als alles klopt"]
}`
};

// Valideert en normaliseert de invoer van de pagina.
export function normaliseerInvoer(body) {
  const b = body || {};
  const type = String(b.type || '').toLowerCase();
  if (!TYPES.includes(type)) return { error: 'Kies een contenttype: social, nieuwsbrief of website.' };
  const onderwerp = String(b.onderwerp || '').trim();
  if (onderwerp.length < 3) return { error: 'Vul een onderwerp in (bijvoorbeeld een reis, hotel of excursie).' };
  if (onderwerp.length > 300) return { error: 'Het onderwerp is te lang (maximaal 300 tekens).' };

  const v = {
    type,
    onderwerp,
    bestemming: String(b.bestemming || '').trim().slice(0, 60),
    extra: String(b.extra || '').trim().slice(0, 1500),
    platform: b.platform === 'facebook' ? 'facebook' : 'instagram',
    variant: ''
  };
  if (type === 'nieuwsbrief') v.variant = b.variant === 'listicle' ? 'listicle' : 'storytelling';
  if (type === 'website') v.variant = b.variant === 'excursie' ? 'excursie' : 'hotel';
  return { invoer: v };
}

export function zoekvraag(v) {
  return [v.onderwerp, v.bestemming].filter(Boolean).join(' ');
}

export function bouwContext(resultaten) {
  return (resultaten || [])
    .map((r, i) => `[Bron ${i + 1}: ${r.documentName || 'onbekend'}]\n${r.text || ''}`)
    .join('\n\n');
}

export function bouwPrompts(v, context) {
  const system = `Je bent de contentschrijver van Doets Reizen.

${HUISREGELS}

${REGELS[v.type](v)}

Antwoord ALLEEN met geldige JSON in exact dit formaat, zonder extra tekst of codeblok:
${FORMATEN[v.type]}`;

  const user = `ONDERWERP: ${v.onderwerp}
${v.bestemming ? `BESTEMMING: ${v.bestemming}\n` : ''}${v.extra ? `EXTRA WENSEN VAN DE SCHRIJVER: ${v.extra}\n` : ''}
CONTEXT UIT DE DOETS KENNISDATABANK:
${context || '(leeg: er is niets gevonden. Schrijf dan een algemene tekst zonder specifieke feiten en zet onder let_op dat de kennisbank niets opleverde.)'}

Schrijf nu de content.`;

  return { system, user };
}

// Haalt JSON uit een antwoord, ook als het model er toch een codeblok omheen zet.
export function parseJson(tekst) {
  const schoon = String(tekst || '').replace(/```json|```/g, '').trim();
  const start = schoon.indexOf('{');
  const eind = schoon.lastIndexOf('}');
  if (start === -1 || eind <= start) return null;
  try { return JSON.parse(schoon.slice(start, eind + 1)); } catch { return null; }
}

// Vervangt em-dashes en en-dashes tussen woorden door een komma (huisregel).
export function zonderStreepjes(s) {
  return String(s == null ? '' : s)
    .replace(/\s*[\u2014\u2015]\s*/g, ', ')
    .replace(/\s+\u2013\s+/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*/, '');
}

function lijst(x) {
  return Array.isArray(x) ? x.map(v => zonderStreepjes(v)).filter(Boolean) : [];
}

function normHashtag(h) {
  const t = String(h || '').trim().replace(/\s+/g, '');
  if (!t) return '';
  return t.startsWith('#') ? t : '#' + t;
}

// Past de huisregels toe op het modelantwoord en voegt waarschuwingen toe.
export function nabewerken(v, data) {
  const d = data || {};
  const uit = {
    type: v.type,
    variant: v.variant || v.platform,
    foto_zoekwoorden: lijst(d.foto_zoekwoorden).slice(0, 5),
    bronnen: [...new Set(lijst(d.bronnen))],
    let_op: lijst(d.let_op),
    waarschuwingen: []
  };

  if (v.type === 'social') {
    let tags = lijst(d.hashtags).map(normHashtag).filter(Boolean);
    if (!tags.some(t => t.toLowerCase() === '#doetsreizen')) tags.unshift('#doetsreizen');
    tags = [...new Set(tags)];
    uit.platform = v.platform;
    uit.tekst = zonderStreepjes(d.tekst).trim();
    uit.hashtags = tags;
    uit.volledig = uit.tekst + '\n\n' + tags.join(' ');
    uit.tekens = [...uit.volledig].length;
    if (!/👉|➡️|→/.test(uit.tekst)) uit.waarschuwingen.push('De pijl-CTA naar de link in bio ontbreekt.');
    if (v.platform === 'instagram' && uit.tekens > INSTAGRAM_LIMIET) {
      uit.waarschuwingen.push(`De post is ${uit.tekens} tekens, dat is meer dan de Instagram-limiet van ${INSTAGRAM_LIMIET}.`);
    }
  }

  if (v.type === 'nieuwsbrief') {
    uit.onderwerpregel = zonderStreepjes(d.onderwerpregel).trim();
    uit.preheader = zonderStreepjes(d.preheader).trim();
    uit.blokken = (Array.isArray(d.blokken) ? d.blokken : []).map(b => ({
      kop: zonderStreepjes(b && b.kop).trim(),
      tekst: zonderStreepjes(b && b.tekst).trim(),
      cta: zonderStreepjes(b && b.cta).trim().toUpperCase()
    })).filter(b => b.kop || b.tekst);
    uit.blokken.forEach((b, i) => {
      const woorden = b.cta ? b.cta.split(/\s+/).length : 0;
      if (woorden > 5) uit.waarschuwingen.push(`CTA in blok ${i + 1} heeft ${woorden} woorden (maximaal 5).`);
    });
    if (uit.onderwerpregel.length > 60) uit.waarschuwingen.push(`Onderwerpregel is ${uit.onderwerpregel.length} tekens (advies: maximaal 60).`);
  }

  if (v.type === 'website') {
    uit.titel = zonderStreepjes(d.titel).trim();
    uit.intro = zonderStreepjes(d.intro).trim();
    uit.alineas = lijst(d.alineas);
    uit.highlights = lijst(d.highlights);
  }

  const alleTekst = JSON.stringify(uit);
  if (/\b(u|uw)\b/i.test(alleTekst.replace(/"(waarschuwingen|let_op)":\[[^\]]*\]/g, ''))) {
    uit.waarschuwingen.push('De tekst lijkt "u" of "uw" te bevatten. Doets schrijft altijd in de je-vorm.');
  }
  if (!uit.bronnen.length) uit.waarschuwingen.push('Er zijn geen bronnen uit de kennisbank gebruikt. Controleer de feiten extra goed.');
  return uit;
}

// Bouwt een Cloudinary-zoekexpressie voor foto's in de map doets/.
export function fotoExpressie(woorden) {
  const termen = [...new Set((woorden || [])
    .map(w => String(w || '').replace(/["\\()*:]/g, ' ').trim())
    .filter(w => w.length >= 3))].slice(0, 6);
  if (!termen.length) return null;
  const vrij = termen.map(t => `"${t}"`).join(' OR ');
  return `resource_type:image AND folder:doets/* AND (${vrij})`;
}
