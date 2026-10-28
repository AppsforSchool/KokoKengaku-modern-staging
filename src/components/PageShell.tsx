import type { ReactNode } from 'react'
import { DialogHost } from '../ui/DialogProvider'

/**
 * 各ページの外枠。既存のHTMLでは <body> が担っていた役割（背景・文字色・縦並びなど）を、ここに移した。
 * ・ui-page   … 全ページ共通の印（ダイアログのCSSが、これに限定される）
 * ・page-◯◯  … ページごとの印（そのページのCSSが、これに限定される。build/scopeCss.ts）
 * ダイアログの表示部分も、この枠の中に置く（ページのCSS .modal-overlay などが、効くようにするため）。
 */
export function PageShell({ name, children }: { name: string; children: ReactNode }) {
	return (
		<div className={`ui-page page-${name}`}>
			{children}
			<DialogHost />
		</div>
	)
}
