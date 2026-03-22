# Contributing to Inter-Knot

Thanks for contributing.

## Before You Start

- Open an issue first for substantial changes (protocol behavior, SDK API, CLI UX, architecture changes).
- Keep pull requests focused and reviewable.

## Development Setup

```bash
pnpm install
pnpm build
```

## Validation Checklist

Run these before opening a PR:

```bash
pnpm test:cli
anchor test
```

If your change touches only docs, mention that in the PR description.

## Pull Request Guidelines

- Use clear commit messages (for example: `docs(readme): ...`, `fix(cli): ...`, `feat(sdk): ...`).
- Describe:
  - What changed
  - Why it changed
  - How you validated it
- Include screenshots/terminal logs for UX or workflow changes.

## Security Reports

Do not open a public issue for sensitive vulnerabilities.
Follow the process in `SECURITY.md` when available.
