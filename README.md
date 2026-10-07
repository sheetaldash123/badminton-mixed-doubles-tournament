# 🏸 Badminton Mixed Doubles Cup

A mobile-friendly, client-side tournament manager for 10 players: 5 boys + 5 girls.

## Features

- Enter 5 boys and 5 girls
- Randomly pair each boy with a girl
- Shuffle pairings until you are happy
- Choose **Single Game** or **Best of 3**
- 5-team round robin: every team plays every other team exactly once
- Score controls with + / − buttons
- Submit results so only confirmed scores affect standings
- League standings with P, W, L, PF, PA and +/-
- Automatic top-4 playoff bracket:
  - Qualifier 1: 1st vs 2nd
  - Eliminator: 3rd vs 4th
  - Qualifier 2: Q1 loser vs Eliminator winner
  - Final: Q1 winner vs Q2 winner
- LocalStorage persistence
- GitHub Pages deployment workflow
- No backend required

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Deploy on GitHub Pages

1. Create a new GitHub repository.
2. Upload/push all files in this project.
3. Use the `main` branch.
4. Open **Settings → Pages**.
5. Set the source to **GitHub Actions**.
6. Push to `main`.
7. GitHub will build and publish the app.

The app uses `base: "./"` so it works from a repository Pages URL without changing the repository name in the code.
