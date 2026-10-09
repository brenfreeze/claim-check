// On-device OCR of a screenshot into sentences with a claim score: Apple Vision lines (modules/apple-llm) → paragraphs
// (by vertical gap) → sentences. Lines that are screen chrome (page name, "3h · Public", Like/Comment/Share) are dropped.
import { File, Paths } from 'expo-file-system';
import { Image } from 'react-native';
import { recognizeTextLines, type OcrLine } from '../../modules/apple-llm';
import type { OcrResult } from './checkTypes';
import { mockClaimScore, splitSentences } from './text';

/** Short unpunctuated lines and post furniture: not part of what the post claims. */
function isChrome(line: string): boolean {
  const t = line.trim();
  if (/^(like|comment|share|reply|send|follow|see more|see translation|\d+[smhdw]|\d+ (comments?|shares?))\b/i.test(t)) return true;
  if (/·|\bpublic\b|\d+\s*(h|hr|hrs|m|min|d)\s*$/i.test(t) && t.split(/\s+/).length <= 6) return true;
  return false;
}

/** Lines → paragraphs: a gap bigger than ~0.9 line heights starts a new paragraph. Exported for tests. */
export function linesToSentences(lines: OcrLine[]): string[] {
  const body = [...lines].sort((a, b) => a.top - b.top).filter((l) => l.text.trim() && !isChrome(l.text));
  const paragraphs: string[][] = [];
  let prev: OcrLine | null = null;
  for (const l of body) {
    const gap = prev ? l.top - (prev.top + prev.height) : Infinity;
    if (!prev || gap > Math.max(prev.height, l.height) * 0.9) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(l.text.trim());
    prev = l;
  }
  return paragraphs.flatMap((p) => splitSentences(p.join(' ').replace(/-\s+(?=\p{Ll})/gu, '')));
}

export function scoreSentence(s: string): number {
  // a fragment with no sentence punctuation (a page name, a caption stub) is rarely a checkable claim
  if (!/[.!?]$/.test(s.trim()) && s.split(/\s+/).length < 8) return 0.1;
  return mockClaimScore(s);
}

export async function recognizeText(imageUri: string | null): Promise<OcrResult> {
  if (!imageUri) throw new Error('No screenshot picked');
  const t0 = Date.now();
  const lines = await recognizeTextLines(imageUri);
  const sentences = linesToSentences(lines).map((text) => ({ text, claimScore: scoreSentence(text) }));
  return { sentences, ms: Date.now() - t0 };
}

/** File URI of the bundled demo screenshot. A Debug build serves assets from Metro, so copy it into the cache first. */
export async function demoScreenshotUri(): Promise<string> {
  const { uri } = Image.resolveAssetSource(require('../../assets/demo/demo-screenshot.png'));
  if (!/^https?:/.test(uri)) return uri;
  const dest = new File(Paths.cache, 'demo-screenshot.png');
  if (dest.exists) dest.delete();
  await File.downloadFileAsync(uri, dest);
  return dest.uri;
}
