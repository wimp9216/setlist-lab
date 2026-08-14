/* =========================================================
   Setlist Lab — 楽曲の特徴量抽出（Web Audio）
   ---------------------------------------------------------
   Spotify の audio-features が2024年に廃止されたため、
   iTunes の30秒試聴をブラウザ内で解析して代わりの値を作る。
   試聴音源には Access-Control-Allow-Origin: * が付いているので
   fetch → decodeAudioData がそのまま通る。

   再生はしないため OfflineAudioContext で完結し、
   iOS の「音は必ずユーザー操作から」という制約に触れない。

   出力:
     bpm        テンポ
     energy     平均RMS（音の詰まり具合）
     brightness スペクトル重心[Hz]（高域の多さ＝音の明るさ）
     dynamics   RMSの変動係数（強弱の起伏）
   ========================================================= */

const TARGET_RATE = 22050;  // 解析用にこのレートまで落とす（音楽の特徴量には十分）
const FRAME = 2048;
const HOP = 512;

/* ---------------------------------------------------------
   FFT（基数2・反復版）
   --------------------------------------------------------- */

class FFT {
  constructor(n) {
    if ((n & (n - 1)) !== 0) throw new Error('FFTサイズは2のべき乗にしてください');
    this.n = n;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    // ビット反転の並び替え表
    this.rev = new Uint32Array(n);
    let bits = 0;
    while ((1 << bits) < n) bits++;
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** re/im を破壊的に変換する */
  transform(re, im) {
    const { n, rev, cos, sin } = this;

    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }

    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] - im[l] * sin[k];
          const tim = re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  }
}

/* ---------------------------------------------------------
   デコード
   --------------------------------------------------------- */

// 解析の中身は純粋な数値計算なので、Web Audio が無い環境（Node での検証等）でも
// モジュール自体は読み込めるようにしておく。
const OfflineCtx = typeof window !== 'undefined'
  ? (window.OfflineAudioContext || window.webkitOfflineAudioContext)
  : null;

export function audioSupported() {
  return !!OfflineCtx;
}

/**
 * 音声バイト列 → モノラル Float32Array（TARGET_RATE 付近まで間引き済み）
 */
export async function decodeToMono(arrayBuffer) {
  if (!OfflineCtx) throw new Error('このブラウザは Web Audio に対応していません。');

  // decodeAudioData はコンテキストのサンプルレートへ変換してくれる実装が多いが、
  // 変換しない実装もあるため、結果のレートを見て自前で間引く。
  const ctx = new OfflineCtx(1, 1, TARGET_RATE);
  const buf = await ctx.decodeAudioData(arrayBuffer);

  // ステレオはモノラルに混ぜる
  const ch = buf.numberOfChannels;
  const len = buf.length;
  let mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i];
  }
  if (ch > 1) for (let i = 0; i < len; i++) mono[i] /= ch;

  // レートが高いままなら整数分の1に間引く
  let rate = buf.sampleRate;
  const factor = Math.max(1, Math.floor(rate / TARGET_RATE));
  if (factor > 1) {
    const out = new Float32Array(Math.floor(len / factor));
    for (let i = 0; i < out.length; i++) {
      // 単純な平均で折り返し雑音を軽く抑える
      let sum = 0;
      for (let k = 0; k < factor; k++) sum += mono[i * factor + k];
      out[i] = sum / factor;
    }
    mono = out;
    rate = rate / factor;
  }

  return { samples: mono, sampleRate: rate };
}

/* ---------------------------------------------------------
   特徴量
   --------------------------------------------------------- */

/**
 * @param {Float32Array} samples モノラル波形
 * @param {number} sampleRate
 * @returns {{ bpm, energy, brightness, dynamics, frames }}
 */
export function extractFeatures(samples, sampleRate) {
  const nFrames = Math.max(0, Math.floor((samples.length - FRAME) / HOP) + 1);
  if (nFrames < 8) throw new Error('音源が短すぎて解析できません。');

  const fft = new FFT(FRAME);
  const bins = FRAME / 2;

  // ハン窓（フレーム端の不連続がスペクトルを汚すのを防ぐ）
  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const mag = new Float32Array(bins);
  const prevMag = new Float32Array(bins);

  const rms = new Float32Array(nFrames);
  const centroid = new Float32Array(nFrames);
  const flux = new Float32Array(nFrames);

  const binHz = sampleRate / FRAME;

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;

    let sumSq = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = samples[off + i];
      sumSq += s * s;
      re[i] = s * window[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(sumSq / FRAME);

    fft.transform(re, im);

    let magSum = 0;
    let weighted = 0;
    let fluxSum = 0;
    for (let k = 0; k < bins; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      magSum += m;
      weighted += m * k * binHz;
      const d = m - prevMag[k];
      if (d > 0) fluxSum += d;   // 増加分だけ拾う（音が立ち上がった瞬間の指標）
    }
    centroid[f] = magSum > 1e-9 ? weighted / magSum : 0;
    flux[f] = f === 0 ? 0 : fluxSum;
    prevMag.set(mag);
  }

  /* --- エネルギーと強弱 --- */
  const meanRms = mean(rms);
  const sdRms = stddev(rms, meanRms);
  const dynamics = meanRms > 1e-9 ? sdRms / meanRms : 0;

  /* --- 明るさ：無音フレームの重心は意味が無いのでRMSで重みづけ --- */
  let cw = 0, cSum = 0;
  for (let f = 0; f < nFrames; f++) { cw += rms[f]; cSum += centroid[f] * rms[f]; }
  const brightness = cw > 1e-9 ? cSum / cw : 0;

  /* --- テンポ --- */
  const bpm = estimateTempo(flux, sampleRate / HOP);

  return {
    bpm,
    energy: meanRms,
    brightness,
    dynamics,
    frames: nFrames,
  };
}

