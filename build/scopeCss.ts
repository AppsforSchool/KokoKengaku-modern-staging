// ★ 既存のCSSを「中身は書き換えずに」、ページごと・新旧UIごとに限定して読み込むための変換。
//
//   SPAでは、すべてのページのCSSが同じ文書に載る。既存のCSSは、ページごとに別々のファイルを読み込む前提で
//   書かれているため、同名のクラス（.modal-content など）が衝突する。そこで、ビルド時に、各セレクタの前に
//   「どのUIで、どのページか」を示す範囲を自動で付ける。
//
//   例）src/styles/new/login.css（新UI・ログイン）の  .modal-content { … }
//       → :where(html.ui-new .page-login) .modal-content { … }
//
//   ・:where() で包むので、**セレクタの詳細度（優先順位）は、元のまま変わらない**。
//     （付けないと、`* { margin: 0 }` のような詳細度ゼロのルールが、クラスのルールに勝ってしまい、見た目が崩れる）
//   ・html / body / :root のルールは、ページの外枠（.page-◯◯）に当てる。
//   ・@keyframes は、名前の末尾に「__新旧-ページ」を付け、animation の参照も同じ名前に直す
//     （ページ間で同名の @keyframes の中身が違っても、衝突しない）。
//
//   対象：src/styles/(new|old)/<ページ名>.css
//   <ページ名> が dialog のものは、全ページ共通のダイアログ用で、.ui-page（全ページの外枠）に限定する。

import type { Plugin } from 'vite'

export type Mode = 'new' | 'old'

export function scopeFor(mode: Mode, page: string): string {
	return page === 'dialog' ? `html.ui-${mode} .ui-page` : `html.ui-${mode} .page-${page}`
}

// ---------- 低レベルの走査 ----------

/** text[i] が引用符の開始なら、対応する終了の次の位置を返す。引用符でなければ i を返す。 */
function skipString(text: string, i: number): number {
	const q = text[i]
	if (q !== '"' && q !== "'") return i
	let j = i + 1
	while (j < text.length) {
		if (text[j] === '\\') j += 2
		else if (text[j] === q) return j + 1
		else j++
	}
	return text.length
}

/** text[i] がコメントの開始なら、終了の次の位置を返す。コメントでなければ i を返す。 */
function skipComment(text: string, i: number): number {
	if (text[i] === '/' && text[i + 1] === '*') {
		const end = text.indexOf('*/', i + 2)
		return end === -1 ? text.length : end + 2
	}
	return i
}

/** text[open] は '{'。対応する '}' の位置を返す。 */
function findBlockEnd(text: string, open: number): number {
	let depth = 0
	let i = open
	while (i < text.length) {
		const c = skipComment(text, i)
		if (c !== i) { i = c; continue }
		const s = skipString(text, i)
		if (s !== i) { i = s; continue }
		if (text[i] === '{') depth++
		else if (text[i] === '}') {
			depth--
			if (depth === 0) return i
		}
		i++
	}
	throw new Error('scopeCss: 波括弧が閉じていません')
}

/** カンマで区切る（括弧・角括弧・引用符の中のカンマは区切りにしない）。 */
function splitTopLevel(selectorList: string): string[] {
	const parts: string[] = []
	let depth = 0
	let start = 0
	let i = 0
	while (i < selectorList.length) {
		const s = skipString(selectorList, i)
		if (s !== i) { i = s; continue }
		const c = selectorList[i]
		if (c === '(' || c === '[') depth++
		else if (c === ')' || c === ']') depth--
		else if (c === ',' && depth === 0) {
			parts.push(selectorList.slice(start, i))
			start = i + 1
		}
		i++
	}
	parts.push(selectorList.slice(start))
	return parts.map((p) => p.trim()).filter((p) => p !== '')
}

// ---------- セレクタの変換 ----------

const ROOT_TOKEN = /^(html|body|:root)(?![\w-])/

export function scopeSelector(selector: string, scope: string): string {
	const where = `:where(${scope})`
	let s = selector.trim()
	let replaced = false
	for (;;) {
		const m = ROOT_TOKEN.exec(s)
		if (!m) break
		s = s.slice(m[0].length)
		replaced = true
		// 「html body .x」のように、続けて html / body / :root が来たら、まとめて1つの外枠として扱う
		const trimmed = s.replace(/^\s+/, '')
		if (trimmed !== s && ROOT_TOKEN.test(trimmed)) {
			s = trimmed
			continue
		}
		break
	}
	return replaced ? where + s : `${where} ${s}`
}

// ---------- 本体 ----------

const KEYFRAMES_AT = /^@(?:-webkit-)?keyframes\b/i
const NESTING_AT = /^@(media|supports|layer|container|document)\b/i
const ANIMATION_DECL = /((?:-webkit-)?animation(?:-name)?\s*:)([^;}]*)/gi

