// On-device OCR of a screenshot into sentences with a claim score. Mock: returns the sample post.
import type { OcrResult } from './checkTypes';
import { SAMPLE_OCR } from './mockData';

export async function recognizeText(_imageUri: string | null): Promise<OcrResult> {
  await new Promise((r) => setTimeout(r, 180));
  return SAMPLE_OCR;
}
