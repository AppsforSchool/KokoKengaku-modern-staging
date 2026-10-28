import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Avatar } from '../components/Avatar'
import { db, doc, getDoc, hedged, setDoc } from '../firebase'
import { uploadImageToImgbb } from '../lib/imageUpload'
import { sendProfileChangeNotification } from '../lib/push'
import { getUserCache, hasActivePrize, setUserCache, type UserCacheEntry } from '../lib/userCache'
import { useDialog } from '../ui/DialogProvider'

// ★ プロフィールのモーダル（既存の appScript.js / talkScript.js の openProfileModal・handleProfileEditOrSave と同じ挙動。
//   ルーム一覧とトーク画面で共通）。HTML構造・ID・クラスも、既存の app.html と同じ。
//   ・自分のプロフィール、または管理者が他人のプロフィールのときだけ、編集できる（名前・ステータスメッセージ・画像）。
//   ・キャッシュがあれば先にそれを表示し、なければ Firestore から取得する。
//   ・保存すると、全員へ変更の通知を送る（待たない）。
//   ・保存する項目は name / profileText / imageUrl だけ（Firestoreのルールの許可項目。形を変えないこと）。

/** 開くプロフィール。token は、同じ人でも開き直すために、開くたびに変える。 */
export interface ProfileTarget {
	userId: string
	startEditMode: boolean
	token: number
}

interface Props {
	target: ProfileTarget | null
	myUserId: string
	meIsAdmin: boolean
	/** 閉じたときに呼ぶ。 */
	onClose: () => void
	/** 保存したときに呼ぶ（自分のプロフィールなら、ドロワーの表示名などを更新するため）。 */
	onSaved?: (userId: string, updated: UserCacheEntry) => void
}

type AvatarMode = 'current' | 'preview' | 'removed'

const NO_STATUS = 'ステータスメッセージはありません。'

