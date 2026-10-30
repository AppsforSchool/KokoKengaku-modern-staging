import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useDialog } from '../../ui/DialogProvider'
import { uploadImageToImgbb } from '../../lib/imageUpload'

// ★ 画像送信モーダル（キャプション付き。既存の talkScript.js の画像送信モーダルと同じHTML構造・同じ挙動）。
//   ・開くたびに、選択した画像・プレビュー・ボタンの状態を初期化する（キャプションは、成功するまで残る）。
//   ・アップロード中は、入力と閉じるボタンをロックする。失敗したら、ダイアログで知らせ、ロックを解除してやり直せる。

interface Props {
	open: boolean
	onClose: () => void
	/** アップロード済みの画像URLと、キャプションを受け取り、メッセージとして送る（成功したら、返信状態の解除もここで行う）。 */
	onSend: (imageUrl: string, caption: string) => Promise<void>
}

export function ImageSendModal({ open, onClose, onSend }: Props) {
	const dialog = useDialog()
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [file, setFile] = useState<File | null>(null)
	const [previewSrc, setPreviewSrc] = useState('')
	const [caption, setCaption] = useState('')
	const [uploading, setUploading] = useState(false)

	// 開くたびに、状態を初期化する
	useEffect(() => {
		if (!open) return
		setFile(null)
		setPreviewSrc('')
		setUploading(false)
		if (fileInputRef.current) fileInputRef.current.value = ''
	}, [open])

	const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
		const selected = e.target.files && e.target.files[0]
		if (!selected) return
		setFile(selected)
		// FileReaderで読み込んでプレビュー表示（読み込みが終わったら、送信ボタンを活性化）
		const reader = new FileReader()
		reader.onload = (event) => {
			setPreviewSrc(String(event.target?.result || ''))
		}
		reader.readAsDataURL(selected)
	}

	const handleSubmit = async () => {
		if (!file) return
		setUploading(true)
		try {
			const imageUrl = await uploadImageToImgbb(file)
			await onSend(imageUrl, caption)
			console.log('画像送信が完了しました！')
			// 成功したら自動的にモーダルを閉じる
			onClose()
			setCaption('')
			setUploading(false)
		} catch (error) {
			console.error('画像送信中にエラーが発生しました:', error)
			await dialog.alert('画像の送信に失敗しました。\n' + (error instanceof Error ? error.message : String(error)))
			// エラー時はユーザーがやり直せるようにロックを解除
			setUploading(false)
		}
	}

	return (
		<div id="image-upload-modal" className={'modal-overlay' + (open ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title">画像を送信</p>
					<span id="image-modal-close" className={'close-button' + (uploading ? ' hidden' : '')} onClick={onClose}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					<input
						ref={fileInputRef}
						type="file"
						id="modal-image-input"
						accept="image/*"
						className="visually-hidden-input"
						onChange={handleFileChange}
					/>
					<button id="select-image-button" className="normal-button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
						画像を選択する
					</button>

					<div id="image-preview-container" className={'image-preview-container' + (previewSrc ? '' : ' hidden')}>
						<img id="image-preview" src={previewSrc || undefined} alt="プレビュー" />
					</div>
					<textarea
						id="image-message-input"
						rows={3}
						placeholder="メッセージを添える（任意）"
						disabled={uploading}
						value={caption}
						onChange={(e) => setCaption(e.target.value)}
					></textarea>
					<button id="submit-image-button" className="normal-button" disabled={uploading || !previewSrc} onClick={() => void handleSubmit()}>
						{uploading ? '画像をアップロード中...' : '画像を送信'}
					</button>
				</div>
			</div>
		</div>
	)
}