/**
 * 「//text-align: left;」のように、CSSでは無効な宣言（JavaScript流のコメント）を取り除く。
 * ブラウザは、無効な宣言を、次の「;」まで読み飛ばす。ビルド時のCSS圧縮は厳密で、エラーにするため、同じ扱いにしておく。
 * （宣言の先頭にある「//」だけが対象。url(https://…) のような、途中にある「//」は触らない）
 */
function dropInvalidSlashDeclarations(body: string): string {
	// 「//」の宣言が続くとき（1つ目が「;」まで消えると、2つ目の前の「;」が無くなる）に備えて、変化がなくなるまで繰り返す
	let current = body
	for (;;) {
		const next = current.replace(/(^|;)(\s*)\/\/[^;]*(;|$)/g, '$1$2')
		if (next === current) return current
		current = next
	}
}

function renameAnimations(body: string, names: Map<string, string>): string {
	if (names.size === 0) return body
	return body.replace(ANIMATION_DECL, (_all, head: string, value: string) => {
		let v = value
		for (const [from, to] of names) {
			v = v.replace(new RegExp(`(?<![\\w-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'), to)
		}
		return head + v
	})
}

function collectKeyframeNames(css: string, tag: string): Map<string, string> {
	const names = new Map<string, string>()
	const re = /@(?:-webkit-)?keyframes\s+([\w-]+)/gi
	let m: RegExpExecArray | null
	while ((m = re.exec(css)) !== null) names.set(m[1], `${m[1]}__${tag}`)
	return names
}

function walk(text: string, scope: string, names: Map<string, string>): string {
	let out = ''
	let i = 0
	const n = text.length
	while (i < n) {
		// 空白を読み飛ばす
		while (i < n && /\s/.test(text[i])) i++
		if (i >= n) break

		// 前置き（セレクタや @ルールの頭）を、{ か ; まで読む。コメントは捨てる。
		let prelude = ''
		let depth = 0
		let terminator = ''
		while (i < n) {
			const c = skipComment(text, i)
			if (c !== i) { i = c; continue }
			const s = skipString(text, i)
			if (s !== i) { prelude += text.slice(i, s); i = s; continue }
			const ch = text[i]
			if (ch === '(' || ch === '[') depth++
			else if (ch === ')' || ch === ']') depth--
			if (depth === 0 && (ch === '{' || ch === ';')) { terminator = ch; break }
			if (depth === 0 && ch === '}') throw new Error('scopeCss: 対応しない } があります')
			prelude += ch
			i++
		}
		prelude = prelude.trim()
		if (terminator === '') {
			if (prelude !== '') throw new Error(`scopeCss: 文が閉じていません: ${prelude.slice(0, 40)}`)
			break
		}

		if (terminator === ';') {
			// @import / @charset など
			out += `${prelude};\n`
			i++
			continue
		}

		// ブロック
		const end = findBlockEnd(text, i)
		const body = text.slice(i + 1, end)
		i = end + 1

		if (prelude.startsWith('@')) {
			if (KEYFRAMES_AT.test(prelude)) {
				const renamed = prelude.replace(/^(@(?:-webkit-)?keyframes\s+)([\w-]+)/i, (_a, head: string, name: string) => head + (names.get(name) ?? name))
				out += `${renamed} {${body}}\n`
			} else if (NESTING_AT.test(prelude)) {
				out += `${prelude} {\n${walk(body, scope, names)}}\n`
			} else {
				out += `${prelude} {${body}}\n` // @font-face など。そのまま
			}
			continue
		}

		// 通常のルール。本文の中に { があれば、CSSのネストなので、対応していない
		for (let k = 0; k < body.length; k++) {
			const c = skipComment(body, k)
			if (c !== k) { k = c - 1; continue }
			const s = skipString(body, k)
			if (s !== k) { k = s - 1; continue }
			if (body[k] === '{') throw new Error(`scopeCss: CSSのネストには対応していません: ${prelude.slice(0, 40)}`)
		}
		const selectors = splitTopLevel(prelude).map((sel) => scopeSelector(sel, scope))
		out += `${selectors.join(',\n')} {${renameAnimations(dropInvalidSlashDeclarations(body), names)}}\n`
	}
	return out
}

export function scopeCss(css: string, scope: string, tag: string): string {
	return walk(css, scope, collectKeyframeNames(css, tag))
}

// ---------- Vite プラグイン ----------

const TARGET = /[\\/]src[\\/]styles[\\/](new|old)[\\/]([\w-]+)\.css$/

export function scopeCssPlugin(): Plugin {
	return {
		name: 'kokokengaku-scope-css',
		enforce: 'pre', // Viteが CSS を処理する前の、生のCSSを受け取る
		transform(code, id) {
			const m = TARGET.exec(id.split('?')[0])
			if (!m) return null
			const mode = m[1] as Mode
			const page = m[2]
			return { code: scopeCss(code, scopeFor(mode, page), `${mode}-${page}`), map: null }
		},
	}
}
