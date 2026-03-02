# the Terrace 長浜 公式サイト

## 1. プロジェクト概要

- **プロジェクト名**: the Terrace 長浜 公式サイト
- **目的**: 民泊施設「the Terrace 長浜」の集客・直接予約の獲得
- **対象ユーザー**: 20〜40代のグループ旅行・ファミリー層（広島・瀬戸内エリアへの旅行者）
- **公開先**: レンタルサーバー（独自ドメイン）— Xserver等を想定
- **デザインコンセプト**: 「海が見える、静かな非日常」— リゾート感 + 清潔感 + 信頼感

## 2. 技術スタック

| カテゴリ | 技術 | バージョン |
|---|---|---|
| フレームワーク | Laravel | 12.x |
| PHP | PHP | 8.4 |
| フロントエンド | Tailwind CSS | 4.x（@tailwindcss/vite経由） |
| ビルドツール | Vite | 7.x |
| DB | SQLite（開発） / MySQL（本番） | - |
| テスト | PHPUnit | 11.x |
| パッケージ管理 | Composer / npm | - |

## 3. ディレクトリ構成

```
terrace-nagahama/
├── app/
│   ├── Http/
│   │   ├── Controllers/
│   │   │   ├── Admin/              # 管理画面コントローラー
│   │   │   │   ├── DashboardController.php
│   │   │   │   ├── ReservationController.php
│   │   │   │   ├── CalendarController.php
│   │   │   │   ├── PricingController.php
│   │   │   │   └── SettingController.php
│   │   │   ├── PageController.php  # 公開ページコントローラー
│   │   │   └── ReservationController.php  # 予約フォーム処理
│   │   └── Middleware/
│   ├── Models/
│   │   ├── User.php
│   │   ├── Reservation.php
│   │   ├── BlockedDate.php
│   │   ├── PricingRule.php
│   │   └── Setting.php
│   └── Mail/
│       ├── ReservationConfirmed.php
│       └── ReservationCancelled.php
├── database/
│   ├── migrations/
│   └── seeders/
├── resources/
│   ├── css/
│   │   └── app.css
│   ├── js/
│   │   └── app.js
│   └── views/
│       ├── layouts/
│       │   ├── app.blade.php       # 公開ページ共通レイアウト
│       │   └── admin.blade.php     # 管理画面共通レイアウト
│       ├── pages/
│       │   ├── top.blade.php       # トップページ
│       │   ├── facility.blade.php  # 施設紹介
│       │   ├── pricing.blade.php   # 料金・予約
│       │   ├── access.blade.php    # アクセス
│       │   ├── faq.blade.php       # FAQ
│       │   └── contact.blade.php   # お問い合わせ
│       ├── admin/
│       │   ├── dashboard.blade.php
│       │   ├── reservations/
│       │   ├── calendar.blade.php
│       │   ├── pricing.blade.php
│       │   └── settings.blade.php
│       └── auth/
│           └── login.blade.php
├── routes/
│   └── web.php
├── public/
│   └── images/                     # プレースホルダー画像
├── CLAUDE.md                       # このファイル
├── .env
├── vite.config.js
├── package.json
└── composer.json
```

## 4. デザイン仕様

### カラーパレット
- ベース: ホワイト（#FFFFFF）/ ライトグレー（#F5F5F5）
- メイン: ネイビー（#1B3A5C）— 海・信頼感
- アクセント: サンセットオレンジ（#E8713A）— テラス・BBQ・温かみ
- サブ: サンドベージュ（#D4C5A9）— 自然・リラックス

### フォント
- Noto Sans JP（本文400 / 見出し700）

### レイアウト方針
- モバイルファースト必須
- 写真を大きく使う。テキストは最小限
- CTAボタンはオレンジ、常に目立つ位置に配置

## 5. DB設計

### テーブル一覧

#### users（管理者認証用）
| カラム | 型 | 説明 |
|---|---|---|
| id | bigint PK | - |
| name | string | 管理者名 |
| email | string unique | メールアドレス |
| password | string | ハッシュ化パスワード |
| timestamps | - | 作成日時・更新日時 |

