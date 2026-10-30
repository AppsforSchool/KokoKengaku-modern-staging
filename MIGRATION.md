# 高校見学 SPA移行 — 現在地（会話をまたいで引き継ぐための記録）

最終更新：フェーズ2b①（トーク画面：表示と既読）の納品時点

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
- **ビルドの注意（2aで判明）**：既存のCSSには、ブラウザなら読み飛ばす無効な記述がある（例：`old_appStyle.css` の `//text-align: left;`）。ビルド時のCSS圧縮（lightningcss）は厳密でエラーにするため、`vite.config.ts` で `build.cssMinify: false` にしてある。`build/scopeCss.ts` も、宣言の先頭の `//…;` を取り除く。トーク画面のCSS（`talkStyle.css`・`old_talkStyle.css`）を移すときも、`tsx` で変換テストを行うこと。
- **既知の注意**：`document.body.classList` を操作する既存コード（スクロール固定など）は、`body` のルールが外枠に当たるため、外枠に同じクラスを付ける形に直す。移植時に、`grep "document.body"` で洗い出す。

## 進み具合
| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| 0 | 準備（質問、バックアップ、テスト用アカウント、検証用リポジトリ、確認チェックリスト） | 完了（画面録画は、ご自身で） |
| 1a | 土台：Vite+React+TS、`firebase.ts`、`hedged`、認証、ダイアログ、新旧UI切り替え、読み込み画面、**ログイン画面**、CSSの限定、公開設定、旧URLリダイレクト | 完了（動作確認済み） |
| 1b | 診断・通知：`statusBadge`、`perf`（管理者向けパネル）、`diag`、`push`（`notify.js`）、`PushButton`、`imageUpload` | 完了（動作確認済み） |
| 2a | ルーム一覧（`app.css`・新旧）、プロフィールのモーダル、グループ作成モーダル、ドロワー、個人/グループのタブ、未読数 | 完了（動作確認済み。fix2で、下の2件を修正） |
| 2b | トーク画面（`talkStyle.css` と旧UI版）。下書き `messageDraft_<ID>`、編集・削除・転送・選択、既読、アンケート、返信ジャンプ、存在しないルームID | 進行中（①表示と既読：納品済み。②〜⑤：未着手） |
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

## 2aで作った部品
| 部品 | 場所 |
| --- | --- |
| ルーム一覧のページ | `pages/RoomListPage.tsx`（既存の `app.html` + `appScript.js`） |
| データの取得・購読・未読数 | `features/roomList/useRoomList.ts`（`getAllTalkData` / `loadAllUsers` / `updateSingleRoomUnread`） |
| 並べ方・分類 | `features/roomList/roomUtils.ts`（「今日」「昨日」の見出し、個人/グループの分類、見せてよいルームの判定） |
| グループ作成 | `features/roomList/CreateTalkModal.tsx` |
| プロフィールの表示・編集 | `features/ProfileModal.tsx`（**トーク画面と共通**。保存するのは `name` / `profileText` / `imageUrl` だけ） |
| ユーザー情報のキャッシュ | `lib/userCache.ts`（画面に入るときに `resetUserCache()`。既存は、ページごとに空から始まっていた） |
| アバター | `components/Avatar.tsx` |

### 既存と同じにしたこと（ふつうは直したくなる点）
- グループ作成の検索：絞り込むと、いま表示されていない人のチェックは外れる（既存の挙動。直すかは、移植後に相談）。
- 個人タブは、変化があったときだけ作り直す（プロフィール編集の直後は、一覧の名前・アイコンは、すぐには変わらない）。

### 既存との違い（意図したもの）
- ログアウトの完了後の「ログアウトしました。」は出さない（既存は、同時にログイン画面へ移るため、実際には見えなかった。SPAでは、ログイン画面に残ってしまうため）。
- ルームを開くのは、ページの移動ではなく、`#/talk/ID` への画面遷移（戻るボタンで、一覧に戻る）。

