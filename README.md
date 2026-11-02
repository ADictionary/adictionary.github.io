[README.md](https://github.com/user-attachments/files/34285248/README.md)
# Fourth & Goal

A single-page NFL scoreboard and player-stat tracker. It includes a personal fantasy roster view (standard full PPR) and a free prediction record. It is not a betting or wagering product.

## Publish the site so other people can use it

The site is static HTML, CSS and JavaScript, so it can be hosted without a server-side application.

### GitHub Pages

1. Create a new GitHub repository. For a free GitHub account, make the repository **public** to use GitHub Pages.
2. Upload `index.html` to the top level of the repository and commit the change.
3. Open the repository's **Settings → Pages**.
4. Under the build/deployment settings, choose deployment from the `main` branch and the root (`/`) folder, then save.
5. GitHub Pages will publish a URL for the site. Share that URL with other people.

Official instructions: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site

## How personal data works

Each visitor can use the site independently. Fantasy rosters and prediction history are stored in that visitor's own browser using local storage. Visitors do not see one another's teams or picks, and the data does not automatically sync between devices. A shared account system or global leaderboard would require a separate hosted database and authentication layer.

## Data notes

Live scores, game summaries and player data are requested from ESPN endpoints. Those endpoints are not a stable public developer API, so requests may occasionally fail or change. ESPN Fantasy league import may also be blocked by browser CORS restrictions or league privacy settings. Manual roster entry is available as a fallback.

## Important

Do not add passwords, ESPN session cookies, API secrets or other private credentials to this repository or to `index.html`. A public website should be treated as visible to anyone.
