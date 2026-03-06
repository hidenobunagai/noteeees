import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { shouldPromptForTemplateSelection } from '../noteCommands';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('template picker is skipped without custom templates', () => {
		assert.strictEqual(shouldPromptForTemplateSelection([]), false);
	});

	test('template picker is shown with custom templates', () => {
		assert.strictEqual(shouldPromptForTemplateSelection(['meeting']), true);
	});
});
