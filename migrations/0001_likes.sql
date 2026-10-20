-- いいね。voter は IP を塩付きでハッシュしたもの（IPそのものは残さない）
CREATE TABLE likes (
  paper_id TEXT NOT NULL,
  voter TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (paper_id, voter)
);
-- 一覧で全論文の数を毎回数え直さないための集計
CREATE TABLE like_counts (
  paper_id TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
