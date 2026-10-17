import { expect, test } from 'bun:test';
import { fail, faultOf, layoutChanged } from '../src/errors.js';

test('layout changes name what ranzen expected and blame ranzen', () => {
	const error = layoutChanged('#mappen on the lessons page');
	expect(error.failure).toEqual({
		code: 'LAYOUT_CHANGED',
		expected: '#mappen on the lessons page'
	});
	expect([error.fault, error.retryable]).toEqual(['ranzen', false]);
	expect(error.message).toBe(
		'ranzen no longer matches the portal: expected #mappen on the lessons page.'
	);
});

test('every failure says who has to act', () => {
	expect(
		(['HANDSHAKE_FAILED', 'MAINTENANCE', 'TIMEOUT', 'SESSION_EXPIRED', 'DISPOSED'] as const).map(
			(code) => fail(code, '').fault
		)
	).toEqual(['ranzen', 'portal', 'network', 'account', 'caller']);
});

test('anything else ranzen throws is a ranzen bug', () => {
	expect([faultOf(fail('NOT_FOUND', '')), faultOf(new TypeError('x'))]).toEqual([
		'caller',
		'ranzen'
	]);
});
