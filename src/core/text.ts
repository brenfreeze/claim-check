// Text helpers shared by the UI and the mock pipeline.

/**
 * Split a post into sentences on . ! ? (keeping runs like "!!!" with their sentence). A fragment ending in
 * "No." (as in "Signal No. 4") or a one-word interjection ("GRABE!") is joined to the next fragment.
 */
export function splitSentences(text: string): string[] {
  const parts = (text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
  const out: string[] = [];
  let carry = '';
  for (const p of parts) {
    const s = carry ? `${carry} ${p}` : p;
    if (/\bNo\.$/i.test(s) || p.split(/\s+/).length === 1) carry = s;
    else {
      out.push(s);
      carry = '';
    }
  }
  if (carry) out.push(carry);
  return out;
}

const TAGALOG_MARKERS = /\b(na|ng|sa|daw|raw|ang|mga|walang|niyo|natin|po|ba|lang|naman|ngayong|bukas|mamayang)\b/i;
const ENGLISH_MARKERS = /\b(the|is|are|from|this|will|and|of|to|public|schools?)\b/i;

/** Rough language label for the Home hint. */
export function detectLanguage(text: string): 'Taglish' | 'Filipino' | 'English' | null {
  if (!text.trim()) return null;
  const tl = TAGALOG_MARKERS.test(text);
  const en = ENGLISH_MARKERS.test(text);
  if (tl && en) return 'Taglish';
  if (tl) return 'Filipino';
  return 'English';
}

/** Post-level writing signals (never part of a verdict). */
export function writingSignals(text: string): string[] {
  const out: string[] = [];
  if (/\b[A-Z]{4,}\b/.test(text) || /!{2,}/.test(text)) out.push('All-caps urgency');
  if (/\b(daw|raw|sabi nila|they say)\b/i.test(text)) out.push('Hearsay (“daw”)');
  if (/\b(share|i-share|ipasa)\b/i.test(text)) out.push('Pressure to share');
  return out;
}

/** Mock claim-worthiness score; the real one is a Decima Noul question. */
export function mockClaimScore(sentence: string): number {
  if (/\b(share|i-share|ipasa)\b/i.test(sentence) && !/\d/.test(sentence)) return 0.04;
  const words = sentence.split(/\s+/).length;
  if (words < 4) return 0.2;
  return Math.min(0.95, 0.6 + words * 0.03);
}
