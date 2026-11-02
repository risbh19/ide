import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '../src/renderer/document';

test('save acknowledgements preserve newer text and line-ending changes', () => {
  const doc = new Document('a.ts', 'before', { path: 'a.ts', text: 'before', hash: 'old', eol: 'LF' });
  doc.model.reconcile('written', [{ anchor: 7, head: 7 }]);
  doc.model.reconcile('new typing', [{ anchor: 10, head: 10 }]); doc.eol = 'CRLF';
  doc.saved({ path: 'a.ts', text: 'written', hash: 'new', eol: 'LF' }, 'written', true);
  assert.equal(doc.model.text, 'new typing'); assert.equal(doc.eol, 'CRLF'); assert.equal(doc.dirty, true);
  doc.model.reconcile('written', [{ anchor: 0, head: 0 }]); assert.equal(doc.dirty, true);
});

test('async snapshots reject edit, undo, path change and replacement models', () => {
  const doc = new Document('a.ts', 'hello'); const snapshot = doc.snapshot();
  assert.equal(doc.unchanged(snapshot), true);
  doc.model.apply([{ start: 5, end: 5, text: '!' }]); doc.model.undo();
  assert.equal(doc.model.text, 'hello'); assert.equal(doc.unchanged(snapshot), false);
  const next = doc.snapshot(); doc.path = 'b.ts'; assert.equal(doc.unchanged(next), false);
});

test('deleted clean files remain dirty so close and recovery preserve their content', () => {
  const doc = new Document('a.ts', 'only copy', { path: 'a.ts', text: 'only copy', hash: 'old', eol: 'LF' });
  assert.equal(doc.dirty, false); doc.deleted = true; assert.equal(doc.dirty, true);
});