## 2b①で作った部品（トーク画面：表示と既読）
| 部品 | 場所 |
| --- | --- |
| トーク画面のページ | `pages/TalkPage.tsx`（既存の `talk.html` + `talkScript.js`。ルートは `#/talk/:roomId`。ルームIDごとに別の画面として作り直す） |
| データの読み込み・メッセージ一覧 | `features/talk/useTalkRoom.ts`（`setupMemberSnapshots` / `getAllTalkData` / 画像の読み込み待ち / 読み込み画面を閉じる） |
| メッセージ1件の表示 | `features/talk/MessageItem.tsx`（`buildMessageElement`。本文・画像・返信元・既読） |
| 既読の一覧 | `features/talk/ReadByModal.tsx` |
| 本文の安全な表示 | `features/talk/messageText.tsx`（`isSafeHref`・`<link>`の展開・許可タグだけ。既存の関数との差分テスト済み） |
| ユーザー情報の取得 | `features/talk/talkUsers.ts`（1人1件の並列取得。最終確認日時も保持。⑤のメンバー一覧が使う） |
| 表示用の型 | `features/talk/types.ts`（メッセージが追加・変更されたときの「作った時点の表示情報」。既存は、変化のないメッセージのDOMを作り直さなかったのと同じ挙動にするため） |
| 日時の形式 | `lib/dateFormat.ts` |
| CSS | `styles/new/talk.css`・`styles/old/talk.css`（無改変） |

### 書き込みの形（既存のまま。変えないこと）
- `users_random/{自分}` に `updateDoc({ "unreadCounts.{ルームID}": 0 })`（入ったとき）
- `users_random/{自分}` に `setDoc({ lastChecked: { {ルームID}: serverTimestamp() } }, { merge: true })`（メッセージを受け取るたび）
- `KokoKengaku/{ルームID}/talk/{メッセージID}` に `updateDoc({ readBy: arrayUnion(自分) })`（他の人の未読メッセージを表示したとき）

### ①の時点で、まだ動かないもの（HTMLの場所は、先に作ってある）
- ② 送信（入力欄・画像・アンケートのボタンは、無効）。返信の矢印を押すと、「〇〇に返信」の表示は出るが、送れない
- ③ アンケートの表示・投票（アンケートのメッセージは、質問文だけが出る）
- ④ 「編集」「転送」「選択」（メッセージ上のボタン、ヘッダーの「選択」）
- ⑤ 「メンバー」（ヘッダーのボタンは、押しても何も起きない）

### 既存との違い（意図したもの）
- 存在しないルームID：「指定されたトークルームは見つかりませんでした。」→ OKで一覧（`#/`）へ。履歴を残さず置き換える（戻るボタンで、壊れたルームに戻らないため）。**唯一の、意図した挙動の変更**。
- 「←ホームへもどる」は、ページの移動ではなく、`#/` への画面遷移。
- 停止中のアカウントのときは、トーク本体は表示しない（2aと同じ扱いではなく、既存どおり）。
- メッセージの購読は、画面を離れるときに止める（既存は、ページごと消えていた）。
- 「画像を読み込み中…」の通知は、画面を離れるときに消す。
- メッセージの送信者が空（`userId` なし）のとき、名前をタップしても何も起きない（既存は、エラー）。
- 差が出うる細部：プロフィール編集で名前を変えても、すでに表示されたメッセージの名前は、そのまま（既存と同じ）。

### 作業中に直したこと
- `build/scopeCss.ts`：CSSの `//` の無効な宣言が、2つ以上続くと、2つ目以降が残っていた（`old/talk.css` の `.member-item`）。変化がなくなるまで繰り返すようにした。

## 2aの動作確認で見つかり、直した不具合（fix2）
1. 「計測結果をみる」ボタンが、画面を移るたびに増えた → `perfBeginPage` で、前の画面のボタン（と、1分のタイマー）を消す。
2. 通知欄（`#status-badge-stack`）のフォントが、BIZ UDGothicでなくなった → 通知欄は `document.body` の直下に作られ、既存は `body` のフォントを受け継いでいた。`body` のルールは、ページの外枠に限定されるため、通知欄に `font-family` を直接指定した。
- **教訓**：`document.body` の直下に作る要素（通知欄・計測パネル・今後のもの）は、`body` のCSSを受け継げない。フォントなど、必要なものは、自分で指定する。計測パネルは、既存も等幅フォントを自分で指定しているので、変更なし。

## 次にやること
1. （済）2aの動作確認。
2. 2b①の動作確認。
3. 2b②（送信）に進む。2bは大きいので、①表示と既読 ②送信・返信・画像 ③アンケート ④編集・削除・転送・選択 ⑤メンバー管理、の順に分ける。
