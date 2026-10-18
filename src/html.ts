import { selectAll, selectOne } from 'css-select';
import { hasChildren, isTag, isText, type AnyNode, type Document, type Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';

export type { Document, Element };
export type Root = Document | Element;

/** Unlike a browser, this adds no implied <body> or <tbody>; selectors must not rely on them. */
export function parseHtml(html: string): Document {
	return parseDocument(html);
}

export function all(selector: string, root: Root): Element[] {
	return selectAll<AnyNode, Element>(selector, root);
}

export function one(selector: string, root: Root): Element | null {
	return selectOne<AnyNode, Element>(selector, root);
}

/** A row's own data cells, skipping header cells and nested tables. */
export function cells(row: Element | null | undefined): Element[] {
	return (row?.children ?? []).filter((cell): cell is Element => isTag(cell) && cell.name === 'td');
}

/** A table's rows with data cells, whether or not the markup has a <tbody>. */
export function rows(table: Element | null | undefined): Element[] {
	return table ? all('tr', table).filter((row) => cells(row).length > 0) : [];
}

const BLOCKS = new Set(
	(
		'address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 ' +
		'header hr li ol p pre section table tr ul'
	).split(' ')
);

/**
 * Visible text with collapsed whitespace; LANIS hides sort keys in .hidden_encoded.
 * Multiline keeps <br> and block breaks, for free text such as lesson content and homework.
 */
export function text(node: Root | null | undefined, multiline = false): string {
	if (!node) return '';
	const parts: string[] = [];
	// Whether only spaces follow the last line break, so blocks never stack empty lines.
	let lineStart = true;
	const breakLine = () => {
		if (!lineStart) parts.push('\n');
		lineStart = true;
	};
	const walk = (current: AnyNode) => {
		if (isText(current)) {
			const data = current.data.replace(/\s+/g, ' ');
			parts.push(data);
			if (data.trim()) lineStart = false;
		} else if (isTag(current)) {
			if (current.name === 'br') {
				parts.push('\n');
				lineStart = true;
			} else if (!hasClass(current, 'hidden_encoded')) {
				const block = BLOCKS.has(current.name);
				if (block) breakLine();
				current.children.forEach(walk);
				if (block) breakLine();
				else if (current.name === 'td' || current.name === 'th') parts.push(' ');
			}
		} else if (hasChildren(current)) current.children.forEach(walk);
	};
	walk(node);
	const out = parts.join('');
	if (!multiline) return out.replace(/\s+/g, ' ').trim();
	return out
		.split('\n')
		.map((line) => line.trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Visible text with its whitespace as written, only trimmed, for names callers store as keys. */
export function rawText(node: Element | null | undefined, own = false): string {
	const parts: string[] = [];
	const walk = (current: AnyNode) => {
		if (isText(current)) parts.push(current.data);
		else if (!own && isTag(current) && !hasClass(current, 'hidden_encoded')) {
			current.children.forEach(walk);
		}
	};
	node?.children.forEach(walk);
	return parts.join('').trim();
}

/** Only the element's own text, without that of badges or labels nested in it. */
export function ownText(node: Element | null | undefined): string {
	return (node?.children ?? [])
		.flatMap((child) => (isText(child) ? [child.data] : []))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function attr(node: Element | null | undefined, name: string): string | undefined {
	return node?.attribs[name];
}

export function hasClass(node: Element | null | undefined, name: string): boolean {
	return (node?.attribs.class ?? '').split(/\s+/).includes(name);
}

/** Markup inside portal JSON values, e.g. <del>Mül</del>, as plain text. */
export function stripTags(value: string): string {
	if (!/[<&]/.test(value)) return value.trim();
	return text(parseHtml(value));
}
