import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

// ★ 新UI / 旧UI の切り替え（既存の uiSwitch.js と同じ挙動）。
//   ・設定は localStorage の uiMode（"new" / "old"）に、端末ごとに保存。未設定なら新UI。
//   ・<html> に ui-new / ui-old のクラスを付ける。CSSは、このクラスで、新UI用・旧UI用が切り替わる（build/scopeCss.ts）。
//   ・再読み込みなしで反映される。別のタブで切り替えたときも、このタブに反映する。
export type UiMode = 'new' | 'old'

const STORAGE_KEY = 'uiMode'
const DEFAULT_MODE: UiMode = 'new'

function readMode(): UiMode {
	try {
		const v = localStorage.getItem(STORAGE_KEY)
		if (v === 'old' || v === 'new') return v
	} catch {
		/* localStorageが使えない環境では既定値 */
	}
	return DEFAULT_MODE
}

function applyClass(mode: UiMode): void {
	const list = document.documentElement.classList
	list.toggle('ui-old', mode === 'old')
	list.toggle('ui-new', mode !== 'old')
}

interface UiModeValue {
	mode: UiMode
	setMode: (mode: UiMode) => void
}

const UiModeContext = createContext<UiModeValue | null>(null)

export function UiModeProvider({ children }: { children: ReactNode }) {
	const [mode, setModeState] = useState<UiMode>(readMode)
	const firstRun = useRef(true)

	const setMode = useCallback((next: UiMode) => {
		try {
			localStorage.setItem(STORAGE_KEY, next)
		} catch (e) {
			console.warn('UI設定を保存できませんでした:', e)
		}
		setModeState(next)
	}, [])

	useEffect(() => {
		applyClass(mode)
		if (firstRun.current) {
			firstRun.current = false
			return
		}
		// 切り替えたあと、ヘッダー高さなどの再計算を促す（既存の uiSwitch.js と同じ）
		const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
		return () => cancelAnimationFrame(id)
	}, [mode])

	useEffect(() => {
		const onStorage = (e: StorageEvent) => {
			if (e.key !== STORAGE_KEY) return
			setModeState(readMode())
		}
		window.addEventListener('storage', onStorage)
		return () => window.removeEventListener('storage', onStorage)
	}, [])

	const value = useMemo(() => ({ mode, setMode }), [mode, setMode])
	return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>
}

export function useUiMode(): UiModeValue {
	const value = useContext(UiModeContext)
	if (!value) throw new Error('useUiMode は UiModeProvider の中で使ってください')
	return value
}