/**
 * オンセット強度の自己相関からテンポを推定する。
 *
 * 周期信号は「本当の周期」だけでなくその整数倍のラグにも必ず強いピークが立つため、
 * 単純な最大値では半分のテンポ（オクターブ違い）に落ちる。
 * そこで候補ラグの整数倍を足し合わせる櫛形フィルタで評価する。
 * 本当のテンポは自分の倍音すべてから支持を受けるので、
 * 半分のテンポより高いスコアになる。
 */
export function estimateTempo(flux, frameRate) {
  const n = flux.length;
  if (n < 32) return 0;

  // 移動平均を引いて半波整流（曲全体の音量変化ではなく「立ち上がり」だけを残す）。
  // 窓は片側0.12秒。これ以上広げると速い曲（180BPM超＝1拍0.33秒）で
  // 隣の拍まで平均に含まれてしまい、本当の周期のピークが消える。
  const win = Math.max(2, Math.round(frameRate * 0.12));
  const onset = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) { sum += flux[k]; cnt++; }
    onset[i] = Math.max(0, flux[i] - sum / cnt);
  }

  const m = mean(onset);
  for (let i = 0; i < n; i++) onset[i] -= m;

  const minBpm = 55, maxBpm = 210;
  const minLag = Math.max(2, Math.floor((60 * frameRate) / maxBpm));
  const maxLag = Math.min(Math.floor(n / 2), Math.ceil((60 * frameRate) / minBpm));
  if (maxLag <= minLag) return 0;

  const HARMONICS = 4;
  const acfMax = Math.min(n - 2, maxLag * HARMONICS);

  // 自己相関。n で割る（(n-lag) で割ると長いラグほど値が持ち上がり、
  // 遅いテンポ側へ系統的に偏る）。
  const acf = new Float64Array(acfMax + 2);
  for (let lag = 1; lag <= acfMax; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < n; i++) acc += onset[i] * onset[i + lag];
    acf[lag] = acc / n;
  }

  // 周期はフレーム数の整数倍にならない（例: 168BPM は 15.4 フレーム）。
  // 整数ラグに丸めると倍音の位置がずれ、たまたま整数になる半分のテンポが
  // 有利になってしまうので、分数ラグを線形補間で読む。
  const acfAt = (lag) => {
    if (lag < 1 || lag > acfMax) return 0;
    const i = Math.floor(lag);
    const f = lag - i;
    return acf[i] * (1 - f) + acf[i + 1] * f;
  };

  let bestBpm = 0, bestScore = -Infinity;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const lag = (60 * frameRate) / bpm;
    if (lag < minLag || lag > maxLag) continue;

    let score = 0;
    for (let h = 1; h <= HARMONICS; h++) {
      const l = lag * h;
      if (l > acfMax) break;
      score += acfAt(l) / h;   // 遠い倍音ほど寄与を小さく
    }

    // log2 スケールのガウス重み。
    // 中心を 130 にしているのは、よくある取り違えペア（92/184, 65/130 など）の
    // 幾何平均がこの付近に来るため。ここを 120 にすると 2:1 の曖昧なケースで
    // 遅いほうが常に約10%有利になり、速い曲が半分のテンポに落ちる。
    score *= Math.exp(-0.5 * ((Math.log2(bpm / 130) / 1.2) ** 2));

    if (score > bestScore) { bestScore = score; bestBpm = bpm; }
  }

  return bestBpm ? Math.round(bestBpm) : 0;
}

function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return arr.length ? s / arr.length : 0;
}

function stddev(arr, m) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += (arr[i] - m) ** 2;
  return arr.length ? Math.sqrt(s / arr.length) : 0;
}

/* ---------------------------------------------------------
   まとめ
   --------------------------------------------------------- */

/**
 * 試聴URL1本を解析する。
 * @returns {{ bpm, energy, brightness, dynamics }}
 */
export async function analyzePreview(previewUrl, { signal } = {}) {
  const res = await fetch(previewUrl, { signal });
  if (!res.ok) throw new Error(`試聴音源の取得に失敗しました (${res.status})`);
  const buf = await res.arrayBuffer();
  const { samples, sampleRate } = await decodeToMono(buf);
  return extractFeatures(samples, sampleRate);
}
