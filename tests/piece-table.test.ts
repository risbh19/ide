import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PieceTable } from '../src/core/piece-table';
import { Tokenizer } from '../src/core/tokenizer';

test('piece table preserves Unicode, multiline positions, and reversible edits', () => {
  const table = new PieceTable('hello\n🌍 world\n');
  assert.deepEqual(table.position(6), { line: 2, column: 1 });
  assert.equal(table.offset(2, 4), 9);
  table.apply([{ start: 0, end: 5, text: 'hi' }, { start: 9, end: 14, text: 'Orbit' }]);
  assert.equal(table.text, 'hi\n🌍 Orbit\n');
  assert.equal(table.undo(), true);
  assert.equal(table.text, 'hello\n🌍 world\n');
  table.redo(); assert.equal(table.text, 'hi\n🌍 Orbit\n');
});

test('5,000 deterministic edits agree with a plain string oracle', () => {
  let seed = 73191, text = 'a\nb\nc';
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const table = new PieceTable(text);
  for (let i = 0; i < 5000; i++) {
    const a = Math.floor(random() * (text.length + 1)), b = a + Math.floor(random() * (text.length - a + 1));
    const insertion = ['x', '\n', 'hello', '🌍', '', 'const a = 3;'][Math.floor(random() * 6)];
    table.apply([{ start: a, end: b, text: insertion }]); text = text.slice(0, a) + insertion + text.slice(b);
    assert.equal(table.text, text, `edit ${i}`);
    const at = Math.floor(random() * (text.length + 1));
    const p = table.position(at); assert.equal(table.offset(p.line, p.column), at);
  }
});

test('multi-edit transaction is atomic and restores cursor selections', () => {
  const table = new PieceTable('foo foo foo');
  table.selection = [{ anchor: 0, head: 3 }, { anchor: 4, head: 7 }];
  table.apply([{ start: 0, end: 3, text: 'x' }, { start: 4, end: 7, text: 'x' }], [{ anchor: 1, head: 1 }, { anchor: 3, head: 3 }]);
  assert.equal(table.text, 'x x foo'); table.undo();
  assert.deepEqual(table.selection, [{ anchor: 0, head: 3 }, { anchor: 4, head: 7 }]);
  assert.throws(() => table.apply([{ start: -1, end: 0, text: '' }]), RangeError);
  assert.throws(() => table.apply([{ start: 0, end: 6, text: '' }, { start: 5, end: 7, text: '' }]), RangeError);
});

test('native input reconciles an IME-style replacement and invalidates redo', () => {
  const table = new PieceTable('hello');
  table.reconcile('你好', [{ anchor: 2, head: 2 }]); assert.equal(table.text, '你好');
  table.undo(); assert.equal(table.text, 'hello'); table.redo(); assert.equal(table.text, '你好');
  table.undo(); table.apply([{ start: 5, end: 5, text: '!' }]); assert.equal(table.redo(), false);
});

test('incremental lexer propagates multiline comment state and escapes markup', () => {
  const lexer = new Tokenizer();
  let rows = lexer.tokenize('/* a\nconst b = 2;\n*/\nconst c = "<script>";', 'TypeScript');
  assert.ok(rows[1].includes('tok-comment'));
  assert.ok(rows[3].includes('&lt;script&gt;'));
  rows = lexer.tokenize('// a\nconst b = 2;\n*/\nconst c = "<script>";', 'TypeScript');
  assert.ok(rows[1].includes('tok-keyword'));
  assert.ok(!rows[1].includes('tok-comment'));
});

test('native beforeinput hints preserve surrogate pairs and undo selection', () => {
  const table = new PieceTable('x🌍y'); table.selection = [{ anchor: 3, head: 3 }];
  table.reconcile('xy', [{ anchor: 1, head: 1 }], { selection: table.selection[0], type: 'deleteContentBackward' });
  assert.equal(table.text, 'xy'); table.undo(); assert.equal(table.text, 'x🌍y');
  assert.deepEqual(table.selection, [{ anchor: 3, head: 3 }]);
  table.reconcile('x你好y', [{ anchor: 3, head: 3 }], { selection: { anchor: 1, head: 3 }, type: 'insertText' });
  assert.equal(table.text, 'x你好y');
});

test('bounded history compacts discarded addition text without corrupting undo', () => {
  const table = new PieceTable('base');
  for (let i = 0; i < 45; i++) table.apply([{ start: 0, end: table.length, text: String(i).padEnd(1024 * 1024, 'x') }]);
  assert.ok(table.statistics().additions < 32 * 1024 * 1024, JSON.stringify(table.statistics()));
  assert.ok(table.statistics().undo < 20);
  assert.ok(table.undo()); assert.ok(table.text.startsWith('43'));
  assert.ok(table.redo()); assert.ok(table.text.startsWith('44'));
});
