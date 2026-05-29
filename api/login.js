import { createToken } from '../lib/auth.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { naam, wachtwoord } = req.body || {};
  if (!naam || !wachtwoord) {
    return res.status(400).json({ error: 'Naam en wachtwoord zijn verplicht' });
  }

  let employees;
  try {
    employees = JSON.parse(process.env.EMPLOYEES || '[]');
  } catch {
    return res.status(500).json({ error: 'Serverconfiguratie fout — neem contact op met de beheerder' });
  }

  if (!employees.length) {
    return res.status(500).json({ error: 'Geen medewerkers geconfigureerd — neem contact op met de beheerder' });
  }

  const employee = employees.find(e =>
    e.naam.toLowerCase() === naam.trim().toLowerCase() && e.wachtwoord === wachtwoord
  );

  if (!employee) {
    return res.status(401).json({ error: 'Naam of wachtwoord onjuist' });
  }

  const token = createToken(employee.naam);
  return res.status(200).json({ token, naam: employee.naam });
}
