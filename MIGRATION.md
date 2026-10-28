# 高校見学 SPA移行 — 現在地（会話をまたいで引き継ぐための記録）

最終更新：フェーズ1b（診断・通知）の納品時点

## 方針（確定）
| 項目 | 決定 |
| --- | --- |
| 構成 | サイトごとに別々のSPA。共通部品はコピーして持つ（§14-1） |
| 深さ | **同じ挙動の移植のみ。UI・機能は一切変更しない**（§14-2）。例外は下の「挙動の変更点」の1件だけ |
| 旧UI | 残す。`localStorage.uiMode`（`new`/`old`、未設定は新UI）、再読み込みなしで切り替え（§14-3） |
| 順序 | 高校見学 → 問題投稿（§14-4）。問題投稿のzip（`ProblemPosting-main.zip`）は、その時点で受け取る |
| CSS | 中身は書き換えず、ビルド時に、ページごと・新旧UIごとに限定（§14-5、`build/scopeCss.ts`） |
| 検証 | 別リポジトリ `KokoKengaku-modern-staging` で確認してから、本番へ反映（§14-6） |
| 診断・計測 | すべて移植（§14-7）。ただし通信方式の切り替え `?fs=` と `?cache=` は移さず、**常にロングポーリング・永続キャッシュなし** |
| APIキーのWorker化 | 移植が終わったあとの別作業（§14-8）。Workerの置き場は保留。それまでは `system_keys/*` を取得して直接呼ぶ現状のまま。呼び出しは `lib/imageUpload.ts`・`lib/push.ts` の1か所にまとめる |
| 旧URL | リダイレクト用ファイルを、無期限に残す（§14-10）。`public/app.html`・`public/talk.html` |
| ルート | `#/login`、`#/`、`#/talk/:roomId`、`*`（§14-11） |
| `users_random` の書き込み | 他のサイト・処理はない（§14-13）。高校見学が書く項目：`name`・`profileText`・`imageUrl`・`unreadCounts.{ID}`・`lastChecked.{ID}`。**書き込みの形は変えない** |

## 公開先
| | リポジトリ | 公開URL | `base` |
| --- | --- | --- | --- |
| 検証用 | `KokoKengaku-modern-staging` | `https://appsforschool.github.io/KokoKengaku-modern-staging/` | `/KokoKengaku-modern-staging/`（既定） |
| 本番 | `KokoKengaku-modern-`（**末尾にハイフン**） | `https://appsforschool.github.io/KokoKengaku-modern-/` | `/KokoKengaku-modern-/`（`VITE_BASE` で指定） |

バックアップ：本番リポジトリに、`pre-spa` タグと `legacy` ブランチを作成済み。戻すときは、Settings → Pages の配信元を `legacy` ブランチにする。

## 挙動の変更点（唯一）
- **存在しないルームID**：現行は、エラー文がアラートで出て遷移しない。新サイトでは、「指定されたトークルームは見つかりませんでした。」のアラート（`useDialog().alert`）を出し、OKを押すとルーム一覧（`#/`）に遷移する。（フェーズ2bで実装）

## 守ること
- `src/firebase.ts` の Auth の初期化は、全サイト一字一句同じ（SDK `12.14.0` 固定、アプリ名なし、`initializeAuth`、保存先 local→session→memory）。
- `src/firebaseConfig.ts` は、既存の `firebase.js` から機械的に写した値。手で書き換えない。
- 既存のCSSは書き換えない（`src/styles/new|old/*.css` は、元のファイルのコピー）。
- `package.json` と `package-lock.json` の両方をコミットする（`npm ci` を使うため）。
- 秘密のファイル（`.dev.vars`、`key.json`）は、コミットしない。

## CSSの仕組み
- `src/styles/new/<ページ>.css`・`old/<ページ>.css` は、ビルド時に `:where(html.ui-new .page-<ページ>)` が前に付く。`:where()` なので、**詳細度は元のまま**。
- `html` / `body` / `:root` のルールは、ページの外枠（`PageShell` の `<div class="ui-page page-<ページ>">`）に当たる。
- `@keyframes` は、`名前__<新旧>-<ページ>` に改名され、`animation` の参照も直る。
- `dialog.css` は、全ページ共通で、`html.ui-X .ui-page` に限定。**ページのCSSより後に読み込む**（`src/styles/index.ts`）。
- ページのCSSを移したら、`src/styles/index.ts` に1行足す。
- **既知の注意**：`document.body.classList` を操作する既存コード（スクロール固定など）は、`body` のルールが外枠に当たるため、外枠に同じクラスを付ける形に直す。移植時に、`grep "document.body"` で洗い出す。

