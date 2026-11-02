// M10: Web Serial flashing with esptool-js (vendored). This really talks to the board:
// connect → detect the chip → write the model blob to the cdmodel partition (0x3C0000) → reset.
// It can also write an Arduino-exported merged firmware .bin at 0x0 (optional).
export const MODEL_ADDR = 0x3c0000;
export const MODEL_PART_SIZE = 0x40000;
export const hasSerial = () => typeof navigator !== 'undefined' && 'serial' in navigator && !!navigator.serial;

export function whyNoSerial() {
  const ua = navigator.userAgent;
  const android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const ff = /Firefox\//.test(ua), safari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  if (!window.isSecureContext) return 'Web Serial needs a secure (https) page.';
  if (android) return 'Android Chrome has no Web Serial, so it can’t flash over USB.';
  if (ios) return 'iPhone and iPad browsers have no Web Serial.';
  if (ff) return 'Firefox doesn’t support Web Serial.';
  if (safari) return 'Safari doesn’t support Web Serial.';
  return 'This browser has no Web Serial.';
}

export async function flash({ blob, firmware, log, progress }) {
  if (blob.length > MODEL_PART_SIZE) throw new Error('The model is bigger than the 256 KB cdmodel partition.');
  const { ESPLoader, Transport } = await import('/vendor/esptool-js/esptool.bundle.js');
  const port = await navigator.serial.requestPort({});
  const transport = new Transport(port, false);
  const terminal = { clean() {}, writeLine: (s) => log(s), write: (s) => log(s) };
  const loader = new ESPLoader({ transport, baudrate: 460800, terminal });
  try {
    const chip = await loader.main();
    log(`Connected: ${chip}`);
    if (!/ESP32/i.test(chip)) throw new Error(`Expected an ESP32 or ESP32-S3, found ${chip}`);
    const pad = (u8) => { const n = Math.ceil(u8.length / 4) * 4; const o = new Uint8Array(n).fill(0xff); o.set(u8); return o; };
    const files = [];
    if (firmware) files.push({ data: pad(firmware), address: 0x0 });
    files.push({ data: pad(blob), address: MODEL_ADDR });
    await loader.writeFlash({ fileArray: files, flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
      reportProgress: (i, written, total) => progress?.((i + written / total) / files.length) });
    log('Write complete: resetting the board…');
    await loader.after('hard_reset');
    return chip;
  } finally {
    try { await transport.disconnect(); } catch { /* already closed */ }
  }
}