#### reservations（予約）
| カラム | 型 | 説明 |
|---|---|---|
| id | bigint PK | - |
| guest_name | string | 宿泊者名 |
| guest_email | string | メールアドレス |
| guest_phone | string nullable | 電話番号 |
| check_in | date | チェックイン日 |
| check_out | date | チェックアウト日 |
| num_guests | integer | 宿泊人数 |
| has_bbq | boolean default:false | BBQ利用 |
| num_cars | integer default:0 | 駐車台数 |
| total_price | integer default:0 | 合計金額（税込） |
| status | enum | pending/confirmed/cancelled/checked_in/completed |
| notes | text nullable | 備考 |
| admin_notes | text nullable | 管理者メモ |
| timestamps | - | 作成日時・更新日時 |

#### blocked_dates（ブロック日）
| カラム | 型 | 説明 |
|---|---|---|
| id | bigint PK | - |
| date | date unique | ブロック対象日 |
| reason | string nullable | 理由 |
| timestamps | - | 作成日時・更新日時 |

#### pricing_rules（料金ルール）
| カラム | 型 | 説明 |
|---|---|---|
| id | bigint PK | - |
| date | date nullable | 特定日（nullなら基本料金） |
| day_of_week | tinyint nullable | 曜日指定（0=日〜6=土） |
| base_price | integer | 基本料金（1泊） |
| per_person_price | integer default:0 | 人数加算（1人あたり） |
| min_guests | integer default:1 | 最少人数 |
| max_guests | integer default:10 | 最大人数 |
| priority | integer default:0 | 優先度（高いほど優先） |
| timestamps | - | 作成日時・更新日時 |

#### settings（施設設定）
| カラム | 型 | 説明 |
|---|---|---|
| id | bigint PK | - |
| key | string unique | 設定キー |
| value | text nullable | 設定値 |
| timestamps | - | 作成日時・更新日時 |

### 主要リレーション
- `reservations` は独立テーブル（ゲスト情報を直接保持）
- `pricing_rules` は日付 or 曜日ベースで料金計算時に参照
- `blocked_dates` はカレンダー表示・予約バリデーション時に参照
- `settings` はキーバリュー形式で柔軟に設定保持

## 6. コーディング規約

- コメントは日本語
- ファイル名・変数名は英語（Laravel規約に準拠）
- コントローラー: PascalCase（例: ReservationController）
- モデル: PascalCase単数形（例: Reservation）
- マイグレーション: snake_case（例: create_reservations_table）
- ビュー: kebab-case or snake_case（例: top.blade.php）
- ルート名: dot記法（例: admin.reservations.index）
- レスポンシブはモバイルファーストで記述

## 7. ページ別実装ステータス

### 公開ページ
| ページ | ステータス | 詳細 |
|---|---|---|
| 共通レイアウト（ヘッダー/フッター） | 完了 | app.blade.php |
| トップページ | 完了 | ヒーロー・特徴・CTA |
| 施設紹介 | 未着手 | - |
| 料金・予約 | 未着手 | - |
| アクセス | 未着手 | - |
| FAQ | 未着手 | - |
| お問い合わせ | 未着手 | - |

### 管理ページ
| ページ | ステータス | 詳細 |
|---|---|---|
| ログイン画面 | 完了 | Blade + 認証ロジック |
| ダッシュボード | 完了 | 基本レイアウト |
| 予約管理 | 未着手 | - |
| カレンダー管理 | 未着手 | - |
| 料金設定 | 未着手 | - |
| 設定 | 未着手 | - |

### 機能
| 機能 | ステータス | 詳細 |
|---|---|---|
| DB設計・マイグレーション | 完了 | 5テーブル |
| 認証機能 | 完了 | Laravel標準認証 |
| Tailwind CSS | 完了 | v4 プリセット |
| 料金計算ロジック | 未着手 | - |
| 予約フォーム | 未着手 | - |
| メール通知 | 未着手 | - |
| iCal連携 | 未着手 | - |

## 8. 既知の課題・バグ一覧

| 課題 | 優先度 | 詳細 |
|---|---|---|
| 写真素材が未配置 | 中 | プレースホルダーで仮置き中 |
| ロゴが未配置 | 低 | テキストロゴで仮置き中 |
| 本番DB設定未完了 | 中 | 開発はSQLite、本番はMySQL予定 |

## 9. 次回セッションでやるべきことリスト

1. 施設紹介ページの実装
2. 料金・予約ページの実装（カレンダー + 料金計算 + 予約フォーム）
3. アクセスページの実装（Google Map埋め込み）
4. FAQページの実装
5. お問い合わせページの実装
6. 管理画面の予約管理機能
7. 管理画面のカレンダー管理機能
8. 管理画面の料金設定機能
