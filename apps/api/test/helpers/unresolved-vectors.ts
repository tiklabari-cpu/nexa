/**
 * Fixture vectors for the unresolved questions' clustering (tm 317.2 · AI-22
 * acceptance: "Gerçek embedding'le aynı anlamdaki 30 cümle tek kümede").
 *
 * No real provider is reachable from a test (CLAUDE.md: external services are
 * mocked), so the "real space" is modelled on the geometry a sentence model
 * gives: each topic is a direction, and a wording of it is that direction
 * plus its own noise — two wordings of one question sit at a cosine of about
 * 0.85, a wording and its topic at about 0.92. A neighbouring question (a
 * Papara *withdrawal* beside a Papara *deposit*) shares 0.6 of its direction,
 * an unrelated one (a bonus) nothing. Seeded, so every run draws the same
 * vectors; 1536 long, like `vector(1536)`.
 */
import { EMBEDDING_DIMENSIONS } from '../../src/services/ai/provider/embedding-provider.js';

/** 30 wordings of "I deposited with Papara and it does not show" (AI-22's own example). */
export const PAPARA_DEPOSIT = [
  'Papara ile yatırdım gözükmüyor',
  'Papara ile para yatırdım hesabıma geçmedi',
  'Papara yatırımım hala hesabımda görünmüyor',
  'Papara’dan gönderdiğim para bakiyeme yansımadı',
  'Papara ile yatırım yaptım ama bakiye artmadı',
  'Papara üzerinden yatırdığım tutar gelmedi',
  'Papara yatırımı yaptım, hesaba düşmedi',
  'Papara ile beş yüz lira yatırdım görünmüyor',
  'Papara’dan yatırdım ama hesabımda yok',
  'Papara yatırımım onaylanmadı mı, bakiye aynı',
  'Papara ile para gönderdim bakiyem değişmedi',
  'Papara yatırımı ne zaman hesaba geçer, hala yok',
  'Yatırımımı Papara ile yaptım gözükmüyor',
  'Papara’dan attığım para hesaba gelmedi',
  'Papara yatırımım kayboldu, bakiyede yok',
  'Papara ile yatırım yaptım yansımadı',
  'Papara transferim hesabıma ulaşmadı',
  'Papara ile yatırdığım para nerede',
  'Papara yatırımı yaptım ama oyun hesabımda görünmüyor',
  'Papara’dan para yatırdım bakiye sıfır',
  'Papara ödemesi yaptım hesabıma eklenmedi',
  'Papara ile yükleme yaptım görünmüyor',
  'Papara yatırımım hesabıma yansımadı yardım',
  'Papara’dan yatırdım saat geçti hala gelmedi',
  'Papara ile yatırım yaptım, param çekildi ama hesaba gelmedi',
  'Papara yatırımı başarılı dedi ama bakiyem aynı',
  'Papara ile yatırdığım tutar hesaba geçmedi',
  'Papara yatırımım görünmüyor kontrol eder misiniz',
  'Papara’dan yaptığım yatırım hesabımda gözükmüyor',
  'Papara ile yatırdım ama bakiye güncellenmedi',
] as const;

/** The neighbouring question: a Papara withdrawal that has not arrived. */
export const PAPARA_WITHDRAWAL = [
  'Papara ile çekim talebi verdim gelmedi',
  'Papara çekimim ne zaman hesabıma gelir',
  'Papara’ya çekim yaptım hala ulaşmadı',
  'Papara hesabıma çekim yapamıyorum',
  'Papara çekim talebim beklemede kaldı',
] as const;

/** An unrelated question. */
export const BONUS = [
  'Hoş geldin bonusu nasıl alınır',
  'Bonus çevrim şartı nedir',
  'Bonusumu nasıl kullanabilirim',
] as const;

/** A deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function unit(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
}

function randomUnit(random: () => number): number[] {
  return unit(Array.from({ length: EMBEDDING_DIMENSIONS }, () => gaussian(random)));
}

/** `scale` × a + b, unit length. */
function mix(a: number[], scale: number, b: number[], bScale: number): number[] {
  return unit(a.map((value, i) => value * scale + b[i]! * bScale));
}

/** A wording's own noise, relative to its topic: cos(wording, topic) ≈ 1/√(1 + 0.42²) ≈ 0.92. */
const WORDING_NOISE = 0.42;

function topicVectors(topic: number[], texts: readonly string[], seed: number) {
  const random = prng(seed);
  return texts.map((text): [string, number[]] => [
    text,
    mix(topic, 1, randomUnit(random), WORDING_NOISE),
  ]);
}

/**
 * The fixture space: every sentence above → its vector. `vectorFor` throws on
 * a sentence it does not know — a test that embeds something else is wrong.
 */
export function fixtureSpace(): { vectorFor(text: string): number[] } {
  const random = prng(317_2);
  const deposit = randomUnit(random);
  // cos(deposit, withdrawal) = 0.6: the same wallet, a different question.
  const withdrawal = mix(deposit, 0.6, randomUnit(random), 0.8);
  const bonus = randomUnit(random);
  const vectors = new Map<string, number[]>([
    ...topicVectors(deposit, PAPARA_DEPOSIT, 1),
    ...topicVectors(withdrawal, PAPARA_WITHDRAWAL, 2),
    ...topicVectors(bonus, BONUS, 3),
  ]);
  return {
    vectorFor(text: string): number[] {
      const vector = vectors.get(text);
      if (!vector) throw new Error(`no fixture vector for "${text}"`);
      return vector;
    },
  };
}
