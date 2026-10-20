# 同梱している部品とフォント

- pdf-lib 1.17.1（MIT, pdf-lib-LICENSE.md）— npm の pdf-lib から dist/pdf-lib.min.js
- @pdf-lib/fontkit 1.1.1（MIT, package.json の license 欄による）— npm の @pdf-lib/fontkit から dist/fontkit.umd.min.js
- harfbuzzjs 1.6.2（MIT, harfbuzzjs-LICENSE）— npm の harfbuzzjs から dist/harfbuzz-subset.wasm。フォントから使う字だけを取り出す
  （pdf-lib の subset: true はこのフォントで字形が欠けたため、こちらで削ってから丸ごと埋め込む）
- ../fonts/BIZUDGothic-Regular.ttf — BIZ UDゴシック（SIL Open Font License 1.1, ../fonts/OFL.txt）。github.com/google/fonts の ofl/bizudgothic から

貼り付けた文章をブラウザの中でPDFにする時（site_src/paste-pdf.js）にだけ読み込む。
