# Shopping List (Kauppalista)

A small frontend shopping list web app (PWA) that keeps multiple lists in sync across connected clients in real time.

> The app is a static frontend. It connects to a WebSocket server at `/wss/kauppalista` on the same host that serves it, so you'll need a matching backend running to use it.

## Features

- Create, rename, refresh and delete multiple lists
- Add / complete / clear items, live-synced to other connected clients
- Copy items from one list to another
- Installable as a Progressive Web App (see `site.webmanifest`)

## Tech

- Plain HTML / CSS / JavaScript (no build step)
- Real-time sync via WebSocket

## Getting started

Serve the folder from any static web server and load `index.html`.

## Files

- `index.html` – app structure
- `css/styles.css` – styling
- `js/app.js` – app logic and WebSocket handling
- `site.webmanifest` – PWA manifest
- `img/` – app icons / favicons