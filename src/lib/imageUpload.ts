// ★ ImgBBへの画像アップロード（チャット画像・プロフィールアイコン共通）。既存の uploadImageToImgbb と同じ。
//   ★ APIキーは、Firestoreの system_keys/imgbb から取得して、ブラウザから直接 ImgBB を呼ぶ（現状のまま）。
//     あとで、キーを隠す Worker 経由に切り替えるときは、このファイルの中だけを変える（呼び出し側は変えない）。
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'

let imgbbApiKeyCache: string | null = null

/** 画像を ImgBB にアップロードして、画像のURLを返す。 */
export async function uploadImageToImgbb(file: Blob): Promise<string> {
	if (!imgbbApiKeyCache) {
		const keyDoc = await getDoc(doc(db, 'system_keys', 'imgbb'))
		if (!keyDoc.exists()) {
			throw new Error('APIキーの設定が見つかりません。セキュリティルールかドキュメントを確認してください。')
		}
		imgbbApiKeyCache = (keyDoc.data() as { apiKey: string }).apiKey
	}

	const formData = new FormData()
	formData.append('image', file)

	const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbApiKeyCache}`, {
		method: 'POST',
		body: formData,
	})

	const result = (await response.json()) as { success?: boolean; data: { url: string } }
	if (!result.success) {
		throw new Error('ImgBBのアップロード処理に失敗しました。')
	}
	return result.data.url
}
