import { useUiMode } from './UiModeProvider'

/** ドロワーの中に置く「新UI」のトグル（既存の uiSwitch.js の buildSwitchSection と同じ構造）。 */
export function UiSwitchSection() {
	const { mode, setMode } = useUiMode()
	return (
		<div className="drawer-section ui-switch-section">
			<label className="ui-switch-row">
				<span className="ui-switch-label">新UI</span>
				<span className="ui-switch">
					<input
						type="checkbox"
						className="ui-switch-input"
						role="switch"
						aria-label="新UI"
						checked={mode !== 'old'}
						onChange={(e) => setMode(e.target.checked ? 'new' : 'old')}
					/>
					<span className="ui-switch-track"></span>
				</span>
			</label>
		</div>
	)
}
