# AGENTS.md - Noteeees Development Guide

## Release Process

### Pre-release Checklist
- [ ] All tests passing (`bun run test`)
- [ ] TypeScript compiles without errors (`bun run check-types`)
- [ ] CHANGELOG.md updated with new version
- [ ] Version bumped in package.json

### Publishing Steps

1. **Update version and changelog**
   ```bash
   # Edit package.json - bump version
   # Edit CHANGELOG.md - add a new "## [X.Y.Z] - YYYY-MM-DD" section at the top
   ```

2. **Build and test**
   ```bash
   bun run compile
   ```

3. **Commit version bump**
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): bump version to X.Y.Z"
   ```

4. **Create git tag**
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z - Brief description"
   git push origin main --tags
   ```

5. **Let the workflow publish**
   Pushing the `v*` tag triggers `.github/workflows/publish.yml`, which builds the
   `.vsix` and publishes it to both the VS Code Marketplace and Open VSX.
   No local publish step is needed — running `vsce publish` / `ovsx publish` by hand
   would publish the same version a second time.
   - Requires: `VSCE_PAT` and `OVSX_PAT` repository secrets

### Post-release
- [ ] Verify both marketplaces show new version
- [ ] Test installation from marketplace

## Development Notes

### Project Structure
- `src/` - VS Code extension source
- `shared/` - Dependency-free helpers shared by extension features: `collectNoteFiles.ts` (note file listing), `frontMatter.ts` (front matter parsing), `noteFilename.ts` (filename/date-prefix tokens), `pathSafety.ts` (path containment checks)
- `webview/` - Real webview scripts/styles inlined into `src/webview/generated.ts` by `scripts/embed-webview.mjs`
- `dist/` - Compiled extension (generated)
- `CHANGELOG.md` - Release history (newest version first)

### Testing
```bash
# Extension tests
bun run test
```

### Build Commands
```bash
bun run compile        # Full build with type check
bun run package        # Production build for publishing
bun run watch          # Development build with watcher
```

## Project-Specific Conventions

### Commit Message Format
- `feat: ` - New features
- `fix: ` - Bug fixes
- `refactor: ` - Code refactoring
- `test: ` - Adding or updating tests
- `docs: ` - Documentation updates
- `chore: ` - Maintenance tasks
- `chore(release): ` - Version bumps

### Branch Strategy
- `main` - Production-ready code
- Feature branches for development
- All changes via PR or direct commit to main for small fixes

### VS Code Extension Specifics
- Extension ID: `HidenobuNagai.noteeees`
- Display Name: Noteeees
- Publisher: HidenobuNagai
- Icon: `assets/icon.png`
