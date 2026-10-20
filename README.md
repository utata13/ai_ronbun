# 誰でもAI論文置き場

誰でもAI論文置き場は、AIに書かせた論文を誰でも投稿できる場所です。

気になっていたことをAIに調べさせて、論文の形で書かせたら、ここに置いてください。調べさせることは何でもかまいません。誰が書かせてもかまいません。

投稿に必要なのは、論文のPDF、書いたAIとモデル、何を調べようとしたか、の3つです。一言と投稿者は書いても書かなくてもかまいません。アカウント登録はいりません。

すぐに誰かに読まれなくてもかまいません。いつか誰かの役に立つかもしれません。

ここにある論文は、すべてAIが書いたものです。

---

## しくみ

```
投稿フォーム（GitHub Pages）
   │ POST
   ▼
受付窓口（Cloudflare Worker: worker/index.js）
   │ 確認: Turnstile / 1日5本まで / PDFか / 項目
   ▼
非公開リポジトリ ai_ronbun-data に papers/<id>/paper.pdf と meta.json を書き込む
   │ push → repository_dispatch
   ▼
このリポジトリの GitHub Actions が scripts/build.mjs でサイトを作り直して Pages に公開
```

- 投稿は非公開リポジトリに置く。消した論文が公開リポジトリの履歴に残らないようにするため
- 削除依頼（report.html）は非公開リポジトリの Issue として届く
- いいねは受付窓口が Cloudflare D1（migrations/）に記録する。同じ回線（IP）から1論文に1回まで。IPは塩付きハッシュにしてそのものは残さない
- 日本語版はサイトのルート、英語版は `en/`。投稿された論文は1か所にまとめ、両方の一覧に出る
- 検索エンジンに出すのはトップ・このサイトについて・投稿だけ。論文の一覧と論文のページは noindex, nofollow にして、AIの論文が検索結果で本物の研究と並ばないようにしている

## モデルの選択肢

`shared/fields.js` の `MODELS`。新しいモデルが出たらここに足して、受付窓口とサイトを出し直す。
一覧にない時は「一覧にない」を選んで名前を書く（meta.json の `model_in_list` が false になる）。

2026-10-21 に確かめた出典:

- Claude: https://platform.claude.com/docs/en/models/overview
- ChatGPT: https://developers.openai.com/api/docs/models ・ https://learn.chatgpt.com/docs/models
- Gemini: https://ai.google.dev/gemini-api/docs/models ・ https://gemini.google/release-notes/
- Grok: https://docs.x.ai/docs/models
- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
- Qwen: https://www.alibabacloud.com/help/en/model-studio/models
- Meta: https://dev.meta.ai/models/ （Llama 4 Maverick / Scout は2025年4月の公開時の名前）
- Mistral: https://docs.mistral.ai/getting-started/models/models_overview/

## 手元で動かす

```bash
npm install
npx wrangler d1 migrations apply ai-ronbun --local   # 初回だけ
npm run dev:site     # http://localhost:8851  サイト + GitHub の代わり（dev_repo/ に保存）
npm run dev:worker   # http://localhost:8852  受付窓口
```

手元用の値は `.dev.vars` と `config.dev.json`。Turnstile は Cloudflare 公開のテスト用キーを使う。

## 論文を消す

`ai_ronbun-data` の `papers/<id>/` を消してコミットする。サイトは自動で作り直される。
