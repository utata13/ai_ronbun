#!/bin/bash
# GitHubのトークンを、画面に出さずに3か所（受付窓口と2つのリポジトリ）へ入れる。
# 本人が自分のターミナルで実行する。
set -euo pipefail
cd "$(dirname "$0")/.."
read -rsp "GitHubのトークンを貼り付けてEnter（画面には出ません）: " GH; echo
printf %s "$GH" | npx wrangler secret put GITHUB_TOKEN
printf %s "$GH" | gh secret set DATA_REPO_TOKEN -R utata13/ai_ronbun
printf %s "$GH" | gh secret set SITE_DISPATCH_TOKEN -R utata13/ai_ronbun-data
echo "完了しました"