## 進み具合
| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| 0 | 準備（質問、バックアップ、テスト用アカウント、検証用リポジトリ、確認チェックリスト） | 完了（画面録画は、ご自身で） |
| 1a | 土台：Vite+React+TS、`firebase.ts`、`hedged`、認証、ダイアログ、新旧UI切り替え、読み込み画面、**ログイン画面**、CSSの限定、公開設定、旧URLリダイレクト | 完了（動作確認済み） |
| 1b | 診断・通知：`statusBadge`、`perf`（管理者向けパネル）、`diag`、`push`（`notify.js`）、`PushButton`、`imageUpload` | **この納品** |
| 1c | プロフィール表示・編集、ユーザー一覧のモーダル（これらのCSSは `appStyle.css`・`talkStyle.css` にあるため、**2aでCSSを移すときに、一緒に移す**） | 2aに統合 |
| 2a | ルーム一覧（`appStyle.css` と旧UI版） | 未着手 |
| 2b | トーク画面（`talkStyle.css` と旧UI版）。下書き `messageDraft_<ID>`、編集・削除・転送・選択、既読、アンケート、返信ジャンプ、存在しないルームID | 未着手 |
| 2f | 旧URLの互換確認、本番への反映 | 未着手 |
| 3 | 問題投稿 | 未着手 |
| 4 | 後片付け、APIキーのWorker化 | 未着手 |

## 1bで作った部品と、ページ側の呼び方
| 部品 | 場所 | ページ側の使い方（既存の呼び出し位置と同じ） |
| --- | --- | --- |
| 通知欄（左上の小さな通知） | `lib/statusBadge.ts` | ページを離れるとき、自分で作った通知は、自分で消す（SPAでは、通知欄が残るため） |
| 計測 | `lib/perf.ts` | `perfMark` / `perfStart` / `perfSample` / `perfNote` はそのまま。画面を移ると、`PerfRouteWatcher` が計測を0から始め直す |
| 計測パネル | `lib/perf.ts`、`lib/diag.ts` | 読み込み完了時に `perfNotifyReportAvailable({ isAdmin, page, diagnostics: () => runFirestoreDiagnostics(myUserId) })` |
| 通知の初期化 | `lib/push.ts` の `startPush(userId)` | 自分のユーザー情報を取得した**あと**に呼ぶ（読み込みと並行）。読み込み完了時に `notifyPageLoadFinished()` |
| 通知ボタン | `components/PushButton.tsx` | ドロワーに置く（`id="enable-push-button"`）。CSSの `.normal-button` は、`appStyle.css` を移すと効く |
| 通知の送信 | `lib/push.ts` | `sendMessageNotification` / `sendPushToUsers` / `sendProfileChangeNotification`。通知のURLは、旧URL（`talk.html?id=`）のまま |
| 画像アップロード | `lib/imageUpload.ts` | `uploadImageToImgbb(file)`。既存の2か所の同じ処理を、1つにまとめた |
| ログアウト | `auth/AuthProvider.tsx` の `logout()` | `logoutPush()` → `signOut()` の順（既存と同じ） |

### 既存との違い（意図したもの）
- 診断の「通信方式」の表示：既存は「`?fs=` で切り替え可」と出していたが、切り替えを移していないため、「`long`（固定）」と出す。
- 計測の「ブラウザ計測」と「通信が遅かったリソース」：ページを開いた直後の画面でだけ、ブラウザの計測を出す。あとから移った画面は、移った時点からの計測にする（既存は、画面ごとにページを読み込み直していたため、毎回0から）。

## 次にやること
1. 1bの動作確認（仮のホームで：通知ボタン、テスト通知、管理者の「計測結果をみる」と通信診断）。
2. 結果を受けて、2a（ルーム一覧）に進む。
