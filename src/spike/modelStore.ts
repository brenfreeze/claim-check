// Spike-only model delivery: download the int8 files from a laptop HTTP server into app storage.
//   python3 -m http.server 8765 --directory models/decima-small/onnx/int8
// The Android emulator reaches the laptop at 10.0.2.2; a phone on the same Wi-Fi uses the laptop's LAN IP.
import { Directory, File, Paths } from 'expo-file-system';
import { MODEL_VARIANT } from './reference';

export const MODEL_FILES = [
  'decima.json',
  'tokenizer/tokenizer_config.json',
  'tokenizer/tokenizer.json',
  'scorer.onnx',
  'encoder.onnx',
] as const;

export const modelDir = () => new Directory(Paths.document, MODEL_VARIANT === 'ft3' ? 'decima-ft3-int8' : 'decima-small-int8');

export interface ModelFileInfo {
  name: string;
  bytes: number | null;
}

export function listModelFiles(): ModelFileInfo[] {
  const dir = modelDir();
  return MODEL_FILES.map((name) => {
    const f = new File(dir, name);
    return { name, bytes: f.exists ? f.size : null };
  });
}

export const modelPresent = () => listModelFiles().every((f) => (f.bytes ?? 0) > 0);

export async function downloadModel(baseUrl: string, onFile?: (name: string) => void): Promise<ModelFileInfo[]> {
  const dir = modelDir();
  new Directory(dir, 'tokenizer').create({ intermediates: true, idempotent: true });
  for (const name of MODEL_FILES) {
    onFile?.(name);
    const dest = new File(dir, name);
    if (dest.exists) dest.delete();
    await File.downloadFileAsync(`${baseUrl.replace(/\/+$/, '')}/${name}`, dest);
  }
  return listModelFiles();
}

export const readText = (uri: string) => new File(uri).text();
/** onnxruntime-react-native wants a plain filesystem path. */
export const sessionPath = (uri: string) => decodeURI(uri.replace(/^file:\/\//, ''));
