import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

// ★ ブラウザ標準の confirm() / alert() の代わりに使う、サイト独自のモーダル（既存の appDialog.js と同じ挙動）。
//   使い方：  const dialog = useDialog()
//             if (await dialog.confirm('ログアウトしますか？')) { … }
//             await dialog.alert('ログアウトしました。')
//   ・OKなら true、キャンセル／背景クリックなら false を返す（alert は、閉じられたら解決する）。
//   ・表示は <DialogHost />（PageShell が、各ページの枠の中に置く）。ページのCSS（.modal-overlay など）を使うため。

export interface DialogOptions {
	title?: string
	okText?: string
	cancelText?: string
	danger?: boolean
}

interface DialogState extends DialogOptions {
	open: boolean
	message: string
	showCancel: boolean
}

interface DialogApi {
	confirm: (message: string, options?: DialogOptions) => Promise<boolean>
	alert: (message: string, options?: DialogOptions) => Promise<void>
}

interface DialogContextValue extends DialogApi {
	state: DialogState
	finish: (result: boolean) => void
}

const CLOSED: DialogState = { open: false, message: '', showCancel: false }

const DialogContext = createContext<DialogContextValue | null>(null)

export function DialogProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<DialogState>(CLOSED)
	const resolver = useRef<((result: boolean) => void) | null>(null)

	const show = useCallback((message: string, showCancel: boolean, options?: DialogOptions) => {
		// すでに開いているものがあれば、閉じた扱い（キャンセル）にする
		if (resolver.current) resolver.current(false)
		setState({ ...options, open: true, message, showCancel })
		return new Promise<boolean>((resolve) => {
			resolver.current = resolve
		})
	}, [])

	const finish = useCallback((result: boolean) => {
		setState((s) => ({ ...s, open: false }))
		const resolve = resolver.current
		resolver.current = null
		if (resolve) resolve(result)
	}, [])

	const confirm = useCallback((message: string, options?: DialogOptions) => show(message, true, options), [show])
	const alert = useCallback(
		(message: string, options?: DialogOptions) => show(message, false, options).then(() => undefined),
		[show],
	)

	const value = useMemo(() => ({ state, finish, confirm, alert }), [state, finish, confirm, alert])
	return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>
}

export function useDialog(): DialogApi {
	const value = useContext(DialogContext)
	if (!value) throw new Error('useDialog は DialogProvider の中で使ってください')
	return { confirm: value.confirm, alert: value.alert }
}

/** ダイアログの表示部分。HTMLの構造とIDは、既存の app.html と同じ。 */
export function DialogHost() {
	const value = useContext(DialogContext)
	if (!value) return null
	const { state, finish } = value
	return (
		<div
			id="app-dialog-modal"
			className={'modal-overlay' + (state.open ? '' : ' hidden')}
			onClick={(e) => {
				if (e.target === e.currentTarget) finish(false) // 背景のクリックは、キャンセル扱い
			}}
		>
			<div className="modal-content app-dialog-content">
				<p id="app-dialog-title" className={'app-dialog-title' + (state.title ? '' : ' hidden')}>
					{state.title || ''}
				</p>
				<p id="app-dialog-message" className="app-dialog-message">
					{state.message}
				</p>
				<div className="app-dialog-actions">
					<button
						id="app-dialog-ok-button"
						className={state.danger ? 'app-dialog-danger' : undefined}
						onClick={() => finish(true)}
					>
						{state.okText || 'OK'}
					</button>
					<button
						id="app-dialog-cancel-button"
						className={state.showCancel ? undefined : 'hidden'}
						onClick={() => finish(false)}
					>
						{state.cancelText || 'キャンセル'}
					</button>
				</div>
			</div>
		</div>
	)
}