export function ProfileModal({ target, myUserId, meIsAdmin, onClose, onSaved }: Props) {
	const dialog = useDialog()

	const [open, setOpen] = useState(false)
	const [userId, setUserId] = useState('')
	const [canEdit, setCanEdit] = useState(false)

	// 表示
	const [name, setName] = useState('取得中...')
	const [isAdmin, setIsAdmin] = useState(false)
	const [prize, setPrize] = useState(false)
	const [text, setText] = useState('取得中...')
	const [currentImageUrl, setCurrentImageUrl] = useState('')

	// 編集
	const [editing, setEditing] = useState(false)
	const [nameInput, setNameInput] = useState('')
	const [textInput, setTextInput] = useState('')
	const [avatarMode, setAvatarMode] = useState<AvatarMode>('current')
	const [avatarPreview, setAvatarPreview] = useState('')
	const [showRemoveButton, setShowRemoveButton] = useState(false)
	const [saveLabel, setSaveLabel] = useState('プロフィールを編集')
	const [saving, setSaving] = useState(false)

	const fileRef = useRef<File | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)

	/** 編集モードをリセットする（既存の resetProfileEditMode）。 */
	const resetEditMode = () => {
		setEditing(false)
		setSaveLabel('プロフィールを編集')
		setSaving(false)
		setAvatarMode('current')
		setAvatarPreview('')
		setShowRemoveButton(false)
		fileRef.current = null
		if (fileInputRef.current) fileInputRef.current.value = ''
	}

	/** 編集ボタン・保存ボタンが押されたときの処理（既存の handleProfileEditOrSave）。 */
	const startEditing = (forUserId: string, editable: boolean, imageUrl: string) => {
		setEditing(true)
		setSaveLabel('プロフィールを保存')
		const cached = getUserCache(forUserId) || {}
		setNameInput(cached.name || '')
		setTextInput(cached.profileText || '')
		// アイコンをタップして変更できるようにする（自分／管理者のみ）
		if (editable && imageUrl) setShowRemoveButton(true)
	}

	const save = async () => {
		const newName = nameInput.trim()
		const newProfileText = textInput.trim()

		if (!newName) {
			await dialog.alert('ユーザーネームを入力してください。')
			return
		}

		setSaving(true)
		setSaveLabel('保存中...')

		try {
			// アイコン画像の変更があれば、先にアップロード（または削除）を確定させる
			let finalImageUrl = currentImageUrl
			if (fileRef.current) {
				setSaveLabel('画像をアップロード中...')
				finalImageUrl = await uploadImageToImgbb(fileRef.current)
			} else if (avatarMode === 'removed') {
				finalImageUrl = ''
			}

			setSaveLabel('保存中...')

			await setDoc(
				doc(db, 'users_random', userId),
				{
					name: newName,
					profileText: newProfileText,
					imageUrl: finalImageUrl,
				},
				{ merge: true },
			)

			// キャッシュ情報の更新（name / isAdmin / imageUrl / profileText / prizeGrantedAt を一括で最新化）
			const previousCache = getUserCache(userId) || {}
			const updated = setUserCache(userId, {
				name: newName,
				isAdmin: previousCache.isAdmin || false,
				imageUrl: finalImageUrl,
				profileText: newProfileText,
				prizeGrantedAt: previousCache.prizeGrantedAt,
			})

			setName(newName)
			setText(newProfileText || NO_STATUS)
			setCurrentImageUrl(finalImageUrl)
			setIsAdmin(!!updated.isAdmin)
			setPrize(!updated.isAdmin && hasActivePrize(updated))

			if (onSaved) onSaved(userId, updated)

			void sendProfileChangeNotification(db, { senderId: myUserId, userName: newName }) // 全員へ通知（待たない）
			resetEditMode()
			await dialog.alert('プロフィールを保存しました。')
		} catch (error) {
			console.error('プロフィール保存エラー:', error)
			await dialog.alert('プロフィールの保存に失敗しました: ' + (error instanceof Error ? error.message : String(error)))
			setSaving(false)
			setSaveLabel('プロフィールを保存')
		}
	}

	// ---- 開く（既存の openProfileModal） ----
	useEffect(() => {
		if (!target) return
		let cancelled = false
		const id = target.userId
		const editable = meIsAdmin || id === myUserId
		setUserId(id)
		setCanEdit(editable)
		resetEditMode()

		// キャッシュがあれば先にそれを表示し（体感速度優先）、裏で最新データに更新する
		const cached = getUserCache(id)
		const hasCachedProfileText = !!cached && cached.profileText !== undefined
		setName((cached && cached.name) || '取得中...')
		setIsAdmin(!!(cached && cached.isAdmin))
		setPrize(!!cached && !cached.isAdmin && hasActivePrize(cached))
		setText(hasCachedProfileText ? (cached && cached.profileText) || NO_STATUS : '取得中...')
		const imageUrl = (cached && cached.imageUrl) || ''
		setCurrentImageUrl(imageUrl)
		setOpen(true)

		// すでにステータスメッセージまでキャッシュ済みなら、Firestoreへは再取得しに行かない
		if (hasCachedProfileText) {
			if (editable && target.startEditMode) startEditing(id, editable, imageUrl)
			return
		}

		void (async () => {
			try {
				const snap = await hedged(() => getDoc(doc(db, 'users_random', id)))
				if (cancelled) return
				if (snap.exists()) {
					const userData = snap.data()
					// ユーザーデータをまとめてキャッシュに反映
					const updated = setUserCache(id, {
						name: userData.name || '名前未設定',
						isAdmin: userData.isAdmin || false,
						imageUrl: userData.imageUrl || '',
						profileText: userData.profileText || '',
						prizeGrantedAt: userData.prizeGrantedAt,
					})
					setName(updated.name || '')
					setIsAdmin(!!updated.isAdmin)
					setPrize(!updated.isAdmin && hasActivePrize(updated))
					setText(updated.profileText || NO_STATUS)
					setCurrentImageUrl(updated.imageUrl || '')
					// ドロワーから来たなどの場合は即座に編集モードに移行する
					if (editable && target.startEditMode) startEditing(id, editable, updated.imageUrl || '')
				} else {
					setName('不明なユーザー')
					setText('')
				}
			} catch (error) {
				if (cancelled) return
				console.error('プロフィール取得エラー:', error)
				setName('エラー')
				setText('プロフィールの取得に失敗しました。')
			}
		})()
		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [target])

	const close = () => {
		setOpen(false)
		resetEditMode()
		onClose()
	}

	const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files && e.target.files[0]
		if (!file) return
		fileRef.current = file
		const reader = new FileReader()
		reader.onload = (event) => {
			setAvatarPreview(String(event.target ? event.target.result : ''))
			setAvatarMode('preview')
			setShowRemoveButton(true)
		}
		reader.readAsDataURL(file)
	}

	const onRemoveAvatar = () => {
		fileRef.current = null
		if (fileInputRef.current) fileInputRef.current.value = ''
		setAvatarMode('removed')
		setShowRemoveButton(false)
	}

	const nameClass = isAdmin ? ' admin' : prize ? ' prize' : ''
	const initialSource = editing ? nameInput : name

	return (
		<div id="profile-modal" className={'modal-overlay' + (open ? '' : ' hidden')}>
			<div className="modal-content">
				<div className="modal-header">
					<p className="title">プロフィール</p>
					<span id="profile-modal-close" className="close-button" onClick={close}>
						&times;
					</span>
				</div>
				<div className="modal-scroll-body">
					<div id="profile-area">
						<div className={'profile-avatar-wrap' + (editing && canEdit ? ' editable' : '')}>
							<div
								id="profile-avatar-holder"
								onClick={() => {
									if (!editing || !canEdit) return
									if (fileInputRef.current) fileInputRef.current.click()
								}}
							>
								{avatarMode === 'preview' ? (
									<img className="avatar-circle large" src={avatarPreview} alt="" />
								) : avatarMode === 'removed' ? (
									<Avatar name={initialSource} size="large" />
								) : (
									<Avatar name={name} size="large" imageUrl={currentImageUrl} />
								)}
							</div>
							<input
								type="file"
								id="profile-avatar-input"
								accept="image/*"
								className="visually-hidden-input"
								ref={fileInputRef}
								onChange={onFileChange}
							/>
							<button id="profile-avatar-remove-button" className={showRemoveButton ? undefined : 'hidden'} onClick={onRemoveAvatar}>
								画像を削除
							</button>
						</div>

						<p id="profile-name" className={(editing ? 'hidden' : '') + nameClass}>
							{name}
						</p>
						<input
							id="profile-name-input"
							className={editing ? undefined : 'hidden'}
							type="text"
							placeholder="ユーザーネーム"
							value={nameInput}
							onChange={(e) => setNameInput(e.target.value)}
						/>

						<p className="profile-label">ステータスメッセージ</p>
						<div id="profile-text" className={editing ? 'hidden' : undefined}>
							{text}
						</div>
						<textarea
							id="profile-text-edit"
							className={editing ? undefined : 'hidden'}
							placeholder="自己紹介を入力してください"
							value={textInput}
							onChange={(e) => setTextInput(e.target.value)}
						></textarea>

						<div className="profile-edit-button-row">
							<button id="profile-cancel-button" className={editing && canEdit ? undefined : 'hidden'} onClick={resetEditMode}>
								キャンセル
							</button>
							<button
								id="profile-edit-button"
								className={canEdit ? undefined : 'hidden'}
								disabled={saving}
								onClick={() => {
									if (!editing) startEditing(userId, canEdit, currentImageUrl)
									else void save()
								}}
							>
								{saveLabel}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
