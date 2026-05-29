# Contributing

Contributions are welcome — bug reports, feature requests, and pull requests.

## Requirements

- Windows 10/11
- Python 3.11–3.13
- Chrome or Chromium

## Setup

```sh
git clone https://github.com/aohana182/WhisperScribe.git
cd WhisperScribe
pip install -r requirements.txt
python server.py
```

Run tests:

```sh
pytest tests/
```

## Workflow

1. Branch from `main`: `git checkout -b feat/your-feature`
2. Make changes and run tests
3. Commit with [Conventional Commits](https://www.conventionalcommits.org): `feat(scope): description`
4. Open a PR against `main`

## Commit format

```
type(scope): subject

- What changed
- Why it matters
- How verified
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`
