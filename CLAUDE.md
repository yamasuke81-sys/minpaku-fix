# Project Instructions

## バージョン番号の更新（必須・絶対忘れないこと）

コードを変更するたびに、以下の3箇所のバージョン番号を必ず更新すること。
フォーマット: `v{MMDD}{連番アルファベット}` 例: v0218a, v0218b, ...

### 1. メインアプリ（オーナー・スタッフ共通）
- **ファイル**: `index.html`
- **場所**: `id="deployVersion"` のバッジテキスト（943行付近）
- **現在値**: `v0218ae`

### 2. チェックリストアプリ
- **ファイル**: `checklist-app/checklist.html`
- **場所**: `header-title` 内の `<span>` タグ（1444行付近）
- **現在値**: `v0218u`

### 更新ルール
- 同日中の変更: アルファベットを1つ進める（例: v0218r → v0218s）
- 日付が変わった場合: 新しい日付+a（例: v0219a）
- メインアプリだけ変更した場合でもメインアプリのバージョンを更新
- チェックリストアプリだけ変更した場合でもチェックリストのバージョンを更新
- **両方変更した場合は両方更新**

## Deploy Command

Every response that includes a code change MUST end with the following deploy command block:

```
cd C:\Users\yamas\minpaku-fix && git fetch origin && git checkout -f claude/review-handoff-docs-5WgKR && git reset --hard origin/claude/review-handoff-docs-5WgKR && node deploy-all.js
```
