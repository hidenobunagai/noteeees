import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { extractNoteMetadata, shouldPromptForTemplateSelection } from '../noteCommands';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('template picker is skipped without custom templates', () => {
		assert.strictEqual(shouldPromptForTemplateSelection([]), false);
	});

	test('template picker is shown with custom templates', () => {
		assert.strictEqual(shouldPromptForTemplateSelection(['meeting']), true);
	});

	test('note metadata prefers heading title and merges tags', () => {
		const metadata = extractNoteMetadata(
			'---\ntags: [project]\n---\n\n# Weekly Sync\nDiscuss #todo items',
			'fallback-title'
		);

		assert.strictEqual(metadata.title, 'Weekly Sync');
		assert.deepStrictEqual(metadata.tags, ['#project', '#todo']);
	});
});
