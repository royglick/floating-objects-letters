# language, given physics

Generative typography sketches where **text behaves like a physical thing** —
letters with nerves, sentences with bodies.

Built with [p5.js](https://p5js.org) (loaded from a CDN — needs internet on first load).
Open `index.html` in a browser.

## Pieces

| File | What it is |
|------|------------|
| `index.html` | **Swarm** — sentences that flock and slither leftward like a school of fish, each led by its first letter. Move the cursor to part the swarm. Logic lives in `swarm.js`. |

## Editing

The behavior lives in `swarm.js`, with two clearly-marked blocks at the top:

- **SENTENCES** — the words / sentences
- **CFG** — the feel (speed, slither, flocking weights, cursor repulsion)

Change a number, refresh the browser, repeat. No build step, no install.

## Running locally

Just open the file in a browser. If a piece uses web fonts and you want them to
load reliably offline, serve the folder instead:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## License

Personal creative work. All rights reserved (for now).
