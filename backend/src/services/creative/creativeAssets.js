import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {{ id: string, name: string, image_url: string, notes?: string }} CreativeCharacter */

let cachedCharacters = null;

export function getCharacters() {
  if (cachedCharacters) return cachedCharacters;
  const p = path.join(__dirname, 'characters.json');
  const raw = fs.readFileSync(p, 'utf8');
  cachedCharacters = JSON.parse(raw);
  return cachedCharacters;
}

export function getCharacterById(id) {
  if (!id) return null;
  return getCharacters().find(c => c.id === id) || null;
}

/** UI + prompt hints per tone (Hebrew labels in admin map to these ids). */
export const SCRIPT_TONES = [
  { id: 'young', label_he: 'צעיר / Gen-Z', hint: 'Fast, slang-light, energetic, trend-aware' },
  { id: 'serious', label_he: 'רציני / מקצועי', hint: 'Authoritative, clear facts, no hype' },
  { id: 'nature', label_he: 'טבע / רגוע', hint: 'Calm, mindful, outdoor or wellness vibe' },
  { id: 'club', label_he: 'מועדון / לילה', hint: 'High energy, nightlife, bass-forward mood' },
  { id: 'kids', label_he: 'ילדים', hint: 'Simple words, playful, safe and positive' },
  { id: 'adults', label_he: 'מבוגרים', hint: 'Mature, practical, conversational' },
  { id: 'luxury', label_he: 'יוקרה', hint: 'Polished, premium language, understated confidence' },
  { id: 'funny', label_he: 'מצחיק / קליל', hint: 'Witty, light humor, still clear CTA' }
];

export function getToneById(id) {
  return SCRIPT_TONES.find(t => t.id === id) || SCRIPT_TONES.find(t => t.id === 'adults');
}
