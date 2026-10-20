// 投稿フォームと受付窓口で同じ値を使う

// 書いたAIごとのモデル。新しい順。2026-10-21に各社の公式ページで確かめた名前
// （出典は README.md）。新しいモデルが出たらここに足して、サイトと受付窓口を出し直す。
export const MODELS = {
  Claude: [
    'Fable 5.1', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5',
    'Fable 5', 'Opus 5', 'Sonnet 5',
    'Opus 4.8', 'Opus 4.7', 'Opus 4.6', 'Sonnet 4.6', 'Opus 4.5', 'Haiku 4.5',
  ],
  ChatGPT: [
    'GPT-6 Astra', 'GPT-6.1 Sol', 'GPT-6 Sol', 'GPT-6 Luna',
    'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5',
  ],
  Gemini: [
    'Gemini 4 Argon', 'Gemini 3.8 Flash', 'Gemini 3.6 Flash', 'Gemini 3.5 Flash', 'Gemini 3.5 Flash-Lite',
    'Gemini 3.1 Pro', 'Gemini 3.1 Flash-Lite', 'Gemini 3 Flash', 'Deep Think',
    'Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 2.5 Flash-Lite',
  ],
  Grok: ['Grok 4.7', 'Grok 4.6', 'Grok 4.5', 'Grok 4.3', 'Grok 4.20'],
  DeepSeek: ['DeepSeek V4.1 Flash', 'DeepSeek V4 Pro', 'DeepSeek V4 Flash'],
  Qwen: ['Qwen3.8 Max', 'Qwen3.7 Plus', 'Qwen3.8 Flash'],
  'Meta（Muse / Llama）': [
    'Muse Wonder', 'Muse Spark 1.3', 'Muse Spark 1.2', 'Muse Spark 1.1', 'Muse Spark Open', 'Muse Glimmer',
    'Llama 4 Maverick', 'Llama 4 Scout',
  ],
  Mistral: ['Mistral Large 4', 'Mistral Small 4'],
  その他: [],
  わからない: [],
};
export const PROVIDERS = Object.keys(MODELS);

// どのAIにも付ける選択肢
export const MODEL_NOT_LISTED = '一覧にない';
export const MODEL_UNKNOWN = 'わからない';
export const modelChoices = (provider) =>
  provider === 'わからない' ? [MODEL_UNKNOWN] : [...MODELS[provider], MODEL_NOT_LISTED, MODEL_UNKNOWN];

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_MODEL_OTHER = 60;
export const MAX_PURPOSE = 400;
export const MAX_COMMENT = 100;
export const MAX_AUTHOR = 50;
export const DAILY_LIMIT = 5;
export const MAX_REPORT_REASON = 1000;
export const MAX_REPORT_CONTACT = 200;

// 英語版の画面で値の代わりに出す表示名（保存する値は日本語のまま）
export const LABELS_EN = {
  その他: 'Other',
  わからない: "Don't know",
  'Meta（Muse / Llama）': 'Meta (Muse / Llama)',
  一覧にない: 'Not in the list',
};
export const labelOf = (v, lang) => (lang === 'en' && LABELS_EN[v]) || v;
