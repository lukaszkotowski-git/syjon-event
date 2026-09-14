import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

interface QrDetector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

interface NativeBarcodeDetectorClass {
  new (options: { formats: string[] }): QrDetector;
  getSupportedFormats(): Promise<string[]>;
}

let detectorPromise: Promise<QrDetector> | null = null;

/**
 * Android Chrome ma natywny BarcodeDetector (szybki, sprzętowy). iOS Safari go nie ma — wtedy
 * ładujemy ZXing w WebAssembly, serwowany z naszej domeny (bez zewnętrznego CDN), dopiero na ekranie skanera.
 */
export function getQrDetector(): Promise<QrDetector> {
  detectorPromise ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorClass }).BarcodeDetector;
    if (Native) {
      try {
        if ((await Native.getSupportedFormats()).includes('qr_code')) return new Native({ formats: ['qr_code'] });
      } catch {
        // Część przeglądarek deklaruje API, ale rzuca przy użyciu — wtedy spadamy na WASM.
      }
    }
    const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
    prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    });
    return new BarcodeDetector({ formats: ['qr_code'] });
  })();
  detectorPromise.catch(() => {
    detectorPromise = null;
  });
  return detectorPromise;
}

export type CameraErrorKind = 'denied' | 'not-found' | 'insecure' | 'unsupported' | 'busy' | 'unknown';

export class CameraError extends Error {
  constructor(readonly kind: CameraErrorKind) {
    super(kind);
  }
}

export async function openRearCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!window.isSecureContext) throw new CameraError('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('denied');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('not-found');
    if (name === 'NotReadableError' || name === 'AbortError') throw new CameraError('busy');
    throw new CameraError('unknown');
  }

  // iOS Safari odtwarza wideo inline tylko z playsinline + muted; bez tego podgląd zostaje czarny.
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Latarka działa tylko na części Androidów (Chrome) — na iOS przeglądarka nie daje do niej dostępu. */
export function torchSupported(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0];
  const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
  return Boolean(capabilities?.torch);
}

export async function setTorch(stream: MediaStream | null, on: boolean): Promise<void> {
  const track = stream?.getVideoTracks()[0];
  await track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}

/** Ekran nie gaśnie w trakcie skanowania (Chrome, Safari 16.4+). Brak wsparcia nie jest błędem. */
export async function keepScreenAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    const sentinel = await nav.wakeLock?.request('screen');
    return () => void sentinel?.release().catch(() => undefined);
  } catch {
    return () => undefined;
  }
}

let audioContext: AudioContext | null = null;

/** iOS pozwala grać dźwięk dopiero po geście użytkownika — wołamy to w obsłudze przycisku startu. */
export function unlockAudio(): void {
  try {
    audioContext ??= new AudioContext();
    void audioContext.resume();
  } catch {
    audioContext = null;
  }
}

export function feedback(kind: 'success' | 'warning' | 'error'): void {
  navigator.vibrate?.(kind === 'success' ? 80 : [120, 60, 120]);
  if (!audioContext) return;
  const tones = { success: [880, 1320], warning: [520, 520], error: [220, 180] }[kind];
  tones.forEach((frequency, index) => {
    const oscillator = audioContext!.createOscillator();
    const gain = audioContext!.createGain();
    const start = audioContext!.currentTime + index * 0.13;
    oscillator.frequency.value = frequency;
    oscillator.type = kind === 'error' ? 'square' : 'sine';
    gain.gain.setValueAtTime(0.15, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
    oscillator.connect(gain).connect(audioContext!.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.12);
  });
}
